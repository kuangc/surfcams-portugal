import { decodeHTML, decodeHTMLAttribute } from "entities";

const htmlRawTextElements = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "style",
  "title",
  "textarea",
  "xmp"
]);

const javaScriptMimeEssences = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript"
]);

function htmlTagEnd(text, start) {
  let state = "beforeAttribute";
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) {
        quote = null;
        state = "beforeAttribute";
      }
      continue;
    }
    if (character === ">") {
      return index + 1;
    }
    if (character === "\"" || character === "'") {
      if (state !== "beforeValue") return -1;
      quote = character;
      continue;
    }
    if (
      character === "/"
      && ["beforeAttribute", "attributeName", "afterAttributeName"].includes(state)
    ) {
      if (text[index + 1] !== ">") return -1;
      continue;
    }
    const whitespace = /[\t\n\f\r ]/.test(character);
    if (state === "beforeAttribute") {
      if (!whitespace && character !== "/") state = "attributeName";
    } else if (state === "attributeName") {
      if (whitespace) state = "afterAttributeName";
      else if (character === "=") state = "beforeValue";
    } else if (state === "afterAttributeName") {
      if (character === "=") state = "beforeValue";
      else if (!whitespace && character !== "/") state = "attributeName";
    } else if (state === "beforeValue") {
      if (!whitespace) state = "unquotedValue";
    } else if (state === "unquotedValue" && whitespace) {
      state = "beforeAttribute";
    }
  }
  return -1;
}

function htmlClosingTag(text, lowerText, tagName, contentStart) {
  let closeStart = lowerText.indexOf(`</${tagName}`, contentStart);
  while (
    closeStart >= 0
    && !/[\t\n\f\r />]/.test(lowerText[closeStart + tagName.length + 2] ?? ">")
  ) closeStart = lowerText.indexOf(`</${tagName}`, closeStart + tagName.length + 2);
  if (closeStart < 0) return null;
  const end = htmlTagEnd(text, closeStart + tagName.length + 2);
  return end < 0 ? { invalid: true } : { closeStart, end };
}

function htmlScriptBlocks(text) {
  const lowerText = text.toLowerCase();
  const blocks = [];
  const tags = [];
  let cursor = 0;
  while (cursor < text.length) {
    const openStart = text.indexOf("<", cursor);
    if (openStart < 0) break;
    if (lowerText.startsWith("<!--", openStart)) {
      if (text[openStart + 4] === ">") {
        cursor = openStart + 5;
        continue;
      }
      if (lowerText.startsWith("<!--->", openStart)) {
        cursor = openStart + 6;
        continue;
      }
      const standardEnd = lowerText.indexOf("-->", openStart + 4);
      const bangEnd = lowerText.indexOf("--!>", openStart + 4);
      const commentEnd = [standardEnd, bangEnd]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0];
      if (commentEnd === undefined) return { blocks, tags, invalid: true };
      cursor = commentEnd + (commentEnd === bangEnd ? 4 : 3);
      continue;
    }
    if (lowerText.startsWith("<![cdata[", openStart)) {
      return { blocks, tags, invalid: true };
    }
    const nameMatch = /^<\/?([a-z][^\t\n\f\r />\0]*)/i.exec(text.slice(openStart));
    if (!nameMatch) {
      const doctype = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(
        text.slice(openStart)
      );
      if (doctype) {
        cursor = openStart + doctype[0].length;
      } else if (lowerText.startsWith("<!", openStart) || lowerText.startsWith("<?", openStart)) {
        return { blocks, tags, invalid: true };
      } else {
        cursor = openStart + 1;
      }
      continue;
    }
    const tagName = nameMatch[1].toLowerCase();
    const contentStart = htmlTagEnd(text, openStart + nameMatch[0].length);
    if (contentStart < 0) return { blocks, tags, invalid: true };
    if (nameMatch[0].includes("/")) {
      cursor = contentStart;
      continue;
    }
    if (["math", "svg"].includes(tagName)) return { blocks, tags, invalid: true };
    tags.push({ openTag: text.slice(openStart, contentStart), openStart, tagName });
    if (tagName === "plaintext") break;
    if (tagName !== "script" && !htmlRawTextElements.has(tagName)) {
      cursor = contentStart;
      continue;
    }
    const closingTag = htmlClosingTag(text, lowerText, tagName, contentStart);
    if (closingTag?.invalid) return { blocks, tags, invalid: true };
    const contentEnd = closingTag?.closeStart ?? text.length;
    const end = closingTag?.end ?? text.length;
    if (!["script", "style"].includes(tagName)) {
      cursor = end;
      continue;
    }
    const content = text.slice(contentStart, contentEnd);
    if (tagName === "script" && /<!--[\s\S]*<script(?=[\t\n\f\r />])/i.test(content)) {
      return { blocks, tags, invalid: true };
    }
    blocks.push({
      openTag: text.slice(openStart, contentStart),
      tagName,
      content,
      contentStart,
      contentEnd,
      end
    });
    cursor = end;
  }
  return { blocks, tags, invalid: false };
}

