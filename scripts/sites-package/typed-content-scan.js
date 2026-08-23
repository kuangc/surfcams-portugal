import { parseAst } from "vite";

import { withoutAstLiteralText } from "./ast-utils.js";
import {
  credentialLabel,
  findAstCredentialLiteral,
  findDecodedCredentialLiteral,
  findFallbackCredentialLiteral
} from "./credential-scan.js";
import { findHtmlRuntimeLiteral } from "./html-scan.js";
import {
  advanceSignedQueryMarker,
  findAstSignedQuery
} from "./signed-query-scan.js";

const inlineSourceMapDirective = /^[ \t]*[#@][ \t]*sourceMappingURL[ \t]*=[ \t]*data:/i;

function withoutQuotedText(text) {
  return text.replace(
    /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (literal) => " ".repeat(literal.length)
  );
}

function hasInlineSourceMapComment(text, { lineComments = false } = {}) {
  const comments = lineComments
    ? /\/\/([^\r\n]*)|\/\*([\s\S]*?)\*\//g
    : /\/\*([\s\S]*?)\*\//g;
  for (const match of text.matchAll(comments)) {
    const content = match[1] ?? match[2] ?? "";
    if (inlineSourceMapDirective.test(content)) return true;
  }
  return false;
}

function findTextRuntimeLiteral(text) {
  const normalized = text.replace(/[\t\r\n]/g, "");
  if (advanceSignedQueryMarker(new Set(), normalized, false, "\"'`<>").unsafe) {
    return "signed MEO token";
  }
  const withoutEmptyQueryPrefixes = normalized.replace(
    /[?&]wmsAuthSign=(?=[&#"'`<>]|$)/gi,
    ""
  );
  return findFallbackCredentialLiteral(withoutEmptyQueryPrefixes);
}

function hasDuplicateJsonKey(text) {
  const contexts = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "\"") {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== "\"") {
        index += text[index] === "\\" ? 2 : 1;
      }
      index += 1;
      const context = contexts.at(-1);
      if (context?.type === "object" && context.expectingKey) {
        const key = JSON.parse(text.slice(start, index));
        if (context.keys.has(key)) return true;
        context.keys.add(key);
        context.expectingKey = false;
      }
      continue;
    }
    if (character === "{") {
      contexts.push({ type: "object", keys: new Set(), expectingKey: true });
    } else if (character === "[") {
      contexts.push({ type: "array" });
    } else if (character === "}" || character === "]") {
      contexts.pop();
    } else if (character === "," && contexts.at(-1)?.type === "object") {
      contexts.at(-1).expectingKey = true;
    }
    index += 1;
  }
  return false;
}

function jsonValueIsLiteral(value) {
  return value !== null && (typeof value !== "string" || value.length > 0);
}

function findJsonRuntimeLiteral(value, { skipValueKeys = new Set() } = {}) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (advanceSignedQueryMarker(new Set(), current).unsafe) return "signed MEO token";
      const literal = findDecodedCredentialLiteral(current);
      if (literal) return literal;
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (advanceSignedQueryMarker(new Set(), key).unsafe) return "signed MEO token";
      const keyLiteral = findDecodedCredentialLiteral(key);
      if (keyLiteral) return keyLiteral;
      const label = credentialLabel(key);
      if (label && jsonValueIsLiteral(child)) return label;
      if (!skipValueKeys.has(key)) pending.push(child);
    }
  }
  return null;
}

function findSourceMapRuntimeLiteral(value, diagnostics) {
  const jsonLiteral = findJsonRuntimeLiteral(value, {
    skipValueKeys: new Set(["sourcesContent"])
  });
  if (jsonLiteral) return jsonLiteral;
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (Object.hasOwn(current, "sourcesContent")) {
      if (!Array.isArray(current.sourcesContent)) return "invalid source map";
      for (const content of current.sourcesContent) {
        if (content === null) continue;
        if (typeof content !== "string") return "invalid source map";
        const finding = findBundledRuntimeLiteral(content, {
          path: "source.js",
          diagnostics
        });
        if (finding) return finding;
      }
    }
    pending.push(...(
      Array.isArray(current)
        ? current
        : Object.entries(current)
          .filter(([key]) => key !== "sourcesContent")
          .map(([, child]) => child)
    ));
  }
  return null;
}

function packageTextKind(path) {
  const lowerPath = path.toLowerCase();
  if (/\.map$/.test(lowerPath)) return "source-map";
  if (/\.(?:json|webmanifest)$/.test(lowerPath)) return "json";
  if (/\.svgz?$/.test(lowerPath)) return "svg";
  if (/\.(?:xml|xhtml|xhtm?)$/.test(lowerPath)) return "xml";
  if (/\.(?:html?|shtml?)$/.test(lowerPath)) return "html";
  if (/\.(?:[cm]?js|jsx)$/.test(lowerPath)) return "javascript";
  return path ? "text" : "unknown";
}

function findBundledRuntimeLiteral(text, { path = "", diagnostics } = {}) {
  if (typeof text !== "string") return null;
  if (diagnostics) {
    diagnostics.queryCompositionRoots ??= 0;
    diagnostics.staticFragmentNodes ??= 0;
  }
  const kind = packageTextKind(path);
  if (kind === "svg") return "unsupported SVG";
  if (kind === "xml") return "unsupported XML";
  if (kind === "json" || kind === "source-map") {
    try {
      const value = JSON.parse(text);
      if (hasDuplicateJsonKey(text)) return "duplicate JSON key";
      return kind === "source-map"
        ? findSourceMapRuntimeLiteral(value, diagnostics)
        : findJsonRuntimeLiteral(value);
    } catch {
      return findFallbackCredentialLiteral(text)
        ?? (kind === "source-map" ? "invalid source map" : "invalid JSON");
    }
  }
  if (kind === "html" || (kind === "unknown" && /<script\b/i.test(text))) {
    return findHtmlRuntimeLiteral(text, {
      diagnostics,
      scanContent: findBundledRuntimeLiteral,
      scanText: findTextRuntimeLiteral
    });
  }
  if (kind === "text") {
    if (hasInlineSourceMapComment(withoutQuotedText(text))) return "inline source map";
    return findTextRuntimeLiteral(text);
  }
  let ast;
  try {
    ast = parseAst(text);
  } catch {
    return findTextRuntimeLiteral(text) ?? (kind === "javascript" ? "invalid JavaScript" : null);
  }
  if (hasInlineSourceMapComment(withoutAstLiteralText(text, ast), { lineComments: true })) {
    return "inline source map";
  }
  return findAstCredentialLiteral(ast, diagnostics) ?? findAstSignedQuery(ast, diagnostics);
}

export { findBundledRuntimeLiteral };
