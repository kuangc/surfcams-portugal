import {
  staticValue,
  unknownStaticValue
} from "./ast-utils.js";
import {
  composeRelationList,
  composeRelations,
  dynamicOutputRelation,
  emptyOutputRelation,
  relationForStaticText,
  relationIsUnsafe,
  unionRelations
} from "./signed-query-relation.js";
import {
  opaqueOutputRelation,
  staticPrimitive
} from "./signed-query-producers.js";
import {staticArrayStringRelation} from "./static-array-producers.js";
import {
  arrayHole,
  materializeArray,
  staticArrayElements
} from "./static-array-view.js";
import {staticArrayIndexOutcomes} from "./static-array-index.js";
import {
  relationForMemberSelection,
  staticLiteralMemberSelection,
  staticMemberSelectionRelation,
  unwrapMemberWrappers
} from "./static-member-selection.js";
import {singleSelectionNode} from "./static-selection-outcome.js";
import {shadowedIdentifiers} from "./lexical-binding-scan.js";

const signedQueryName = "wmsauthsign";
const completedMarkerProgress = signedQueryName.length + 1;
const percentStateCount = 18;
const markerProgressCount = completedMarkerProgress + 1;
const taintedStateOffset = markerProgressCount * percentStateCount;
const trackedGlobalNames = [
  "Array",
  "Object",
  "Reflect",
  "String",
  "URLSearchParams",
  "globalThis",
  "self",
  "undefined",
  "window"
];

function markerState(progress, tainted = false, percentState = 0) {
  return progress * percentStateCount
    + percentState
    + (tainted ? taintedStateOffset : 0);
}

function markerProgress(state) {
  return Math.floor((state % taintedStateOffset) / percentStateCount);
}

function markerPercentState(state) {
  return state % percentStateCount;
}