function htmlAttributes(openTag) {
  const attributes = [];
  const tagMatch = /^<[a-z][^\t\n\f\r />\0]*/i.exec(openTag);
  if (!tagMatch) return attributes;
  let index = tagMatch[0].length;
  while (index < openTag.length) {
    while (/[\t\n\f\r ]/.test(openTag[index] ?? "")) index += 1;
    if ([">", "/"].includes(openTag[index])) break;
    const nameStart = index;
    while (!/[\t\n\f\r =/>]/.test(openTag[index] ?? ">")) index += 1;
    const name = openTag.slice(nameStart, index).toLowerCase();
    while (/[\t\n\f\r ]/.test(openTag[index] ?? "")) index += 1;
    let value = "";
    let valueStart = null;
    let valueEnd = null;
    if (openTag[index] === "=") {
      index += 1;
      while (/[\t\n\f\r ]/.test(openTag[index] ?? "")) index += 1;
      const quote = ["\"", "'"].includes(openTag[index]) ? openTag[index] : null;
      if (quote) {
        index += 1;
        valueStart = index;
        while (index < openTag.length && openTag[index] !== quote) index += 1;
        valueEnd = index;
        value = openTag.slice(valueStart, index);
        if (openTag[index] === quote) index += 1;
      } else {
        valueStart = index;
        while (!/[\t\n\f\r >]/.test(openTag[index] ?? ">")) index += 1;
        valueEnd = index;
        value = openTag.slice(valueStart, index);
      }
    }
    attributes.push({ name, value, valueStart, valueEnd });
  }
  return attributes;
}

function htmlScriptContentKind(openTag) {
  const attributeValue = htmlAttributes(openTag)
    .find(({ name }) => name === "type")?.value ?? null;
  if (attributeValue === null) return "javascript";
  const type = decodeHTMLAttribute(attributeValue).trim().toLowerCase();
  if (!type || type === "module") return "javascript";
  if (type === "importmap" || type === "speculationrules") return "json";
  const essence = type.split(";", 1)[0].trim();
  if (essence === "application/json" || essence.endsWith("+json")) return "json";
  if (javaScriptMimeEssences.has(essence)) return "javascript";
  return "text";
}

function findHtmlRuntimeLiteral(
  text,
  { diagnostics, scanContent, scanText, depth = 0 }
) {
  if (depth > 8 || text.includes("\0")) return "invalid HTML";
  const { blocks: scripts, tags, invalid } = htmlScriptBlocks(text);
  if (invalid) return "invalid HTML";
  const structuredAttributeRanges = [];
  for (const tag of tags) {
    for (const { name, value, valueStart, valueEnd } of htmlAttributes(tag.openTag)) {
      const decodedValue = decodeHTMLAttribute(value);
      let attributeLiteral = null;
      if (name === "srcdoc") {
        structuredAttributeRanges.push([
          tag.openStart + valueStart,
          tag.openStart + valueEnd
        ]);
        attributeLiteral = findHtmlRuntimeLiteral(decodedValue, {
          diagnostics,
          scanContent,
          scanText,
          depth: depth + 1
        });
      } else if (/^on[a-z]/i.test(name)) {
        structuredAttributeRanges.push([
          tag.openStart + valueStart,
          tag.openStart + valueEnd
        ]);
        attributeLiteral = scanContent(
          `function __htmlEventHandler(){${decodedValue}\n}`,
          { path: "inline-handler.js", diagnostics }
        );
      } else {
        const normalizedUrlValue = decodedValue.replace(/[\t\r\n]/g, "").trimStart();
        const executableDataUrl = /^data:/i.test(normalizedUrlValue) && (
          (["embed", "frame", "iframe", "script"].includes(tag.tagName) && name === "src")
          || (tag.tagName === "object" && name === "data")
        );
        if (executableDataUrl) return "executable data URL";
        if (!/^javascript:/i.test(normalizedUrlValue)) continue;
        structuredAttributeRanges.push([
          tag.openStart + valueStart,
          tag.openStart + valueEnd
        ]);
        let javaScriptUrlSource;
        try {
          javaScriptUrlSource = decodeURIComponent(
            normalizedUrlValue.slice("javascript:".length)
          );
        } catch {
          return "invalid JavaScript URL";
        }
        attributeLiteral = scanContent(javaScriptUrlSource, {
          path: "javascript-url.js",
          diagnostics
        });
      }
      if (attributeLiteral) return attributeLiteral;
    }
  }
  const outsideCharacters = text.split("");
  for (const [start, end] of structuredAttributeRanges) {
    for (let index = start; index < end; index += 1) outsideCharacters[index] = " ";
  }
  const outsideSource = outsideCharacters.join("");
  let outsideScripts = "";
  let cursor = 0;
  for (const script of scripts) {
    outsideScripts += outsideSource.slice(cursor, script.contentStart);
    outsideScripts += outsideSource.slice(script.contentEnd, script.end);
    cursor = script.end;
    const kind = script.tagName === "style" ? "css" : htmlScriptContentKind(script.openTag);
    const scriptLiteral = kind === "text"
      ? scanText(script.content)
      : scanContent(script.content, {
        path: kind === "json"
          ? "inline-script.json"
          : kind === "css" ? "inline-style.css" : "inline-script.js",
        diagnostics
      });
    if (scriptLiteral) return scriptLiteral;
  }
  outsideScripts += outsideSource.slice(cursor);
  return scanText(decodeHTML(outsideScripts));
}

export { findHtmlRuntimeLiteral };
