import { isDirectRuntimeReference, staticStringValue } from "./ast-utils.js";

const signedQueryMarker = "wmsauthsign=";
const staticFragmentsCache = new WeakMap();

function flattenConcatenation(node) {
  const parts = [];
  const pending = [node];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value?.type === "BinaryExpression" && value.operator === "+") {
      pending.push(value.right, value.left);
    } else {
      parts.push(value);
    }
  }
  return parts;
}

function staticFragments(node, diagnostics) {
  if (!node || typeof node !== "object") return [];
  if (staticFragmentsCache.has(node)) return staticFragmentsCache.get(node);
  const fragments = [];
  const pending = [node];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
      continue;
    }
    if (value === null || typeof value !== "object" || typeof value.type !== "string") continue;
    if (diagnostics) {
      diagnostics.staticFragmentNodes = (diagnostics.staticFragmentNodes ?? 0) + 1;
    }
    if (isDirectRuntimeReference(value)) {
      let reference = value;
      while (reference) {
        while (["ChainExpression", "ParenthesizedExpression"].includes(reference?.type)) {
          reference = reference.expression;
        }
        if (reference?.type !== "MemberExpression") break;
        if (reference.computed) pending.push(reference.property);
        reference = reference.object;
      }
      continue;
    }
    const text = staticStringValue(value);
    if (text !== null) {
      fragments.push({ start: value.start, text });
      continue;
    }
    const children = Object.entries(value)
      .filter(([key]) => !["start", "end", "loc"].includes(key))
      .map(([, child]) => child);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  fragments.sort((left, right) => left.start - right.start);
  staticFragmentsCache.set(node, fragments);
  return fragments;
}

function markerState(progress, tainted = false) {
  return progress + (tainted ? signedQueryMarker.length + 1 : 0);
}

function markerProgress(state) {
  return state % (signedQueryMarker.length + 1);
}

function hasCompletedMarker(states, taintedOnly = false) {
  return [...states].some((state) =>
    markerProgress(state) === signedQueryMarker.length
    && (!taintedOnly || state > signedQueryMarker.length)
  );
}

function advanceSignedQueryMarker(states, text, taint = false) {
  let current = new Set(states);
  for (const rawCharacter of text.replace(/[\t\r\n]/g, "")) {
    const character = rawCharacter.toLowerCase();
    const next = new Set();
    if (character === "?" || character === "&") next.add(markerState(0, taint));
    for (const state of current) {
      const progress = markerProgress(state);
      if (progress === signedQueryMarker.length) {
        if (!/[&#]/.test(character)) return { unsafe: true, states: next };
      } else if (character === signedQueryMarker[progress]) {
        next.add(markerState(progress + 1, taint || state > signedQueryMarker.length));
      }
    }
    current = next;
  }
  return { unsafe: false, states: current };
}

function advanceOptionalFragments(states, node, diagnostics) {
  let possible = new Set(states);
  const fragments = staticFragments(node, diagnostics);
  for (const { text } of fragments) {
    const advanced = advanceSignedQueryMarker(possible, text, true);
    if (advanced.unsafe) return advanced;
    possible = new Set([...possible, ...advanced.states]);
  }
  return { unsafe: false, states: possible, sawStatic: fragments.length > 0 };
}

function signedQueryCompositionIsUnsafe(nodes, diagnostics) {
  let states = new Set();
  for (const node of nodes) {
    const text = staticStringValue(node);
    if (text !== null) {
      const advanced = advanceSignedQueryMarker(states, text);
      if (advanced.unsafe) return true;
      states = advanced.states;
      continue;
    }
    if (isDirectRuntimeReference(node)) {
      if (hasCompletedMarker(states, true)) return true;
      states.clear();
      continue;
    }
    if (hasCompletedMarker(states)) return true;
    const advanced = advanceOptionalFragments(states, node, diagnostics);
    if (advanced.unsafe) return true;
    states = advanced.sawStatic ? advanced.states : new Set();
  }
  return hasCompletedMarker(states, true);
}

function templateParts(node) {
  return node.quasis.flatMap((quasi, index) =>
    index < node.expressions.length ? [quasi, node.expressions[index]] : [quasi]
  );
}

function opaqueSignedQueryIsUnsafe(node, diagnostics) {
  const advanced = advanceOptionalFragments(new Set(), node, diagnostics);
  return advanced.unsafe || hasCompletedMarker(advanced.states);
}

function isSignedQueryComposition(node) {
  return ["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node?.type)
    || (node?.type === "BinaryExpression" && node.operator === "+")
    || node?.type === "TemplateLiteral";
}

function containsConcreteSignedLiteral(node) {
  const pending = [node];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (value === null || typeof value !== "object" || typeof value.type !== "string") continue;
    if (value.type === "Literal" || value.type === "TemplateElement") {
      const text = staticStringValue(value);
      if (text !== null && advanceSignedQueryMarker(new Set(), text).unsafe) return true;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!["start", "end", "loc"].includes(key)) pending.push(child);
    }
  }
  return false;
}

function findAstSignedQuery(ast, diagnostics) {
  const pending = [ast];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (value === null || typeof value !== "object" || typeof value.type !== "string") continue;
    const node = value;
    if (isSignedQueryComposition(node)) {
      if (diagnostics) {
        diagnostics.queryCompositionRoots = (diagnostics.queryCompositionRoots ?? 0) + 1;
      }
      if (containsConcreteSignedLiteral(node)) return "signed MEO token";
      if (
        ["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node.type)
          ? opaqueSignedQueryIsUnsafe(node, diagnostics)
          : node.type === "BinaryExpression"
            ? signedQueryCompositionIsUnsafe(flattenConcatenation(node), diagnostics)
            : signedQueryCompositionIsUnsafe(templateParts(node), diagnostics)
      ) return "signed MEO token";
      continue;
    }
    if (node.type === "Literal" || node.type === "TemplateElement") {
      const text = staticStringValue(node);
      if (text !== null && advanceSignedQueryMarker(new Set(), text).unsafe) {
        return "signed MEO token";
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (!["start", "end", "loc"].includes(key)) pending.push(child);
    }
  }
  return null;
}

export { advanceSignedQueryMarker, findAstSignedQuery };
