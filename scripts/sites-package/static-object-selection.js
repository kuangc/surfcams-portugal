import {staticValue, unknownStaticValue} from "./ast-utils.js";
import {unwrapExpression} from "./credential-call-view.js";
import {
  mergeSelectionOutcomes,
  selectionNode,
  selectionOutcome
} from "./static-selection-outcome.js";

const noPrototypeSetter = Symbol("no static prototype setter");

function cacheEntry(cache, object, key) {
  const selections = cache.get(object);
  return selections?.has(key)
    ? {cached: true, value: selections.get(key)}
    : {cached: false};
}

function setCacheEntry(cache, object, key, selection) {
  let selections = cache.get(object);
  if (!selections) {
    selections = new Map();
    cache.set(object, selections);
  }
  selections.set(key, selection);
}

function missingOutcome() {
  return {...selectionOutcome(), missing: true};
}

function lookupOutcome(selection, {missing = false} = {}) {
  return {...selection, missing};
}

function combineLookupOutcomes(earlier, later) {
  if (!later.missing) return later;
  return {
    ...mergeSelectionOutcomes(later, earlier),
    missing: earlier.missing
  };
}

function getterSelection(value, diagnostics) {
  const body = value?.body;
  if (body?.type !== "BlockStatement") {
    return selectionOutcome({conservative: true});
  }
  const returns = [];
  const pending = [...body.body].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type === "ReturnStatement") {
      if (diagnostics) {
        diagnostics.staticGetterReturnInspections =
          (diagnostics.staticGetterReturnInspections ?? 0) + 1;
      }
      returns.push(node.argument);
      continue;
    }
    if ([
      "ArrowFunctionExpression",
      "ClassDeclaration",
      "ClassExpression",
      "FunctionDeclaration",
      "FunctionExpression"
    ].includes(node.type)) continue;
    for (const [key, child] of Object.entries(node)) {
      if (["start", "end", "loc"].includes(key)) continue;
      if (Array.isArray(child)) {
        for (let index = child.length - 1; index >= 0; index -= 1) {
          pending.push(child[index]);
        }
      } else if (child && typeof child === "object") {
        pending.push(child);
      }
    }
  }
  if (returns.length === 0) {
    return selectionOutcome({undefinedOutcome: true});
  }
  const outcome = mergeSelectionOutcomes(...returns.map(selectionNode));
  const terminal = body.body.at(-1)?.type === "ReturnStatement";
  if (!terminal && diagnostics) {
    diagnostics.staticGetterFallthroughOutcomes =
      (diagnostics.staticGetterFallthroughOutcomes ?? 0) + 1;
  }
  return {
    ...outcome,
    undefinedOutcome: outcome.undefinedOutcome || !terminal
  };
}

function propertySelection(property, diagnostics) {
  if (property.kind === "get") return getterSelection(property.value, diagnostics);
  if (property.kind === "set") {
    return selectionOutcome({undefinedOutcome: true});
  }
  return selectionNode(property.value);
}

function propertyKey(property) {
  return property.computed
    ? staticValue(property.key)
    : property.key.type === "Identifier" ? property.key.name : property.key.value;
}

function isPrototypeSetter(property) {
  if (
    property.type !== "Property"
    || property.computed
    || property.kind !== "init"
    || property.method
    || property.shorthand
  ) return false;
  return propertyKey(property) === "__proto__";
}

function arraySpreadOutcome(spread, key, arrayElementsOf, arrayIndexOutcomesOf) {
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || String(index) !== key) return null;
  const arrayOutcomes = arrayIndexOutcomesOf?.(spread, index);
  if (arrayOutcomes) {
    return {
      conservative: arrayOutcomes.conservative,
      dynamic: arrayOutcomes.dynamic,
      missing: arrayOutcomes.undefinedOutcome,
      nodes: arrayOutcomes.nodes,
      undefinedOutcome: false
    };
  }
  const elements = arrayElementsOf?.(spread);
  if (!elements) return null;
  return index < elements.length && elements[index]
    ? lookupOutcome(selectionNode(elements[index]))
    : missingOutcome();
}

