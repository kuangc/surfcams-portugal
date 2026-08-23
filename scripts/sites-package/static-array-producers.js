import {
  isDirectRuntimeReference,
  staticValue,
  unknownStaticValue
} from "./ast-utils.js";
import {
  invocationView,
  staticKey,
  unwrapCallee,
  unwrapExpression
} from "./credential-call-view.js";
import {
  composeRelationList,
  composeRelations,
  dynamicOutputRelation,
  emptyOutputRelation,
  relationForStaticText,
  unionRelations
} from "./signed-query-relation.js";
import {
  arrayOperation,
  isUnshadowedGlobalReference,
  standardArrayPrototypeMethod
} from "./static-array-operation.js";
import {
  arrayHole,
  isOptionalArraySegment,
  isOptionalStaticArrayElement,
  materializeArray,
  optionalArraySegmentNode,
  producerState,
  staticArrayElements
} from "./static-array-view.js";

function elementRelation(node, context) {
  if (node === null || node === arrayHole) return emptyOutputRelation;
  const arrayRelation = arrayStringRelation(node, context);
  if (arrayRelation) return arrayRelation;
  const primitive = context.primitiveOf(node);
  if (primitive.known && primitive.value == null) return emptyOutputRelation;
  return primitive.known
    ? relationForStaticText(String(primitive.value))
    : context.relationOf(node);
}

function relationsForElements(elements, separator, context) {
  let empty = emptyOutputRelation;
  let nonempty = null;
  for (const element of elements) {
    if (isOptionalArraySegment(element)) {
      const optionalRelation = isOptionalStaticArrayElement(element)
        ? elementRelation(optionalArraySegmentNode(element), context)
        : dynamicOutputRelation;
      const branches = nonempty ? [nonempty] : [];
      if (empty) branches.push(optionalRelation);
      if (nonempty) {
        branches.push(composeRelationList(
          [nonempty, separator, optionalRelation],
          context.diagnostics
        ));
      }
      nonempty = branches.length === 1 ? branches[0] : unionRelations(...branches);
      continue;
    }
    const relation = elementRelation(element, context);
    const branches = [];
    if (empty) branches.push(composeRelations(empty, relation, context.diagnostics));
    if (nonempty) {
      branches.push(composeRelationList(
        [nonempty, separator, relation],
        context.diagnostics
      ));
    }
    nonempty = branches.length === 1 ? branches[0] : unionRelations(...branches);
    empty = null;
  }
  if (!nonempty) return empty;
  return empty ? unionRelations(empty, nonempty) : nonempty;
}

function arrayStringRelation(root, context, resolveSelection = true) {
  const state = producerState(context);
  const value = unwrapExpression(root);
  if (!value || typeof value !== "object") return null;
  const selection = resolveSelection ? context.selectionOf?.(value) : null;
  if (
    selection
    && (
      selection.conservative
      || selection.undefinedOutcome
      || selection.nodes.length > 0
    )
  ) {
    return context.relationForSelection(selection, (alternative) =>
      arrayStringRelation(alternative, context, false)
        ?? context.relationOf(alternative)
    );
  }
  if (state.arrayStrings.has(value)) return state.arrayStrings.get(value);
  const view = staticArrayElements(value, context);
  if (!view) return null;
  const pending = [{expanded: false, node: value, view}];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (state.arrayStrings.has(frame.node)) continue;
    if (!frame.expanded) {
      pending.push({...frame, expanded: true});
      const elements = materializeArray(frame.view, context);
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = unwrapExpression(elements[index]);
        const nested = staticArrayElements(element, context);
        if (nested && !state.arrayStrings.has(element)) {
          pending.push({expanded: false, node: element, view: nested});
        }
      }
      continue;
    }
    state.arrayStrings.set(
      frame.node,
      relationsForElements(
        materializeArray(frame.view, context),
        relationForStaticText(","),
        context
      )
    );
  }
  return state.arrayStrings.get(value);
}

