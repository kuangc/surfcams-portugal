import {
  isDirectRuntimeReference,
  staticValue,
  unknownStaticValue
} from "./ast-utils.js";
import {unwrapExpression} from "./credential-call-view.js";

const maxStaticPrimitiveOutcomes = 64;
const maxStaticPrimitiveChars = 256;

function createStaticPrimitiveOutcomeAnalyzer({
  coerceStatic,
  diagnosticPrefix = "staticPrimitiveOutcome",
  diagnostics,
  selectedOutcome
} = {}) {
  const cache = new WeakMap();
  if (diagnostics) {
    diagnostics[`${diagnosticPrefix}PlusOperations`] ??= 0;
    diagnostics[`${diagnosticPrefix}MaterializedCharacters`] ??= 0;
  }

  function bounded(values, {
    conservative = false,
    dynamic = false,
    opaque = false
  } = {}) {
    const unique = [];
    for (const value of values) {
      const text = String(value);
      if (text.length > maxStaticPrimitiveChars) {
        conservative = true;
        continue;
      }
      if (unique.some((candidate) =>
        typeof candidate === typeof value && Object.is(candidate, value)
      )) continue;
      if (unique.length >= maxStaticPrimitiveOutcomes) {
        conservative = true;
        break;
      }
      unique.push(value);
    }
    return {conservative, dynamic, opaque, values: unique};
  }

  function merge(...outcomes) {
    return bounded(
      outcomes.flatMap((outcome) => outcome?.values ?? []),
      {
        conservative: outcomes.some((outcome) => outcome?.conservative),
        dynamic: outcomes.some((outcome) => outcome?.dynamic),
        opaque: outcomes.some((outcome) => outcome?.opaque)
      }
    );
  }

  function add(left, right) {
    if (left.conservative || right.conservative) {
      const leftCanBeStatic = left.conservative || left.values.length > 0;
      const rightCanBeStatic = right.conservative || right.values.length > 0;
      return bounded([], {
        conservative: leftCanBeStatic && rightCanBeStatic,
        dynamic: left.dynamic || right.dynamic,
        opaque: left.opaque || right.opaque || left.dynamic || right.dynamic
      });
    }
    const values = [];
    for (const leftValue of left.values) {
      for (const rightValue of right.values) {
        if (diagnostics) {
          const operationsKey = `${diagnosticPrefix}PlusOperations`;
          diagnostics[operationsKey] = (diagnostics[operationsKey] ?? 0) + 1;
        }
        let value;
        try {
          value = leftValue + rightValue;
        } catch {
          continue;
        }
        if (diagnostics && typeof value === "string") {
          const charactersKey = `${diagnosticPrefix}MaterializedCharacters`;
          diagnostics[charactersKey] =
            (diagnostics[charactersKey] ?? 0) + value.length;
        }
        values.push(value);
        if (values.length > maxStaticPrimitiveOutcomes) {
          return bounded([], {
            conservative: true,
            dynamic: left.dynamic || right.dynamic,
            opaque: left.opaque || right.opaque || left.dynamic || right.dynamic
          });
        }
      }
    }
    return bounded(values, {
      dynamic: left.dynamic || right.dynamic,
      opaque: left.opaque || right.opaque || left.dynamic || right.dynamic
    });
  }

  function stringify(outcome) {
    const values = [];
    for (const value of outcome.values) {
      try {
        values.push(String(value));
      } catch {
        // A throwing coercion contributes no possible template outcome.
      }
    }
    return bounded(values, {
      conservative: outcome.conservative,
      dynamic: outcome.dynamic,
      opaque: outcome.opaque
    });
  }

  function remember(node, result, composition = false) {
    cache.set(node, result);
    if (!diagnostics) return;
    const nodesKey = `${diagnosticPrefix}Nodes`;
    diagnostics[nodesKey] = (diagnostics[nodesKey] ?? 0) + 1;
    if (composition) {
      const compositionKey = `${diagnosticPrefix}Compositions`;
      diagnostics[compositionKey] = (diagnostics[compositionKey] ?? 0) + 1;
    }
  }

  function shape(node) {
    if (node.type === "ConditionalExpression") {
      return {children: [node.consequent, node.alternate], kind: "branches"};
    }
    if (node.type === "LogicalExpression") {
      return {children: [node.left, node.right], kind: "branches"};
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
      return {children: [node.left, node.right], kind: "add"};
    }
    if (node.type === "TemplateLiteral") {
      return {children: node.expressions, kind: "template"};
    }
    if (
      node.type === "AssignmentPattern"
      || node.type === "AssignmentExpression" && node.operator === "="
    ) return {children: [node.right], kind: "wrapper"};
    if (node.type === "AwaitExpression") {
      return {children: [node.argument], kind: "wrapper"};
    }
    if (node.type === "SequenceExpression") {
      return {children: [node.expressions.at(-1)], kind: "wrapper"};
    }
    return null;
  }

  function selectedValues(node) {
    const selection = selectedOutcome?.(node);
    if (!selection) return null;
    let result = bounded(
      selection.undefinedOutcome ? [undefined] : [],
      {
        conservative: selection.conservative,
        dynamic: selection.dynamic
      }
    );
    if (result.conservative) return result;
    const pending = [...selection.nodes].reverse();
    while (pending.length > 0 && !result.conservative) {
      const value = unwrapExpression(pending.pop());
      if (isDirectRuntimeReference(value)) {
        result = merge(result, bounded([], {dynamic: true}));
        continue;
      }
      if (value?.type === "MemberExpression") {
        const nested = selectedOutcome?.(value);
        if (!nested) {
          result = merge(result, bounded([], {dynamic: true, opaque: true}));
          continue;
        }
        result = merge(result, bounded(
          nested.undefinedOutcome ? [undefined] : [],
          {conservative: nested.conservative, dynamic: nested.dynamic}
        ));
        pending.push(...nested.nodes.slice().reverse());
        continue;
      }
      result = merge(result, leafOutcome(value));
    }
    return result;
  }

  function leafOutcome(node) {
    if (isDirectRuntimeReference(node)) return bounded([], {dynamic: true});
    if (node.type === "MemberExpression") {
      const selected = selectedValues(node);
      if (selected) return selected;
    }
    const coerced = coerceStatic?.(node);
    if (coerced?.known) return bounded([coerced.value]);
    const primitive = staticValue(node);
    if (primitive !== unknownStaticValue) return bounded([primitive]);
    return bounded([], {dynamic: true, opaque: true});
  }

  function cached(node) {
    const value = unwrapExpression(node);
    return value && typeof value === "object"
      ? cache.get(value)
      : bounded([], {dynamic: true, opaque: true});
  }

  function composite(node, kind, children) {
    const childOutcomes = children.map(cached);
    if (kind === "branches") return merge(...childOutcomes);
    if (kind === "add") {
      return add(childOutcomes[0], childOutcomes[1]);
    }
    if (kind === "template") {
      let result = bounded([node.quasis[0]?.value?.cooked ?? ""]);
      for (let index = 0; index < childOutcomes.length; index += 1) {
        result = add(result, stringify(childOutcomes[index]));
        result = add(
          result,
          bounded([node.quasis[index + 1]?.value?.cooked ?? ""])
        );
        if (result.conservative) break;
      }
      return result;
    }
    return childOutcomes[0] ?? bounded([], {dynamic: true, opaque: true});
  }

  function outcomes(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object") {
      return bounded([], {dynamic: true, opaque: true});
    }
    if (cache.has(root)) {
      if (diagnostics) {
        const key = `${diagnosticPrefix}CacheHits`;
        diagnostics[key] = (diagnostics[key] ?? 0) + 1;
      }
      return cache.get(root);
    }
    const pending = [{expanded: false, node: root}];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (!value || typeof value !== "object" || cache.has(value)) continue;
      if (isDirectRuntimeReference(value)) {
        remember(value, bounded([], {dynamic: true}));
        continue;
      }
      const nodeShape = shape(value);
      if (!nodeShape) {
        remember(value, leafOutcome(value));
        continue;
      }
      if (frame.expanded) {
        remember(
          value,
          composite(value, nodeShape.kind, nodeShape.children),
          true
        );
        continue;
      }
      pending.push({expanded: true, node: value});
      for (let index = nodeShape.children.length - 1; index >= 0; index -= 1) {
        const child = unwrapExpression(nodeShape.children[index]);
        if (child && typeof child === "object" && !cache.has(child)) {
          pending.push({expanded: false, node: child});
        }
      }
    }
    return cache.get(root) ?? bounded([], {dynamic: true, opaque: true});
  }

  return {outcomes};
}

export {
  createStaticPrimitiveOutcomeAnalyzer,
  maxStaticPrimitiveOutcomes
};
