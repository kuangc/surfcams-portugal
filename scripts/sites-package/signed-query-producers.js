import {staticValue, unknownStaticValue} from "./ast-utils.js";
import {
  intrinsicCallee,
  invocationView,
  staticGlobalName,
  staticKey,
  unwrapCallee,
  unwrapExpression
} from "./credential-call-view.js";
import {
  composeRelationList,
  dynamicOutputRelation,
  relationForStaticText
} from "./signed-query-relation.js";
import {
  staticArrayProducerRelation,
  staticArrayStringRelation
} from "./static-array-producers.js";

const semanticGlobalNames = new Set([
  "Array",
  "Object",
  "Reflect",
  "String",
  "URLSearchParams",
  "globalThis",
  "self",
  "window"
]);

function syntheticLiteral(value) {
  return {type: "Literal", value};
}

function flattenedOpaqueArguments(argumentsList) {
  const parts = [];
  for (const argument of argumentsList) {
    if (argument?.type !== "SpreadElement") {
      parts.push(argument);
      continue;
    }
    const spread = unwrapExpression(argument.argument);
    if (spread?.type === "ArrayExpression") {
      parts.push(...spread.elements.map((element) => element ?? syntheticLiteral("")));
    } else {
      parts.push(argument.argument);
    }
  }
  return parts;
}

function flattenedOpaqueValues(values) {
  const parts = [];
  const pending = [...values].reverse();
  while (pending.length > 0) {
    const value = pending.pop();
    const unwrapped = unwrapExpression(value?.type === "SpreadElement" ? value.argument : value);
    if (unwrapped?.type === "ArrayExpression") {
      for (let index = unwrapped.elements.length - 1; index >= 0; index -= 1) {
        pending.push(unwrapped.elements[index] ?? syntheticLiteral(""));
      }
    } else {
      parts.push(value?.type === "SpreadElement" ? value.argument : value);
    }
  }
  return parts;
}

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

function staticPrimitive(node, shadowedBindings) {
  const value = unwrapExpression(node);
  if (
    value?.type === "Identifier"
    && value.name === "undefined"
    && !shadowedBindings.has(value)
  ) return {known: true, value: undefined};
  if (
    value?.type === "MemberExpression"
    && isUnshadowedGlobalReference(value, "undefined", shadowedBindings)
  ) return {known: true, value: undefined};
  if (value?.type === "UnaryExpression" && value.operator === "void") {
    return {known: true, value: undefined};
  }
  const primitive = staticValue(value);
  return primitive === unknownStaticValue
    ? {known: false}
    : {known: true, value: primitive};
}

function standardPrototypeProducer(callee) {
  const methodMember = unwrapCallee(callee);
  if (methodMember?.type !== "MemberExpression") return null;
  const method = staticKey(methodMember.property, methodMember.computed);
  const prototypeMember = unwrapExpression(methodMember.object);
  if (
    prototypeMember?.type !== "MemberExpression"
    || staticKey(prototypeMember.property, prototypeMember.computed) !== "prototype"
  ) return null;
  if (method === "concat" && staticGlobalName(prototypeMember.object) === "String") {
    return {root: prototypeMember.object};
  }
  return null;
}

function standardProducerOutputRelation(node, context) {
  const invocation = invocationView(node, context.shadowedBindings);
  const producer = standardPrototypeProducer(invocation.callee);
  const primitiveReceiver = invocation.thisArgument
    ? context.primitiveOf(invocation.thisArgument)
    : {known: false};
  const directStringConcat = !producer
    && unwrapCallee(invocation.callee)?.type === "MemberExpression"
    && staticKey(
      unwrapCallee(invocation.callee).property,
      unwrapCallee(invocation.callee).computed
    ) === "concat"
    && primitiveReceiver.known
    && typeof primitiveReceiver.value === "string";
  if ((!producer && !directStringConcat) || !invocation.thisArgument) return null;
  if (producer && !isUnshadowedGlobalReference(
    producer.root,
    "String",
    context.shadowedBindings
  )) {
    return composeRelationList(
      flattenedOpaqueValues([invocation.thisArgument, ...invocation.arguments])
        .map(context.relationOf),
      context.diagnostics
    );
  }
  return composeRelationList(
    [invocation.thisArgument, ...invocation.arguments].map((value) => {
      const arrayRelation = staticArrayStringRelation(value, context);
      if (arrayRelation) return arrayRelation;
      const primitive = context.primitiveOf(value);
      return primitive.known
        ? relationForStaticText(String(primitive.value))
        : context.relationOf(value);
    }),
    context.diagnostics
  );
}

function calleeRootIdentifier(callee) {
  let value = unwrapCallee(callee);
  while (value?.type === "MemberExpression") value = unwrapExpression(value.object);
  return value?.type === "Identifier" ? value : null;
}

function isStructuredCarrier(node, shadowedBindings) {
  if (!["CallExpression", "NewExpression"].includes(node?.type)) return false;
  const invocation = invocationView(node, shadowedBindings);
  const {callee} = invocation;
  const property = callee?.type === "MemberExpression"
    ? staticKey(callee.property, callee.computed)
    : null;
  const intrinsic = intrinsicCallee(callee);
  const calleeObject = callee?.type === "MemberExpression" ? callee.object : null;
  const namedReflectSet = property === "set" && staticGlobalName(calleeObject) === "Reflect";
  const isSetter = !invocation.construct && (
    ["append", "setAttribute"].includes(property)
    || property === "set" && (
      !namedReflectSet
      || isUnshadowedGlobalReference(calleeObject, "Reflect", shadowedBindings)
    )
  );
  const isDefineProperty = intrinsic.method === "defineProperty"
    && ["Object", "Reflect"].some((owner) =>
      intrinsic.owner === owner
      && isUnshadowedGlobalReference(calleeObject, owner, shadowedBindings)
    );
  const isFromEntries = intrinsic.owner === "Object"
    && intrinsic.method === "fromEntries"
    && isUnshadowedGlobalReference(calleeObject, "Object", shadowedBindings);
  const isUrlSearchParams = (invocation.construct || invocation.wrapped)
    && intrinsic.method === "URLSearchParams"
    && [null, "globalThis", "self", "window"].includes(intrinsic.owner)
    && isUnshadowedGlobalReference(callee, "URLSearchParams", shadowedBindings);
  return isSetter || isDefineProperty || isFromEntries || isUrlSearchParams;
}

function opaqueOutputRelation(node, context) {
  if (node.type === "TaggedTemplateExpression") return context.relationOf(node.quasi);
  const arrayProducer = staticArrayProducerRelation(node, context);
  if (arrayProducer) return arrayProducer;
  const standardProducer = standardProducerOutputRelation(node, context);
  if (standardProducer) return standardProducer;
  const root = calleeRootIdentifier(node.callee);
  if (
    root
    && semanticGlobalNames.has(root.name)
    && context.shadowedBindings.has(root)
  ) {
    return composeRelationList(
      flattenedOpaqueValues(node.arguments).map(context.relationOf),
      context.diagnostics
    );
  }
  if (isStructuredCarrier(node, context.shadowedBindings)) return dynamicOutputRelation;
  const callee = unwrapCallee(node.callee);
  const argumentsList = flattenedOpaqueArguments(node.arguments);
  if (callee?.type !== "MemberExpression") {
    return composeRelationList(argumentsList.map(context.relationOf), context.diagnostics);
  }
  return composeRelationList(
    [callee.object, ...argumentsList].map(context.relationOf),
    context.diagnostics
  );
}

export {opaqueOutputRelation, staticPrimitive};