function staticArrayLikeElements(receiver, context) {
  const value = unwrapExpression(receiver);
  if (value?.type !== "ObjectExpression") return null;
  const properties = new Map();
  let length = null;
  for (const property of value.properties) {
    if (property.type !== "Property" || property.kind !== "init") return null;
    const keyValue = property.computed
      ? staticValue(property.key)
      : property.key.type === "Identifier" ? property.key.name : property.key.value;
    if (keyValue === unknownStaticValue) return null;
    const key = String(keyValue);
    if (key === "length") {
      const primitive = context.primitiveOf(property.value);
      if (!primitive.known) return null;
      const number = Number(primitive.value);
      if (!Number.isInteger(number) || number < 0 || number > 4096) return null;
      length = number;
    } else if (/^(?:0|[1-9]\d*)$/.test(key)) {
      properties.set(Number(key), property.value);
    }
  }
  if (length === null) return null;
  return Array.from({length}, (_, index) => properties.get(index) ?? arrayHole);
}

function needsConservativeArrayFailure(root, context) {
  const pending = [root];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const value = unwrapExpression(pending.pop());
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (isDirectRuntimeReference(value)) continue;
    const operation = arrayOperation(value, context);
    if (!operation || operation.kind === "literal" || operation.kind === "of") continue;
    if (staticArrayElements(operation.receiver, context)) return true;
    if (operation.receiver) pending.push(operation.receiver);
  }
  return false;
}

function arrayJoinRelation(
  receiver,
  argumentsList,
  context,
  allowArrayLike = false,
  resolveSelection = true
) {
  const selection = resolveSelection ? context.selectionOf?.(receiver) : null;
  if (selection) {
    return context.relationForSelection(selection, (alternative) =>
      arrayJoinRelation(
        alternative,
        argumentsList,
        context,
        allowArrayLike,
        false
      ) ?? dynamicOutputRelation
    );
  }
  const view = staticArrayElements(receiver, context);
  const arrayLikeElements = view
    ? null
    : allowArrayLike ? staticArrayLikeElements(receiver, context) : null;
  if (!view && !arrayLikeElements) {
    return needsConservativeArrayFailure(receiver, context)
      ? relationForStaticText("?wmsAuthSign=x")
      : null;
  }
  const separatorNode = argumentsList[0];
  const primitive = separatorNode === undefined
    ? {known: true, value: ","}
    : context.primitiveOf(separatorNode);
  const separator = primitive.known
    ? relationForStaticText(
      primitive.value === undefined ? "," : String(primitive.value)
    )
    : arrayStringRelation(separatorNode, context) ?? context.relationOf(separatorNode);
  return relationsForElements(
    view ? materializeArray(view, context) : arrayLikeElements,
    separator,
    context
  );
}

function staticArrayProducerRelation(node, context) {
  const invocation = invocationView(node, context.shadowedBindings);
  const callee = unwrapCallee(invocation.callee);
  const standardMethod = standardArrayPrototypeMethod(callee, context);
  const directMethod = callee?.type === "MemberExpression"
    ? staticKey(callee.property, callee.computed)
    : null;
  if (standardMethod === "join" || directMethod === "join") {
    const relation = arrayJoinRelation(
      invocation.thisArgument,
      invocation.arguments,
      context,
      standardMethod === "join"
    );
    if (relation) return relation;
    if (
      standardMethod === "join"
      && !isDirectRuntimeReference(unwrapExpression(invocation.thisArgument))
    ) {
      return composeRelationList(
        [invocation.thisArgument, ...invocation.arguments].map(context.relationOf),
        context.diagnostics
      );
    }
  }
  if (
    isUnshadowedGlobalReference(callee, "String", context.shadowedBindings)
    && invocation.arguments.length > 0
  ) {
    const relation = arrayStringRelation(invocation.arguments[0], context);
    if (relation) return relation;
    if (needsConservativeArrayFailure(invocation.arguments[0], context)) {
      return relationForStaticText("?wmsAuthSign=x");
    }
  }
  return null;
}

export {arrayStringRelation as staticArrayStringRelation, staticArrayProducerRelation};
