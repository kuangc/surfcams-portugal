import {staticValue, unknownStaticValue} from "./ast-utils.js";
import {unwrapExpression} from "./credential-call-view.js";
import {
  mergeSelectionOutcomes,
  relationForSelectionOutcome,
  selectionNode,
  selectionOutcome
} from "./static-selection-outcome.js";
import {
  createStaticPrimitiveOutcomeAnalyzer
} from "./static-primitive-outcomes.js";
import {
  selectionForArrayOutcomes,
  staticObjectSelection
} from "./static-object-selection.js";

function unwrapMemberWrappers(value) {
  return unwrapExpression(value);
}

function relationForMemberSelection(selection, relationForNode) {
  return relationForSelectionOutcome(selection, relationForNode);
}

function selectStaticRoot(
  object,
  key,
  state,
  diagnostics,
  options
) {
  const root = unwrapMemberWrappers(object);
  const index = Number(key);
  const arrayKey = key === "length"
    || Number.isInteger(index) && index >= 0 && String(index) === key;
  const elements = key === "length" ? options.arrayElementsOf?.(root) : null;
  if (key === "length" && elements) {
    return selectionNode({type: "Literal", value: elements.length});
  }
  if (arrayKey && key !== "length") {
    const result = selectionForArrayOutcomes(
      options.arrayIndexOutcomesOf?.(root, index)
    );
    if (result) return result;
  }
  if (root?.type === "ArrayExpression") {
    return selectionOutcome({undefinedOutcome: true});
  }
  const objectResult = staticObjectSelection(
    root,
    key,
    state,
    diagnostics,
    options
  );
  if (objectResult) return objectResult;
  const primitive = staticValue(root);
  return primitive === unknownStaticValue
    ? selectionOutcome({dynamic: true})
    : selectionOutcome({undefinedOutcome: true});
}

function mapResolvedSelectionNodes(
  outcome,
  mapper,
  state,
  diagnostics,
  options,
  {keyAlternatives = false} = {}
) {
  if (!outcome) return selectionOutcome({dynamic: true});
  let result = selectionOutcome({
    conservative: outcome.conservative,
    dynamic: outcome.dynamic,
    undefinedOutcome: outcome.undefinedOutcome
  });
  if (result.conservative) return result;
  const pending = [...outcome.nodes].reverse();
  while (pending.length > 0 && !result.conservative) {
    const node = unwrapMemberWrappers(pending.pop());
    if (diagnostics) {
      const counter = keyAlternatives
        ? "staticSelectionKeyAlternativeSteps"
        : "staticSelectionAlternativeSteps";
      diagnostics[counter] = (diagnostics[counter] ?? 0) + 1;
    }
    if (node?.type === "MemberExpression") {
      if (diagnostics) {
        diagnostics.staticSelectionResolvedMemberSteps =
          (diagnostics.staticSelectionResolvedMemberSteps ?? 0) + 1;
      }
      const nested = staticLiteralMemberSelection(
        node,
        state,
        diagnostics,
        options
      ) ?? selectionOutcome({dynamic: true});
      result = mergeSelectionOutcomes(result, {
        conservative: nested.conservative,
        dynamic: nested.dynamic,
        nodes: [],
        undefinedOutcome: nested.undefinedOutcome
      });
      pending.push(...nested.nodes.slice().reverse());
      continue;
    }
    result = mergeSelectionOutcomes(result, mapper(node));
  }
  return result;
}

const unknownArrayKeyString = Symbol("unknown array key string");

function staticArrayKeyString(root, state, options) {
  const value = unwrapMemberWrappers(root);
  if (!value || typeof value !== "object" || !options.arrayElementsOf) return null;
  state.arrayKeyStrings ??= new WeakMap();
  if (state.arrayKeyStrings.has(value)) {
    const cached = state.arrayKeyStrings.get(value);
    return cached === unknownArrayKeyString ? null : cached;
  }
  const initialElements = options.arrayElementsOf(value);
  if (!initialElements) return null;
  const pending = [{expanded: false, elements: initialElements, node: value}];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (state.arrayKeyStrings.has(frame.node)) continue;
    if (!frame.expanded) {
      pending.push({...frame, expanded: true});
      for (let index = frame.elements.length - 1; index >= 0; index -= 1) {
        const element = unwrapMemberWrappers(frame.elements[index]);
        if (!element || state.arrayKeyStrings.has(element)) continue;
        const nested = options.arrayElementsOf(element);
        if (nested) pending.push({expanded: false, elements: nested, node: element});
      }
      continue;
    }
    const parts = [];
    let known = true;
    for (const rawElement of frame.elements) {
      const element = unwrapMemberWrappers(rawElement);
      if (element === null) {
        parts.push("");
        continue;
      }
      if (state.arrayKeyStrings.has(element)) {
        const nested = state.arrayKeyStrings.get(element);
        if (nested === unknownArrayKeyString) {
          known = false;
          break;
        }
        parts.push(nested);
        continue;
      }
      const primitive = staticValue(element);
      if (primitive === unknownStaticValue) {
        known = false;
        break;
      }
      parts.push(primitive == null ? "" : String(primitive));
    }
    state.arrayKeyStrings.set(
      frame.node,
      known ? parts.join(",") : unknownArrayKeyString
    );
  }
  const result = state.arrayKeyStrings.get(value);
  return result === unknownArrayKeyString ? null : result;
}