function hexNibble(character) {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function advanceSignedQueryMarker(states, text, taint = false, valueTerminators = "") {
  let current = new Set(states);
  for (const rawCharacter of text.replace(/[\t\r\n]/g, "")) {
    const character = rawCharacter.toLowerCase();
    const next = new Set();
    if (character === "?" || character === "&") next.add(markerState(0, taint));
    for (const state of current) {
      const progress = markerProgress(state);
      const percentState = markerPercentState(state);
      const stateIsTainted = taint || state >= taintedStateOffset;
      if (progress === completedMarkerProgress) {
        if (!/[&#]/.test(character) && !valueTerminators.includes(rawCharacter)) {
          return {unsafe: true, states: next};
        }
        continue;
      }
      if (percentState === 1) {
        const nibble = hexNibble(rawCharacter);
        if (nibble !== -1) next.add(markerState(progress, stateIsTainted, nibble + 2));
        continue;
      }
      if (percentState >= 2) {
        const nibble = hexNibble(rawCharacter);
        if (nibble === -1) continue;
        const decoded = (percentState - 2) * 16 + nibble;
        if (
          decoded <= 0x7f
          && String.fromCharCode(decoded).toLowerCase() === signedQueryName[progress]
        ) {
          next.add(markerState(progress + 1, stateIsTainted));
        }
        continue;
      }
      if (progress === signedQueryName.length) {
        if (character === "=") next.add(markerState(completedMarkerProgress, stateIsTainted));
      } else if (character === "%") {
        next.add(markerState(progress, stateIsTainted, 1));
      } else if (character === signedQueryName[progress]) {
        next.add(markerState(progress + 1, stateIsTainted));
      }
    }
    current = next;
  }
  return {unsafe: false, states: current};
}

function templateParts(node) {
  return node.quasis.flatMap((quasi, index) =>
    index < node.expressions.length ? [quasi, node.expressions[index]] : [quasi]
  );
}

function isSignedQueryComposition(node) {
  return ["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node?.type)
    || (node?.type === "BinaryExpression" && node.operator === "+")
    || node?.type === "TemplateLiteral";
}

function concreteLiteralChildren(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || typeof value !== "object" || typeof value.type !== "string") return [];
  return Object.entries(value)
    .filter(([key]) => !["start", "end", "loc"].includes(key))
    .map(([, child]) => child)
    .filter((child) =>
      Array.isArray(child)
      || child !== null && typeof child === "object" && typeof child.type === "string"
    );
}

function summaryRelation(node, summaries) {
  if (!node || typeof node !== "object") return dynamicOutputRelation;
  if (summaries.has(node)) return summaries.get(node).relation;
  const value = staticValue(node);
  return value === unknownStaticValue
    ? dynamicOutputRelation
    : relationForStaticText(String(value));
}

function outputRelation(
  node,
  summaries,
  shadowedUndefined,
  diagnostics,
  producerState
) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return dynamicOutputRelation;
  }
  producerState.staticMemberSelectionState ??= {
    members: new WeakMap(),
    objects: new WeakMap()
  };
  const memberSelectionState = producerState.staticMemberSelectionState;
  let producerContext;
  const selectionOptions = {
    arrayElementsOf: (value) => {
      const view = staticArrayElements(value, producerContext);
      if (!view || view.variableLength) return null;
      return materializeArray(view, producerContext).map((element) =>
        element === arrayHole ? null : element
      );
    },
    arrayIndexOutcomesOf: (value, index) =>
      staticArrayIndexOutcomes(value, index, producerContext)
  };
  producerContext = {
    coercionTarget: (value) => {
      const target = unwrapMemberWrappers(value);
      if (target?.type !== "MemberExpression") return value;
      return singleSelectionNode(staticLiteralMemberSelection(
        target,
        memberSelectionState,
        diagnostics,
        selectionOptions
      )) ?? value;
    },
    diagnostics,
    primitiveOf: (value) => staticPrimitive(value, shadowedUndefined),
    producerState,
    relationOf: (part) => summaryRelation(part, summaries),
    relationForSelection: (selection, relationForNode) =>
      relationForMemberSelection(selection, relationForNode),
    selectionOf: (value) => {
      const target = unwrapMemberWrappers(value);
      return target?.type === "MemberExpression"
        ? staticLiteralMemberSelection(
          target,
          memberSelectionState,
          diagnostics,
          selectionOptions
        )
        : null;
    },
    shadowedBindings: shadowedUndefined
  };
  const coercedStringRelation = (value) => {
    const target = unwrapMemberWrappers(value);
    if (target?.type === "MemberExpression") {
      const selection = staticLiteralMemberSelection(
        target,
        memberSelectionState,
        diagnostics,
        selectionOptions
      );
      const selected = relationForMemberSelection(
        selection,
        (selectedValue) => staticArrayStringRelation(selectedValue, producerContext)
          ?? summaryRelation(selectedValue, summaries)
      );
      if (selected) return selected;
    }
    return staticArrayStringRelation(value, producerContext)
      ?? summaryRelation(value, summaries);
  };
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return composeRelations(
      coercedStringRelation(node.left),
      coercedStringRelation(node.right),
      diagnostics
    );
  }
  if (node.type === "TemplateLiteral") {
    return composeRelationList(
      templateParts(node).map(coercedStringRelation),
      diagnostics,
      emptyOutputRelation
    );
  }
  if (node.type === "MemberExpression") {
    const relation = staticMemberSelectionRelation(
      node,
      memberSelectionState,
      diagnostics,
      selectionOptions,
      (selectedValue) => summaryRelation(selectedValue, summaries)
    );
    if (relation) return relation;
  }
  const primitive = staticPrimitive(node, shadowedUndefined);
  if (primitive.known) return relationForStaticText(String(primitive.value), diagnostics);
  if (node.type === "ConditionalExpression") {
    const test = staticValue(node.test);
    if (test !== unknownStaticValue) {
      return summaryRelation(test ? node.consequent : node.alternate, summaries);
    }
    return unionRelations(
      summaryRelation(node.consequent, summaries),
      summaryRelation(node.alternate, summaries)
    );
  }
  if (node.type === "LogicalExpression") {
    const left = staticValue(node.left);
    if (left !== unknownStaticValue) {
      const useRight = node.operator === "&&" && Boolean(left)
        || node.operator === "||" && !left
        || node.operator === "??" && left === null;
      return summaryRelation(useRight ? node.right : node.left, summaries);
    }
    return unionRelations(
      summaryRelation(node.left, summaries),
      summaryRelation(node.right, summaries)
    );
  }
  if (node.type === "SequenceExpression") return summaryRelation(node.expressions.at(-1), summaries);
  if (node.type === "AssignmentPattern") {
    return unionRelations(dynamicOutputRelation, summaryRelation(node.right, summaries));
  }
  if (node.type === "AssignmentExpression") {
    if (node.operator === "=") return summaryRelation(node.right, summaries);
    if (["||=", "&&=", "??="].includes(node.operator)) {
      return unionRelations(dynamicOutputRelation, summaryRelation(node.right, summaries));
    }
    return dynamicOutputRelation;
  }
  if (node.type === "AwaitExpression" || node.type === "ParenthesizedExpression") {
    return summaryRelation(node.argument ?? node.expression, summaries);
  }
  if (node.type === "ChainExpression") return summaryRelation(node.expression, summaries);
  if (["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node.type)) {
    return opaqueOutputRelation(node, producerContext);
  }
  return dynamicOutputRelation;
}

