import {
  invocationView,
  staticKey,
  unwrapCallee,
  unwrapExpression
} from "./credential-call-view.js";

function isUnshadowedGlobalReference(node, name, shadowedBindings) {
  const value = unwrapExpression(node);
  if (value?.type === "Identifier") {
    return value.name === name && !shadowedBindings.has(value);
  }
  if (value?.type !== "MemberExpression") return false;
  const root = unwrapExpression(value.object);
  return root?.type === "Identifier"
    && ["globalThis", "self", "window"].includes(root.name)
    && !shadowedBindings.has(root)
    && staticKey(value.property, value.computed) === name;
}

function standardArrayPrototypeMethod(callee, context) {
  const member = unwrapCallee(callee);
  if (member?.type !== "MemberExpression") return null;
  const prototype = unwrapExpression(member.object);
  if (
    prototype?.type !== "MemberExpression"
    || staticKey(prototype.property, prototype.computed) !== "prototype"
    || !isUnshadowedGlobalReference(
      prototype.object,
      "Array",
      context.shadowedBindings
    )
  ) return null;
  return staticKey(member.property, member.computed);
}

function arrayOperation(node, context) {
  const value = unwrapExpression(node);
  if (value?.type === "ArrayExpression") {
    return {kind: "literal", elements: value.elements};
  }
  if (!["CallExpression", "NewExpression"].includes(value?.type)) return null;
  const invocation = invocationView(value, context.shadowedBindings);
  const callee = unwrapCallee(invocation.callee);
  const standardMethod = standardArrayPrototypeMethod(callee, context);
  if (["concat", "flat", "slice"].includes(standardMethod)) {
    return {
      ambiguous: invocation.ambiguous,
      arguments: invocation.arguments,
      kind: standardMethod,
      receiver: invocation.thisArgument
    };
  }
  if (callee?.type !== "MemberExpression") return null;
  const method = staticKey(callee.property, callee.computed);
  if (
    method === "of"
    && isUnshadowedGlobalReference(callee.object, "Array", context.shadowedBindings)
  ) {
    return {
      ambiguous: invocation.ambiguous,
      arguments: invocation.arguments,
      kind: "of"
    };
  }
  if (!["concat", "flat", "slice"].includes(method)) return null;
  return {
    ambiguous: invocation.ambiguous,
    arguments: invocation.arguments,
    kind: method,
    receiver: invocation.thisArgument
  };
}

export {
  arrayOperation,
  isUnshadowedGlobalReference,
  standardArrayPrototypeMethod
};
