import {
  isDirectRuntimeReference,
  staticStringValue,
  staticValue,
  unknownStaticValue
} from "./ast-utils.js";
import { createCredentialAssignmentIndex } from "./credential-assignment-index.js";

function unwrapExpression(node) {
  while (["ChainExpression", "ParenthesizedExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function noteReferenceNode(context) {
  const { diagnostics } = context;
  if (diagnostics) {
    diagnostics.credentialReferenceNodes = (diagnostics.credentialReferenceNodes ?? 0) + 1;
  }
}

function runtimeReferenceShape(node, context) {
  const properties = [];
  let value = unwrapExpression(node);
  if (!value || typeof value !== "object") return null;
  if (context.referenceShapeCache.has(value)) return context.referenceShapeCache.get(value);
  const cacheKey = value;
  while (value?.type === "MemberExpression") {
    noteReferenceNode(context);
    const property = value.computed
      ? runtimeSelectorShape(value.property, context)
      : ["static", value.property?.name];
    if (!property) {
      context.referenceShapeCache.set(cacheKey, null);
      return null;
    }
    properties.push(property);
    value = unwrapExpression(value.object);
  }
  if (value?.type !== "Identifier") {
    context.referenceShapeCache.set(cacheKey, null);
    return null;
  }
  noteReferenceNode(context);
  const shape = ["reference", value.name, ...properties.reverse()];
  context.referenceShapeCache.set(cacheKey, shape);
  return shape;
}

function runtimeReferencePath(node, context) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return null;
  if (context.referencePathCache.has(value)) return context.referencePathCache.get(value);
  const shape = runtimeReferenceShape(value, context);
  if (!shape) {
    context.referencePathCache.set(value, null);
    return null;
  }
  const path = JSON.stringify(shape);
  context.referencePathCache.set(value, path);
  const { diagnostics } = context;
  if (diagnostics) {
    diagnostics.credentialReferenceMaxBytes = Math.max(
      diagnostics.credentialReferenceMaxBytes ?? 0,
      path.length
    );
  }
  return path;
}

function runtimeSelectorShape(node, context) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return null;
  if (context.selectorShapeCache.has(value)) return context.selectorShapeCache.get(value);
  noteReferenceNode(context);
  const staticResult = staticValue(value);
  let shape = null;
  if (staticResult !== unknownStaticValue) {
    shape = ["static", String(staticResult)];
  } else if (value.type === "Literal" && value.regex) {
    shape = ["regexp", value.regex.pattern, value.regex.flags];
  } else if (value.type === "ThisExpression") {
    shape = ["this"];
  } else if (value.type === "Identifier") {
    shape = ["identifier", value.name];
  } else if (value.type === "MemberExpression") {
    shape = runtimeReferenceShape(value, context);
  } else if (value.type === "ConditionalExpression") {
    const parts = [value.test, value.consequent, value.alternate]
      .map((part) => runtimeSelectorShape(part, context));
    shape = parts.every(Boolean) ? ["conditional", ...parts] : null;
  } else if (value.type === "LogicalExpression" || value.type === "BinaryExpression") {
    const left = runtimeSelectorShape(value.left, context);
    const right = runtimeSelectorShape(value.right, context);
    shape = left && right ? [value.type, value.operator, left, right] : null;
  } else if (value.type === "UnaryExpression" && value.operator !== "delete") {
    const argument = runtimeSelectorShape(value.argument, context);
    shape = argument ? ["unary", value.operator, argument] : null;
  } else if (value.type === "TemplateLiteral") {
    const expressions = value.expressions.map((expression) =>
      runtimeSelectorShape(expression, context)
    );
    shape = expressions.every(Boolean)
      ? ["template", value.quasis.map(staticStringValue), expressions]
      : null;
  }
  context.selectorShapeCache.set(value, shape);
  return shape;
}

