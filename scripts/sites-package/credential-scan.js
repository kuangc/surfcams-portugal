import {
  isDirectRuntimeReference,
  staticStringValue,
  staticValue,
  unknownStaticValue,
  walkAst
} from "./ast-utils.js";

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

function staticKey(node, computed = false) {
  if (!computed && node?.type === "Identifier") return node.name;
  return staticStringValue(node);
}

function unwrapExpression(node) {
  while (["ChainExpression", "ParenthesizedExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function unwrapCallee(node) {
  let value = unwrapExpression(node);
  while (value?.type === "SequenceExpression") {
    value = unwrapExpression(value.expressions.at(-1));
  }
  return value;
}

function targetKey(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") return staticKey(node.property, node.computed);
  if (node?.type === "AssignmentPattern") return targetKey(node.left);
  return null;
}

function protectedPatternTargetLabel(node) {
  const direct = credentialLabel(targetKey(node));
  if (direct) return direct;
  if (node?.type === "RestElement") return protectedPatternTargetLabel(node.argument);
  const children = node?.type === "ObjectPattern"
    ? node.properties.map((property) => property.type === "Property" ? property.value : property)
    : node?.type === "ArrayPattern" ? node.elements : [];
  for (const child of children) {
    const label = protectedPatternTargetLabel(child);
    if (label) return label;
  }
  return null;
}

function noteReferenceNode(diagnostics) {
  if (diagnostics) {
    diagnostics.credentialReferenceNodes = (diagnostics.credentialReferenceNodes ?? 0) + 1;
  }
}

function runtimeReferenceShape(node, diagnostics) {
  const properties = [];
  let value = unwrapExpression(node);
  while (value?.type === "MemberExpression") {
    noteReferenceNode(diagnostics);
    const property = value.computed
      ? runtimeSelectorShape(value.property, diagnostics)
      : ["static", value.property?.name];
    if (!property) return null;
    properties.push(property);
    value = unwrapExpression(value.object);
  }
  if (value?.type !== "Identifier") return null;
  noteReferenceNode(diagnostics);
  return ["reference", value.name, ...properties.reverse()];
}

function runtimeReferencePath(node, diagnostics) {
  const shape = runtimeReferenceShape(node, diagnostics);
  if (!shape) return null;
  const path = JSON.stringify(shape);
  if (diagnostics) {
    diagnostics.credentialReferenceMaxBytes = Math.max(
      diagnostics.credentialReferenceMaxBytes ?? 0,
      path.length
    );
  }
  return path;
}

function runtimeSelectorShape(node, diagnostics) {
  const value = unwrapExpression(node);
  noteReferenceNode(diagnostics);
  const staticResult = staticValue(value);
  if (staticResult !== unknownStaticValue) {
    return ["static", String(staticResult)];
  }
  if (value?.type === "Literal" && value.regex) {
    return ["regexp", value.regex.pattern, value.regex.flags];
  }
  if (value?.type === "ThisExpression") return ["this"];
  if (value?.type === "Identifier") return ["identifier", value.name];
  if (value?.type === "MemberExpression") return runtimeReferenceShape(value, diagnostics);
  if (value?.type === "ConditionalExpression") {
    const parts = [value.test, value.consequent, value.alternate]
      .map((part) => runtimeSelectorShape(part, diagnostics));
    return parts.every(Boolean) ? ["conditional", ...parts] : null;
  }
  if (value?.type === "LogicalExpression" || value?.type === "BinaryExpression") {
    const left = runtimeSelectorShape(value.left, diagnostics);
    const right = runtimeSelectorShape(value.right, diagnostics);
    return left && right ? [value.type, value.operator, left, right] : null;
  }
  if (value?.type === "UnaryExpression" && value.operator !== "delete") {
    const argument = runtimeSelectorShape(value.argument, diagnostics);
    return argument ? ["unary", value.operator, argument] : null;
  }
  if (value?.type === "TemplateLiteral") {
    const expressions = value.expressions.map((expression) =>
      runtimeSelectorShape(expression, diagnostics)
    );
    return expressions.every(Boolean)
      ? ["template", value.quasis.map(staticStringValue), expressions]
      : null;
  }
  return null;
}

function assignsStaticValueTo(node, referencePath, diagnostics) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return false;
  if (/^(?:Function|Class)/.test(value.type) || value.type === "ArrowFunctionExpression") {
    return false;
  }
  if (value.type === "AssignmentExpression") {
    if (
      runtimeReferencePath(value.left, diagnostics) === referencePath
      && ["=", "||=", "&&=", "??="].includes(value.operator)
      && hasStaticCredentialOutcome(value.right, diagnostics)
    ) return true;
  }
  return Object.entries(value).some(([key, child]) =>
    !["start", "end", "loc"].includes(key)
    && (Array.isArray(child)
      ? child.some((entry) => assignsStaticValueTo(entry, referencePath, diagnostics))
      : assignsStaticValueTo(child, referencePath, diagnostics))
  );
}

function containsOpaqueInvocation(node) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return false;
  if (/^Function/.test(value.type) || value.type === "ArrowFunctionExpression") {
    return false;
  }
  if (
    /^Class/.test(value.type)
    || ["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(value.type)
  ) {
    return true;
  }
  return Object.entries(value).some(([key, child]) =>
    !["start", "end", "loc"].includes(key)
    && (Array.isArray(child)
      ? child.some(containsOpaqueInvocation)
      : containsOpaqueInvocation(child))
  );
}

function hasStaticCredentialOutcome(node, diagnostics) {
  if (["ConditionalExpression", "LogicalExpression"].includes(node?.type)) {
    const branches = node.type === "ConditionalExpression"
      ? [node.consequent, node.alternate]
      : [node.left, node.right];
    return branches.some((branch) => hasStaticCredentialOutcome(branch, diagnostics));
  }
  if (node?.type === "SequenceExpression") {
    const result = node.expressions.at(-1);
    const preceding = node.expressions.slice(0, -1);
    if (preceding.some(containsOpaqueInvocation)) return true;
    const referencePath = runtimeReferencePath(result, diagnostics);
    return (
      referencePath !== null
      && preceding.some((value) => assignsStaticValueTo(value, referencePath, diagnostics))
    ) || hasStaticCredentialOutcome(result, diagnostics);
  }
  if (
    node?.type === "AssignmentPattern"
    || (node?.type === "AssignmentExpression" && ["=", "||=", "&&=", "??="].includes(node.operator))
  ) {
    return hasStaticCredentialOutcome(node.right, diagnostics);
  }
  if (node?.type === "AwaitExpression") {
    return hasStaticCredentialOutcome(node.argument, diagnostics);
  }
  if (isDirectRuntimeReference(node)) return false;
  const value = staticValue(node);
  if (value !== unknownStaticValue) return value !== null && String(value).length > 0;
  return node !== null && node !== undefined;
}

function findAstCredentialLiteral(ast, diagnostics) {
  return walkAst(ast, (node) => {
    let label = null;
    let value = null;
    const callCandidates = [];
    if (node.type === "VariableDeclarator") {
      label = protectedPatternTargetLabel(node.id);
      value = node.init;
    } else if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      label = protectedPatternTargetLabel(node.left);
      if (
        node.type === "AssignmentPattern"
        || ["=", "||=", "&&=", "??="].includes(node.operator)
      ) value = node.right;
    } else if (node.type === "Property" || node.type === "PropertyDefinition") {
      label = credentialLabel(staticKey(node.key, node.computed));
      value = node.value;
    } else if (node.type === "CallExpression") {
      const callee = unwrapCallee(node.callee);
      const calleeProperty = callee?.type === "MemberExpression"
        ? staticKey(callee.property, callee.computed)
        : null;
      if (["append", "set", "setAttribute"].includes(calleeProperty)) {
        callCandidates.push([node.arguments[0], node.arguments[1]]);
      }
      const calleeObject = callee?.type === "MemberExpression"
        ? unwrapExpression(callee.object)
        : null;
      const isReflectSet = calleeProperty === "set" && (
        calleeObject?.type === "Identifier" && calleeObject.name === "Reflect"
        || calleeObject?.type === "MemberExpression"
          && staticKey(calleeObject.property, calleeObject.computed) === "Reflect"
      );
      if (isReflectSet) callCandidates.push([node.arguments[1], node.arguments[2]]);
      for (const [key, candidateValue] of callCandidates) {
        const candidateLabel = credentialLabel(staticStringValue(key));
        if (candidateLabel && hasStaticCredentialOutcome(candidateValue, diagnostics)) {
          return candidateLabel;
        }
      }
      return null;
    }
    return label && hasStaticCredentialOutcome(value, diagnostics) ? label : null;
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

export {
  credentialLabel,
  findAstCredentialLiteral,
  findFallbackCredentialLiteral
};