function selectionForKey(
  member,
  state,
  diagnostics,
  options
) {
  if (!member.computed) {
    return selectionNode({type: "Literal", value: member.property?.name});
  }
  const property = unwrapMemberWrappers(member.property);
  state.staticKeyOutcomeAnalyzer ??= createStaticPrimitiveOutcomeAnalyzer({
    coerceStatic: (node) => {
      const value = staticArrayKeyString(node, state, options);
      return value === null ? {known: false} : {known: true, value};
    },
    diagnosticPrefix: "staticKeyOutcome",
    diagnostics,
    selectedOutcome: (node) => staticLiteralMemberSelection(
      node,
      state,
      diagnostics,
      options
    )
  });
  const outcome = state.staticKeyOutcomeAnalyzer.outcomes(property);
  return selectionOutcome({
    conservative: outcome.conservative,
    dynamic: outcome.dynamic || outcome.opaque,
    nodes: outcome.values.map((value) => ({type: "Literal", value}))
  });
}

function propertyKeyValue(node) {
  if (node?.type === "Literal" && Object.hasOwn(node, "value")) {
    return {known: true, value: String(node.value)};
  }
  const value = staticValue(node);
  return value === unknownStaticValue
    ? {known: false}
    : {known: true, value: String(value)};
}

function selectOutcomeByKey(
  outcome,
  key,
  state,
  diagnostics,
  options
) {
  return mapResolvedSelectionNodes(
    outcome,
    (alternative) => selectStaticRoot(
      alternative,
      key,
      state,
      diagnostics,
      options
    ),
    state,
    diagnostics,
    options
  );
}

function staticLiteralMemberSelection(
  node,
  state,
  diagnostics,
  {arrayElementsOf, arrayIndexOutcomesOf} = {}
) {
  const member = node?.type === "MemberExpression" ? node : null;
  if (!member) return null;
  const options = {arrayElementsOf, arrayIndexOutcomesOf};
  if (state.members.has(member)) {
    if (diagnostics) {
      diagnostics.staticLiteralSelectorCacheHits =
        (diagnostics.staticLiteralSelectorCacheHits ?? 0) + 1;
    }
    return state.members.get(member);
  }

  const pending = [];
  let current = member;
  while (current?.type === "MemberExpression" && !state.members.has(current)) {
    pending.push(current);
    const object = unwrapMemberWrappers(current.object);
    current = object?.type === "MemberExpression" ? object : null;
  }
  while (pending.length > 0) {
    const selectedMember = pending.pop();
    if (diagnostics) {
      diagnostics.staticLiteralSelectorSteps =
        (diagnostics.staticLiteralSelectorSteps ?? 0) + 1;
      diagnostics.staticSelectionOperations =
        (diagnostics.staticSelectionOperations ?? 0) + 1;
    }
    const keyOutcome = selectionForKey(
      selectedMember,
      state,
      diagnostics,
      options
    );
    const object = unwrapMemberWrappers(selectedMember.object);
    let objectOutcome;
    if (object?.type === "MemberExpression") {
      const alreadyCached = state.members.has(object);
      objectOutcome = state.members.get(object)
        ?? staticLiteralMemberSelection(object, state, diagnostics, options);
      if (alreadyCached && diagnostics) {
        diagnostics.staticLiteralSelectorCacheHits =
          (diagnostics.staticLiteralSelectorCacheHits ?? 0) + 1;
      }
    } else {
      objectOutcome = selectionNode(object);
    }
    let result = selectionOutcome({
      conservative: keyOutcome.conservative,
      dynamic: keyOutcome.dynamic,
      undefinedOutcome: keyOutcome.undefinedOutcome
    });
    for (const keyNode of keyOutcome.nodes) {
      const key = propertyKeyValue(keyNode);
      if (!key.known) {
        result = mergeSelectionOutcomes(
          result,
          selectionOutcome({dynamic: true})
        );
        continue;
      }
      result = mergeSelectionOutcomes(
        result,
        selectOutcomeByKey(
          objectOutcome,
          key.value,
          state,
          diagnostics,
          options
        )
      );
      if (result.conservative) break;
    }
    state.members.set(
      selectedMember,
      result ?? selectionOutcome({dynamic: true})
    );
  }
  return state.members.get(member) ?? selectionOutcome({dynamic: true});
}

function staticMemberSelectionRelation(
  node,
  state,
  diagnostics,
  options,
  relationForNode
) {
  return relationForMemberSelection(
    staticLiteralMemberSelection(node, state, diagnostics, options),
    relationForNode
  );
}

export {
  relationForMemberSelection,
  staticLiteralMemberSelection,
  staticMemberSelectionRelation,
  unwrapMemberWrappers
};