function nonObjectSpreadOutcome(spread, key, arrayElementsOf, arrayIndexOutcomesOf) {
  const arrayOutcome = arraySpreadOutcome(
    spread,
    key,
    arrayElementsOf,
    arrayIndexOutcomesOf
  );
  if (arrayOutcome) return arrayOutcome;
  const primitive = staticValue(spread);
  if (primitive === unknownStaticValue) {
    return {...selectionOutcome({dynamic: true}), missing: true};
  }
  const index = Number(key);
  if (
    typeof primitive === "string"
    && Number.isInteger(index)
    && index >= 0
    && String(index) === key
    && index < primitive.length
  ) {
    return lookupOutcome(selectionNode({type: "Literal", value: primitive[index]}));
  }
  return missingOutcome();
}

function dataOutcomeBeforeSetter(outcome) {
  const canBePresent = outcome.conservative
    || outcome.dynamic
    || outcome.undefinedOutcome
    || outcome.nodes.length > 0
    || !outcome.missing;
  return {
    ...selectionOutcome({
      conservative: outcome.conservative,
      undefinedOutcome: canBePresent
    }),
    missing: outcome.missing
  };
}

function staticObjectOwnLookup(
  root,
  key,
  state,
  diagnostics,
  arrayElementsOf,
  arrayIndexOutcomesOf
) {
  const object = unwrapExpression(root);
  if (object?.type !== "ObjectExpression") return null;
  state.objects ??= new WeakMap();
  state.objectPrototypes ??= new WeakMap();
  const cached = cacheEntry(state.objects, object, key);
  if (cached.cached) return cached.value;
  const pending = [{expanded: false, object}];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (cacheEntry(state.objects, frame.object, key).cached) continue;
    if (!frame.expanded) {
      pending.push({...frame, expanded: true});
      for (let index = frame.object.properties.length - 1; index >= 0; index -= 1) {
        const property = frame.object.properties[index];
        const spread = property.type === "SpreadElement"
          ? unwrapExpression(property.argument)
          : null;
        if (
          spread?.type === "ObjectExpression"
          && !cacheEntry(state.objects, spread, key).cached
        ) pending.push({expanded: false, object: spread});
      }
      continue;
    }
    let outcome = missingOutcome();
    let prototype = noPrototypeSetter;
    let pendingSetter = false;
    for (let index = frame.object.properties.length - 1; index >= 0; index -= 1) {
      if (!outcome.missing) break;
      const property = frame.object.properties[index];
      if (diagnostics) {
        diagnostics.staticObjectSelectorSteps =
          (diagnostics.staticObjectSelectorSteps ?? 0) + 1;
      }
      if (isPrototypeSetter(property)) {
        prototype = property.value;
        continue;
      }
      if (property.type === "SpreadElement") {
        const spread = unwrapExpression(property.argument);
        let spreadOutcome;
        if (spread?.type === "ObjectExpression") {
          spreadOutcome = cacheEntry(state.objects, spread, key).value;
          if (diagnostics) {
            diagnostics.staticObjectSelectorCacheHits =
              (diagnostics.staticObjectSelectorCacheHits ?? 0) + 1;
          }
        } else {
          spreadOutcome = nonObjectSpreadOutcome(
            spread,
            key,
            arrayElementsOf,
            arrayIndexOutcomesOf
          );
        }
        if (pendingSetter) spreadOutcome = dataOutcomeBeforeSetter(spreadOutcome);
        outcome = combineLookupOutcomes(spreadOutcome, outcome);
        continue;
      }
      if (property.type !== "Property") continue;
      const candidateKey = propertyKey(property);
      const matches = candidateKey !== unknownStaticValue
        && String(candidateKey) === key;
      if (matches && property.kind === "set") {
        pendingSetter = true;
        if (diagnostics) {
          diagnostics.staticObjectDescriptorHalfMerges =
            (diagnostics.staticObjectDescriptorHalfMerges ?? 0) + 1;
        }
        continue;
      }
      let candidate = candidateKey === unknownStaticValue
        ? lookupOutcome(propertySelection(property, diagnostics), {missing: true})
        : matches
          ? lookupOutcome(propertySelection(property, diagnostics))
          : missingOutcome();
      if (pendingSetter && property.kind !== "get") {
        candidate = dataOutcomeBeforeSetter(candidate);
      }
      outcome = combineLookupOutcomes(candidate, outcome);
    }
    if (pendingSetter && outcome.missing) {
      outcome = combineLookupOutcomes(
        lookupOutcome(selectionOutcome({undefinedOutcome: true})),
        outcome
      );
    }
    state.objectPrototypes.set(frame.object, prototype);
    setCacheEntry(state.objects, frame.object, key, outcome);
  }
  return cacheEntry(state.objects, object, key).value;
}

