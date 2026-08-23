import {
  isDirectRuntimeReference,
  staticStringValue
} from "./ast-utils.js";
import {
  intrinsicCallee,
  invocationView,
  staticGlobalName,
  staticKey,
  unwrapCallee,
  unwrapExpression
} from "./credential-call-view.js";
import { createCredentialKeyOutcomeAnalyzer } from "./credential-key-outcomes.js";
import { createCredentialTupleAnalyzer } from "./credential-tuple-elements.js";
import { createUrlSearchParamsAnalyzer } from "./url-search-params-scan.js";

function createCredentialCarrierScanner({analyzer, credentialLabel, credentialPrefixLabel}) {
  const iterableNodesSeen = {
    entry: new WeakSet(),
    iterable: new WeakSet()
  };
  const tupleAnalyzer = createCredentialTupleAnalyzer();
  const keyOutcomeAnalyzer = createCredentialKeyOutcomeAnalyzer(
    credentialLabel,
    analyzer.diagnostics
  );
  const urlSearchParamsAnalyzer = createUrlSearchParamsAnalyzer({
    credentialLabel,
    credentialPrefixLabel,
    hasStaticOutcome: analyzer.hasStaticOutcome
  });

  function pairLabel(key, value) {
    const label = typeof key === "string"
      ? credentialLabel(key)
      : keyOutcomeAnalyzer.findLabel(key);
    if (!label) return null;
    if (analyzer.diagnostics) {
      analyzer.diagnostics.credentialPairCandidates =
        (analyzer.diagnostics.credentialPairCandidates ?? 0) + 1;
    }
    const hasStaticValue = typeof value === "string"
      ? value.length > 0
      : analyzer.hasStaticOutcome(value);
    return hasStaticValue ? label : null;
  }

  function descriptorLabel(key, descriptor) {
    const label = keyOutcomeAnalyzer.findLabel(key);
    if (!label) return null;
    const value = unwrapExpression(descriptor);
    if (isDirectRuntimeReference(value)) return null;
    if (value?.type !== "ObjectExpression") {
      return analyzer.hasStaticOutcome(value) ? label : null;
    }
    for (const property of value.properties) {
      if (property.type === "SpreadElement") {
        if (!isDirectRuntimeReference(property.argument)) return label;
        continue;
      }
      if (property.type !== "Property") continue;
      const descriptorKey = staticKey(property.key, property.computed);
      if (
        (["value", "get"].includes(descriptorKey) || descriptorKey === null)
        && analyzer.hasStaticOutcome(property.value)
      ) return label;
    }
    return null;
  }

  function ambiguousPairLabel(argumentsList) {
    for (let index = 0; index < argumentsList.length - 1; index += 1) {
      const argument = argumentsList[index];
      if (argument?.type === "SpreadElement") continue;
      const label = keyOutcomeAnalyzer.findLabel(argument);
      if (label) return label;
    }
    return null;
  }

  function isIteratorProperty(property) {
    const key = unwrapExpression(property?.key);
    const object = unwrapExpression(key?.object);
    const isGlobalSymbol = object?.type === "Identifier" && object.name === "Symbol"
      || object?.type === "MemberExpression"
        && ["globalThis", "self", "window"].includes(unwrapExpression(object.object)?.name)
        && staticKey(object.property, object.computed) === "Symbol";
    return property?.type === "Property"
      && property.computed
      && key?.type === "MemberExpression"
      && isGlobalSymbol
      && staticKey(key.property, key.computed) === "iterator";
  }

  function mappedEntryExpressions(callback) {
    const value = unwrapExpression(callback);
    if (isDirectRuntimeReference(value)) return [];
    if (!/^Function/.test(value?.type) && value?.type !== "ArrowFunctionExpression") {
      return null;
    }
    const pending = [...value.params];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || typeof current !== "object") continue;
      if (current.type === "AssignmentPattern") return null;
      const children = Object.entries(current)
        .filter(([key]) => !["start", "end", "loc"].includes(key))
        .flatMap(([, child]) => Array.isArray(child) ? child : [child]);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push(children[index]);
      }
    }
    if (value.generator || value.async || value.body?.type === "BlockStatement") return null;
    return [value.body];
  }

  const staticTupleElements = tupleAnalyzer.elements;

  function iterableLabel(root) {
    const opaqueIterableLabel = credentialLabel("wmsAuthSign");
    const pending = [{mode: "iterable", node: root}];
    const structurallyInspectedMethods = new Set([
      "concat",
      "filter",
      "join",
      "replace",
      "slice",
      "sort",
      "toString",
      "values"
    ]);
    while (pending.length > 0) {
      const {mode, node} = pending.pop();
      const value = unwrapExpression(node);
      if (!value || typeof value !== "object" || iterableNodesSeen[mode].has(value)) continue;
      iterableNodesSeen[mode].add(value);
      if (analyzer.diagnostics) {
        analyzer.diagnostics.credentialIterableNodes =
          (analyzer.diagnostics.credentialIterableNodes ?? 0) + 1;
      }
      if (isDirectRuntimeReference(value)) continue;

      if (mode === "entry") {
        if (value.type === "SpreadElement") {
          const argument = unwrapExpression(value.argument);
          if (isDirectRuntimeReference(argument)) continue;
          if (argument?.type !== "ArrayExpression") return opaqueIterableLabel;
          for (let index = argument.elements.length - 1; index >= 0; index -= 1) {
            pending.push({mode: "entry", node: argument.elements[index]});
          }
          continue;
        }
        const tuple = staticTupleElements(value);
        if (tuple) {
          const opaqueSpread = tuple.find((element) =>
            element?.type === "SpreadElement"
            && !isDirectRuntimeReference(unwrapExpression(element.argument))
          );
          if (opaqueSpread) return opaqueIterableLabel;
          const visible = tuple.filter((element) => element?.type !== "SpreadElement");
          const label = pairLabel(visible[0], visible[1]);
          if (label) return label;
          if (/^Class/.test(unwrapExpression(visible[1])?.type)) return opaqueIterableLabel;
          continue;
        }
        if (/^Function/.test(value.type) || value.type === "ArrowFunctionExpression") continue;
        if (/^Class/.test(value.type)) return opaqueIterableLabel;
        if (["ObjectExpression", "TaggedTemplateExpression"].includes(value.type)) {
          return opaqueIterableLabel;
        }
        if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
          const branches = value.type === "ConditionalExpression"
            ? [value.consequent, value.alternate]
            : [value.left, value.right];
          for (const branch of branches) pending.push({mode: "entry", node: branch});
          continue;
        }
        if (value.type === "SequenceExpression") {
          pending.push({mode: "entry", node: value.expressions.at(-1)});
          for (const expression of value.expressions.slice(0, -1)) {
            if (["AssignmentExpression", "AssignmentPattern"].includes(expression.type)) {
              pending.push({mode: "entry", node: expression.right});
            }
          }
          continue;
        }
        if (["AssignmentExpression", "AssignmentPattern"].includes(value.type)) {
          pending.push({mode: "entry", node: value.right});
          continue;
        }
        if (value.type === "AwaitExpression") {
          pending.push({mode: "entry", node: value.argument});
          continue;
        }
        if (["CallExpression", "NewExpression"].includes(value.type)) {
          const callee = unwrapCallee(value.callee);
          if (callee?.type !== "MemberExpression") return opaqueIterableLabel;
          const method = staticKey(callee.property, callee.computed);
          if (!structurallyInspectedMethods.has(method)) return opaqueIterableLabel;
          pending.push({mode: "entry", node: callee.object});
        }
        continue;
      }

      if (/^Class/.test(value.type)) return opaqueIterableLabel;
      if (/^Function/.test(value.type) || value.type === "ArrowFunctionExpression") continue;
      if (value.type === "TaggedTemplateExpression") return opaqueIterableLabel;
      if (["CallExpression", "NewExpression"].includes(value.type)) {
        const callee = unwrapCallee(value.callee);
        if (
          /^Class/.test(callee?.type)
          || /^Function/.test(callee?.type)
          || callee?.type === "ArrowFunctionExpression"
        ) return opaqueIterableLabel;
        const intrinsic = intrinsicCallee(callee);
        if (intrinsic.owner === "Object" && intrinsic.method === "entries") {
          pending.push({mode: "iterable", node: value.arguments[0]});
          continue;
        }
        if (
          intrinsic.method === "Map"
          && [null, "globalThis", "self", "window"].includes(intrinsic.owner)
        ) {
          pending.push({mode: "iterable", node: value.arguments[0]});
          continue;
        }
        if (
          (intrinsic.method === "Array"
            && [null, "globalThis", "self", "window"].includes(intrinsic.owner))
          || (intrinsic.owner === "Array" && intrinsic.method === "of")
        ) {
          for (let index = value.arguments.length - 1; index >= 0; index -= 1) {
            pending.push({mode: "entry", node: value.arguments[index]});
          }
          continue;
        }
        if (callee?.type === "MemberExpression") {
          const method = staticKey(callee.property, callee.computed);
          const receiver = unwrapExpression(callee.object);
          if (
            ["apply", "call"].includes(method)
            && (/^Function/.test(receiver?.type) || receiver?.type === "ArrowFunctionExpression")
          ) return opaqueIterableLabel;
          if (method === "map") {
            const entries = mappedEntryExpressions(value.arguments[0]);
            if (entries === null) return opaqueIterableLabel;
            pending.push({mode: "iterable", node: callee.object});
            for (let index = entries.length - 1; index >= 0; index -= 1) {
              pending.push({mode: "entry", node: entries[index]});
            }
            continue;
          }
          if (!structurallyInspectedMethods.has(method)) return opaqueIterableLabel;
          pending.push({mode: "iterable", node: callee.object});
          if (method === "concat") {
            for (let index = value.arguments.length - 1; index >= 0; index -= 1) {
              pending.push({mode: "iterable", node: value.arguments[index]});
            }
          }
          continue;
        }
        return opaqueIterableLabel;
      }
      if (value.type === "ArrayExpression") {
        for (let index = value.elements.length - 1; index >= 0; index -= 1) {
          pending.push({mode: "entry", node: value.elements[index]});
        }
        continue;
      }
      if (value.type === "ObjectExpression") {
        if (value.properties.some((property) =>
          isIteratorProperty(property)
          || (property.type === "Property"
            && staticKey(property.key, property.computed) === "next")
        )) return opaqueIterableLabel;
        for (const property of value.properties) {
          if (property.type === "SpreadElement") {
            if (!isDirectRuntimeReference(property.argument)) return opaqueIterableLabel;
            continue;
          }
          const key = property.computed
            ? property.key
            : staticKey(property.key, property.computed);
          const label = pairLabel(key, property.value);
          if (label) return label;
        }
        continue;
      }
      if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
        const branches = value.type === "ConditionalExpression"
          ? [value.consequent, value.alternate]
          : [value.left, value.right];
        for (const branch of branches) pending.push({mode: "iterable", node: branch});
        continue;
      }
      if (value.type === "SequenceExpression") {
        pending.push({mode: "iterable", node: value.expressions.at(-1)});
        continue;
      }
      if (["AssignmentExpression", "AssignmentPattern"].includes(value.type)) {
        pending.push({mode: "iterable", node: value.right});
        continue;
      }
      if (value.type === "AwaitExpression") {
        pending.push({mode: "iterable", node: value.argument});
      }
    }
    return null;
  }

  function isStructuredUrlArgument(node) {
    let value = unwrapExpression(node);
    while (value && typeof value === "object") {
      if (["ArrayExpression", "ObjectExpression"].includes(value.type)) return true;
      if (!["CallExpression", "NewExpression"].includes(value.type)) return false;
      const intrinsic = intrinsicCallee(value.callee);
      if (intrinsic.owner === "Object" && intrinsic.method === "entries") return true;
      if (
        intrinsic.method === "Map"
        && [null, "globalThis", "self", "window"].includes(intrinsic.owner)
      ) return true;
      if (
        (intrinsic.method === "Array"
          && [null, "globalThis", "self", "window"].includes(intrinsic.owner))
        || (intrinsic.owner === "Array" && intrinsic.method === "of")
      ) return true;
      const callee = unwrapCallee(value.callee);
      if (callee?.type !== "MemberExpression") return false;
      const method = staticKey(callee.property, callee.computed);
      if (method === "map") return true;
      if (!["concat", "filter", "slice", "sort", "values"].includes(method)) return false;
      value = unwrapExpression(callee.object);
    }
    return false;
  }

  function urlSearchParamsArgumentLabel(argument) {
    if (isStructuredUrlArgument(argument)) return iterableLabel(argument);
    return urlSearchParamsAnalyzer.find(argument) || iterableLabel(argument);
  }

  function find(node) {
    const invocation = invocationView(node);
    const {callee} = invocation;
    const argumentsList = invocation.arguments;
    const calleeProperty = callee?.type === "MemberExpression"
      ? staticKey(callee.property, callee.computed)
      : null;
    const intrinsic = intrinsicCallee(callee);
    const isKnownSetter = !invocation.construct
      && ["append", "set", "setAttribute"].includes(calleeProperty);
    const isKnownDefineProperty = intrinsic.method === "defineProperty"
      && ["Object", "Reflect"].includes(intrinsic.owner);
    const isKnownFromEntries = intrinsic.owner === "Object"
      && intrinsic.method === "fromEntries";
    const isKnownUrlSearchParams = (invocation.construct || invocation.wrapped)
      && intrinsic.method === "URLSearchParams"
      && [null, "globalThis", "self", "window"].includes(intrinsic.owner);
    const isKnownCarrier = isKnownSetter
      || isKnownDefineProperty
      || isKnownFromEntries
      || isKnownUrlSearchParams;
    if (
      invocation.ambiguous
      && isKnownCarrier
      && argumentsList.some((argument) =>
        argument?.type === "SpreadElement"
        && !isDirectRuntimeReference(unwrapExpression(argument.argument))
      )
    ) return credentialLabel("wmsAuthSign");
    if (invocation.ambiguous && (isKnownSetter || isKnownDefineProperty)) {
      const label = ambiguousPairLabel(argumentsList);
      if (label) return label;
    }
    if (invocation.ambiguous && isKnownUrlSearchParams) {
      for (const argument of argumentsList) {
        if (argument?.type === "SpreadElement") continue;
        const label = urlSearchParamsArgumentLabel(argument);
        if (label) return label;
      }
    }
    if (invocation.ambiguous && isKnownFromEntries) {
      for (const argument of argumentsList) {
        if (argument?.type === "SpreadElement") continue;
        const label = iterableLabel(argument);
        if (label) return label;
      }
    }
    const candidates = [];
    if (isKnownSetter) candidates.push([argumentsList[0], argumentsList[1]]);
    const calleeObject = callee?.type === "MemberExpression"
      ? unwrapExpression(callee.object)
      : null;
    const isReflectSet = calleeProperty === "set"
      && staticGlobalName(calleeObject) === "Reflect";
    if (isReflectSet) candidates.push([argumentsList[1], argumentsList[2]]);
    for (const candidate of candidates) {
      const label = pairLabel(...candidate);
      if (label) return label;
    }
    if (isKnownDefineProperty) {
      const label = descriptorLabel(argumentsList[1], argumentsList[2]);
      if (label) return label;
    }
    if (isKnownFromEntries) {
      const label = iterableLabel(argumentsList[0]);
      if (label) return label;
    }
    if (isKnownUrlSearchParams) {
      const argument = argumentsList[0];
      const label = urlSearchParamsArgumentLabel(argument);
      if (label) return label;
    }
    return null;
  }

  return {find};
}

export { createCredentialCarrierScanner };