function containsConcreteSignedLiteral(
  node,
  cache,
  shadowedUndefined,
  diagnostics,
  producerState
) {
  if (node === null || typeof node !== "object") return false;
  if (cache.has(node)) {
    if (diagnostics) {
      diagnostics.concreteLiteralCacheHits =
        (diagnostics.concreteLiteralCacheHits ?? 0) + 1;
    }
    return cache.get(node).unsafe;
  }
  const pending = [{expanded: false, node}];
  while (pending.length > 0) {
    const frame = pending.pop();
    const value = frame.node;
    if (value === null || typeof value !== "object" || cache.has(value)) continue;
    const children = concreteLiteralChildren(value);
    if (!frame.expanded) {
      pending.push({expanded: true, node: value});
      for (let index = children.length - 1; index >= 0; index -= 1) {
        if (!cache.has(children[index])) pending.push({expanded: false, node: children[index]});
      }
      continue;
    }
    if (diagnostics && isSignedQueryComposition(value)) {
      diagnostics.queryCompositionRoots = (diagnostics.queryCompositionRoots ?? 0) + 1;
    }
    if (diagnostics && value.type === "MemberExpression" && value.computed) {
      diagnostics.computedSelectorVisits = (diagnostics.computedSelectorVisits ?? 0) + 1;
    }
    const valueRelation = outputRelation(
      value,
      cache,
      shadowedUndefined,
      diagnostics,
      producerState
    );
    const unsafe = relationIsUnsafe(valueRelation)
      || children.some((child) => cache.get(child)?.unsafe);
    cache.set(value, {relation: valueRelation, unsafe});
    if (diagnostics) {
      diagnostics.concreteLiteralNodes = (diagnostics.concreteLiteralNodes ?? 0) + 1;
    }
  }
  return cache.get(node)?.unsafe ?? false;
}

function findAstSignedQuery(ast, diagnostics) {
  const summaryCache = new WeakMap();
  const producerState = {};
  const shadowedBindings = shadowedIdentifiers(ast, trackedGlobalNames, diagnostics);
  return containsConcreteSignedLiteral(
    ast,
    summaryCache,
    shadowedBindings,
    diagnostics,
    producerState
  )
    ? "signed MEO token"
    : null;
}

export {advanceSignedQueryMarker, findAstSignedQuery};