function terminalPrototypeOutcome(prototype) {
  if (prototype === noPrototypeSetter) return missingOutcome();
  const value = staticValue(prototype);
  return value === unknownStaticValue
    ? {...selectionOutcome({dynamic: true}), missing: true}
    : missingOutcome();
}

function staticObjectLookup(
  root,
  key,
  state,
  diagnostics,
  arrayElementsOf,
  arrayIndexOutcomesOf
) {
  const object = unwrapExpression(root);
  if (object?.type !== "ObjectExpression") return null;
  state.objectLookups ??= new WeakMap();
  const initial = cacheEntry(state.objectLookups, object, key);
  if (initial.cached) return initial.value;
  const chain = [];
  let current = object;
  let result;
  while (true) {
    const cached = cacheEntry(state.objectLookups, current, key);
    if (cached.cached) {
      result = cached.value;
      break;
    }
    const own = staticObjectOwnLookup(
      current,
      key,
      state,
      diagnostics,
      arrayElementsOf,
      arrayIndexOutcomesOf
    );
    if (!own.missing) {
      result = own;
      setCacheEntry(state.objectLookups, current, key, result);
      break;
    }
    const prototype = state.objectPrototypes.get(current) ?? noPrototypeSetter;
    if (prototype !== noPrototypeSetter && diagnostics) {
      diagnostics.staticObjectPrototypeSteps =
        (diagnostics.staticObjectPrototypeSteps ?? 0) + 1;
    }
    const prototypeObject = unwrapExpression(prototype);
    if (prototypeObject?.type === "ObjectExpression") {
      chain.push({object: current, own});
      current = prototypeObject;
      continue;
    }
    result = combineLookupOutcomes(terminalPrototypeOutcome(prototype), own);
    setCacheEntry(state.objectLookups, current, key, result);
    break;
  }
  while (chain.length > 0) {
    const frame = chain.pop();
    if (diagnostics) {
      diagnostics.staticObjectPrototypeCacheHits =
        (diagnostics.staticObjectPrototypeCacheHits ?? 0) + 1;
    }
    result = combineLookupOutcomes(result, frame.own);
    setCacheEntry(state.objectLookups, frame.object, key, result);
  }
  return cacheEntry(state.objectLookups, object, key).value;
}

function staticObjectSelection(
  root,
  key,
  state,
  diagnostics,
  {arrayElementsOf, arrayIndexOutcomesOf} = {}
) {
  const outcome = staticObjectLookup(
    root,
    key,
    state,
    diagnostics,
    arrayElementsOf,
    arrayIndexOutcomesOf
  );
  return outcome ? {
    conservative: outcome.conservative,
    dynamic: outcome.dynamic,
    nodes: outcome.nodes,
    undefinedOutcome: outcome.undefinedOutcome || outcome.missing
  } : null;
}

function selectionForArrayOutcomes(outcomes) {
  if (!outcomes) return null;
  return selectionOutcome(outcomes);
}

export {selectionForArrayOutcomes, staticObjectSelection};