function containsOpaqueInvocation(node, context) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return false;
  if (context.opaqueInvocationCache.has(value)) {
    return context.opaqueInvocationCache.get(value);
  }
  const pending = [{expanded: false, value}];
  while (pending.length > 0) {
    const frame = pending.pop();
    const current = unwrapExpression(frame.value);
    if (!current || typeof current !== "object") continue;
    if (context.opaqueInvocationCache.has(current)) continue;
    if (/^Function/.test(current.type) || current.type === "ArrowFunctionExpression") {
      context.opaqueInvocationCache.set(current, false);
      continue;
    }
    if (
      /^Class/.test(current.type)
      || ["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(current.type)
    ) {
      context.opaqueInvocationCache.set(current, true);
      continue;
    }
    const children = Object.entries(current)
      .filter(([key]) => !["start", "end", "loc"].includes(key))
      .flatMap(([, child]) => Array.isArray(child) ? child : [child])
      .map(unwrapExpression)
      .filter((child) => child && typeof child === "object");
    if (!frame.expanded) {
      pending.push({expanded: true, value: current});
      for (let index = children.length - 1; index >= 0; index -= 1) {
        if (!context.opaqueInvocationCache.has(children[index])) {
          pending.push({expanded: false, value: children[index]});
        }
      }
      continue;
    }
    if (context.diagnostics) {
      context.diagnostics.credentialOpaqueNodes =
        (context.diagnostics.credentialOpaqueNodes ?? 0) + 1;
    }
    context.opaqueInvocationCache.set(
      current,
      children.some((child) => context.opaqueInvocationCache.get(child) === true)
    );
  }
  return context.opaqueInvocationCache.get(value) ?? false;
}

function hasStaticCredentialOutcome(node, context) {
  const passthrough = [];
  let value = node;
  let result;
  while (true) {
    if (!value || typeof value !== "object") {
      result = value !== null && value !== undefined;
      break;
    }
    if (context.outcomeCache.has(value)) {
      if (context.diagnostics) {
        context.diagnostics.credentialOutcomeCacheHits =
          (context.diagnostics.credentialOutcomeCacheHits ?? 0) + 1;
      }
      result = context.outcomeCache.get(value);
      break;
    }
    if (context.diagnostics) {
      context.diagnostics.credentialOutcomeComputations =
        (context.diagnostics.credentialOutcomeComputations ?? 0) + 1;
    }
    if (
      value.type === "AssignmentPattern"
      || (value.type === "AssignmentExpression"
        && ["=", "||=", "&&=", "??="].includes(value.operator))
      || value.type === "AwaitExpression"
    ) {
      passthrough.push(value);
      value = value.type === "AwaitExpression" ? value.argument : value.right;
      continue;
    }
    result = computeStaticCredentialOutcome(value, context);
    context.outcomeCache.set(value, result);
    break;
  }
  for (const wrapper of passthrough) context.outcomeCache.set(wrapper, result);
  return result;
}

function computeStaticCredentialOutcome(node, context) {
  if (["ConditionalExpression", "LogicalExpression"].includes(node.type)) {
    const branches = node.type === "ConditionalExpression"
      ? [node.consequent, node.alternate]
      : [node.left, node.right];
    return branches.some((branch) => hasStaticCredentialOutcome(branch, context));
  }
  if (node.type === "SequenceExpression") {
    const result = node.expressions.at(-1);
    const preceding = node.expressions.slice(0, -1);
    if (preceding.some((value) => containsOpaqueInvocation(value, context))) return true;
    const referencePath = runtimeReferencePath(result, context);
    return (
      referencePath !== null
      && preceding.some((value) =>
        context.assignmentAnalyzer.assignsStaticValue(value, referencePath)
      )
    ) || hasStaticCredentialOutcome(result, context);
  }
  if (isDirectRuntimeReference(node)) return false;
  const value = staticValue(node);
  if (value !== unknownStaticValue) return value !== null && String(value).length > 0;
  return true;
}

function createCredentialValueAnalyzer(ast, diagnostics) {
  const context = {
    diagnostics,
    outcomeCache: new WeakMap(),
    opaqueInvocationCache: new WeakMap(),
    referencePathCache: new WeakMap(),
    referenceShapeCache: new WeakMap(),
    selectorShapeCache: new WeakMap()
  };
  context.assignmentAnalyzer = createCredentialAssignmentIndex({
    ast,
    diagnostics,
    hasStaticOutcome: (node) => hasStaticCredentialOutcome(node, context),
    referencePath: (node) => runtimeReferencePath(node, context)
  });
  return {
    diagnostics,
    hasStaticOutcome(node) {
      return hasStaticCredentialOutcome(node, context);
    }
  };
}

export { createCredentialValueAnalyzer };
