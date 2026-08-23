import {
  staticStringValue,
  walkAst
} from "./ast-utils.js";
import { createCredentialCarrierScanner } from "./credential-carrier-scan.js";
import { createCredentialKeyOutcomeAnalyzer } from "./credential-key-outcomes.js";
import { createCredentialValueAnalyzer } from "./credential-value-analysis.js";

const runtimeKeyPadding = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
const runtimeCredentialSeparator = String.raw`(?::|\|\|=|\?\?=|=(?!=))`;
const runtimeCredentialKeys = [
  ["Google client ID", /^GOOGLE_CLIENT_ID$/i, "GOOGLE_CLIENT_ID"],
  ["bootstrap owner email", /^BOOTSTRAP_OWNER_EMAIL$/i, "BOOTSTRAP_OWNER_EMAIL"],
  ["signed MEO token", /^wmsAuthSign$/i, "wmsAuthSign"],
  [
    "Sites source credential",
    /^(?:OPENAI_)?SITES?_SOURCE_(?:CREDENTIAL|TOKEN|API_KEY|KEY|SECRET)$/i,
    "(?:OPENAI_)?SITES?_SOURCE_(?:CREDENTIAL|TOKEN|API_KEY|KEY|SECRET)"
  ]
];
const runtimeCredentialNames = [
  ["Google client ID", "GOOGLE_CLIENT_ID"],
  ["bootstrap owner email", "BOOTSTRAP_OWNER_EMAIL"],
  ["signed MEO token", "wmsAuthSign"],
  ...["", "OPENAI_"].flatMap((prefix) =>
    ["SITE", "SITES"].flatMap((site) =>
      ["CREDENTIAL", "TOKEN", "API_KEY", "KEY", "SECRET"].map((suffix) =>
        ["Sites source credential", `${prefix}${site}_SOURCE_${suffix}`]
      )
    )
  )
];

function runtimeCredentialStart(keyPattern) {
  const quotedKey = `(?:"(?:${keyPattern})"|'(?:${keyPattern})')`;
  return new RegExp(
    `(?:${quotedKey}${runtimeKeyPadding}\\]?|\\b(?:${keyPattern})\\b)`
      + `${runtimeKeyPadding}${runtimeCredentialSeparator}\\s*`,
    "gi"
  );
}

const fallbackCredentialStarts = runtimeCredentialKeys.map(([label, , source]) => [
  label,
  runtimeCredentialStart(source)
]);
const fallbackCredentialNames = runtimeCredentialKeys.map(([label, , source]) => [
  label,
  new RegExp(`(?:["'](?:${source})["']|\\b(?:${source})\\b)`, "i")
]);
const fallbackRuntimeReference = new RegExp(
  String.raw`^[a-z_$][a-z0-9_$]*(?:(?:\?\.|\.)[a-z_$][a-z0-9_$]*|(?:\?\.)?\[\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-z_$][a-z0-9_$]*)\s*\])*$`,
  "i"
);

function credentialLabel(key) {
  if (typeof key !== "string") return null;
  return runtimeCredentialKeys.find(([, pattern]) => pattern.test(key))?.[0] ?? null;
}

function credentialPrefixLabel(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  const normalized = key.toLowerCase();
  return runtimeCredentialNames.find(([, name]) =>
    name.toLowerCase().startsWith(normalized)
  )?.[0] ?? null;
}

function staticKey(node, computed = false) {
  if (!computed && node?.type === "Identifier") return node.name;
  return staticStringValue(node);
}

function protectedPatternTargetLabel(node, keyOutcomeAnalyzer) {
  const direct = node?.type === "Identifier"
    ? credentialLabel(node.name)
    : node?.type === "MemberExpression"
      ? node.computed
        ? keyOutcomeAnalyzer.findExplicitLabel(node.property)
        : credentialLabel(node.property?.name)
      : null;
  if (direct) return direct;
  if (node?.type === "AssignmentPattern") {
    return protectedPatternTargetLabel(node.left, keyOutcomeAnalyzer);
  }
  if (node?.type === "RestElement") {
    return protectedPatternTargetLabel(node.argument, keyOutcomeAnalyzer);
  }
  const children = node?.type === "ObjectPattern"
    ? node.properties.map((property) => property.type === "Property" ? property.value : property)
    : node?.type === "ArrayPattern" ? node.elements : [];
  for (const child of children) {
    const label = protectedPatternTargetLabel(child, keyOutcomeAnalyzer);
    if (label) return label;
  }
  return null;
}

function findAstCredentialLiteral(ast, diagnostics) {
  const analyzer = createCredentialValueAnalyzer(ast, diagnostics);
  const keyOutcomeAnalyzer = createCredentialKeyOutcomeAnalyzer(
    credentialLabel,
    diagnostics
  );
  const carrierScanner = createCredentialCarrierScanner({
    analyzer,
    credentialLabel,
    credentialPrefixLabel
  });
  return walkAst(ast, (node) => {
    if (diagnostics) {
      diagnostics.credentialAstNodes = (diagnostics.credentialAstNodes ?? 0) + 1;
    }
    let label = null;
    let value = null;
    if (node.type === "VariableDeclarator") {
      label = protectedPatternTargetLabel(node.id, keyOutcomeAnalyzer);
      value = node.init;
    } else if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      label = protectedPatternTargetLabel(node.left, keyOutcomeAnalyzer);
      if (
        node.type === "AssignmentPattern"
        || ["=", "||=", "&&=", "??="].includes(node.operator)
      ) value = node.right;
    } else if (node.type === "Property" || node.type === "PropertyDefinition") {
      label = node.computed
        ? keyOutcomeAnalyzer.findExplicitLabel(node.key)
        : credentialLabel(staticKey(node.key, false));
      value = node.value;
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
      return carrierScanner.find(node);
    }
    return label && analyzer.hasStaticOutcome(value) ? label : null;
  });
}

function findFallbackCredentialLiteral(text) {
  for (let index = 0; index < fallbackCredentialStarts.length; index += 1) {
    const [label, pattern] = fallbackCredentialStarts[index];
    let sawCandidate = false;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      sawCandidate = true;
      const expression = text.slice(match.index + match[0].length).split(/[,;}\r\n]/, 1)[0];
      if (fallbackRuntimeReference.test(expression.trim())) continue;
      return label;
    }
    const [, namePattern] = fallbackCredentialNames[index];
    if (!sawCandidate && namePattern.test(text)) return label;
  }
  return null;
}

function findDecodedCredentialLiteral(text) {
  for (const [label, pattern] of fallbackCredentialStarts) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const expression = text
        .slice(match.index + match[0].length)
        .split(/[,;\r\n]/, 1)[0]
        .trim();
      if (expression.length === 0) continue;
      if (
        fallbackRuntimeReference.test(expression)
        && /(?:\?\.|\.|\[)/.test(expression)
      ) continue;
      return label;
    }
  }
  return null;
}

export {
  credentialLabel,
  credentialPrefixLabel,
  findAstCredentialLiteral,
  findDecodedCredentialLiteral,
  findFallbackCredentialLiteral
};
