import { staticStringValue } from "./ast-utils.js";

const materializedUndefinedArgument = {
  argument: {type: "Literal", value: 0},
  operator: "void",
  prefix: true,
  type: "UnaryExpression"
};

function staticKey(node, computed = false) {
  if (!computed && node?.type === "Identifier") return node.name;
  return staticStringValue(node);
}

function unwrapExpression(node) {
  while (["ChainExpression", "ParenthesizedExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function unwrapCallee(node) {
  let value = unwrapExpression(node);
  while (value?.type === "SequenceExpression") {
    value = unwrapExpression(value.expressions.at(-1));
  }
  return value;
}

function staticGlobalName(node) {
  const value = unwrapExpression(node);
  if (value?.type === "Identifier") return value.name;
  if (value?.type !== "MemberExpression") return null;
  const root = unwrapExpression(value.object);
  if (
    root?.type !== "Identifier"
    || !["globalThis", "self", "window"].includes(root.name)
  ) return null;
  return staticKey(value.property, value.computed);
}

function intrinsicCallee(node) {
  const callee = unwrapCallee(node);
  if (callee?.type === "Identifier") return {owner: null, method: callee.name};
  if (callee?.type !== "MemberExpression") return {owner: null, method: null};
  return {
    owner: staticGlobalName(callee.object),
    method: staticKey(callee.property, callee.computed)
  };
}

function staticArguments(elements) {
  const flattened = [];
  for (const element of elements) {
    if (element === null) {
      flattened.push(materializedUndefinedArgument);
      continue;
    }
    if (element?.type !== "SpreadElement") {
      flattened.push(element);
      continue;
    }
    const argument = unwrapExpression(element.argument);
    if (argument?.type !== "ArrayExpression") return null;
    const nested = staticArguments(argument.elements);
    if (nested === null) return null;
    flattened.push(...nested);
  }
  return flattened;
}

function argumentListView(node) {
  const value = unwrapExpression(node);
  if (value?.type === "ArrayExpression") {
    const argumentsList = staticArguments(value.elements);
    return {
      ambiguous: argumentsList === null,
      arguments: argumentsList ?? value.elements
    };
  }
  return {
    ambiguous: true,
    arguments: value ? [{argument: value, type: "SpreadElement"}] : []
  };
}

function directInvocationView(node, shadowedBindings) {
  const callee = unwrapCallee(node.callee);
  if (node.type === "CallExpression" && callee?.type === "MemberExpression") {
    const method = staticKey(callee.property, callee.computed);
    const reflectRoot = unwrapExpression(callee.object)?.type === "Identifier"
      ? unwrapExpression(callee.object)
      : unwrapExpression(unwrapExpression(callee.object)?.object);
    if (
      staticGlobalName(callee.object) === "Reflect"
      && ["apply", "construct"].includes(method)
      && !(shadowedBindings && reflectRoot && shadowedBindings.has(reflectRoot))
    ) {
      const list = argumentListView(node.arguments[method === "apply" ? 2 : 1]);
      return {
        ...list,
        callee: unwrapCallee(node.arguments[0]),
        construct: method === "construct",
        thisArgument: method === "apply" ? node.arguments[1] : null,
        wrapped: true
      };
    }
  }
  if (node.type !== "CallExpression" || callee?.type !== "MemberExpression") {
    const argumentsList = staticArguments(node.arguments);
    return {
      ambiguous: argumentsList === null,
      arguments: argumentsList ?? node.arguments,
      callee,
      construct: node.type === "NewExpression",
      thisArgument: node.type === "CallExpression" && callee?.type === "MemberExpression"
        ? callee.object
        : null
    };
  }
  const method = staticKey(callee.property, callee.computed);
  if (method === "call") {
    const argumentsList = staticArguments(node.arguments);
    if (argumentsList === null) {
      return {
        ambiguous: true,
        arguments: node.arguments.slice(1),
        callee: unwrapCallee(callee.object),
        construct: false,
        thisArgument: node.arguments[0]
      };
    }
    return {
      ambiguous: false,
      arguments: argumentsList.slice(1),
      callee: unwrapCallee(callee.object),
      construct: false,
      thisArgument: argumentsList[0]
    };
  }
  if (method === "apply") {
    const argumentList = unwrapExpression(node.arguments[1]);
    if (argumentList?.type === "ArrayExpression") {
      const argumentsList = staticArguments(argumentList.elements);
      if (argumentsList === null) {
        return {
          ambiguous: true,
          arguments: argumentList.elements,
          callee: unwrapCallee(callee.object),
          construct: false,
          thisArgument: node.arguments[0]
        };
      }
      return {
        ambiguous: false,
        arguments: argumentsList,
        callee: unwrapCallee(callee.object),
        construct: false,
        thisArgument: node.arguments[0]
      };
    }
    return {
      ambiguous: true,
      arguments: node.arguments.slice(1),
      callee: unwrapCallee(callee.object),
      construct: false,
      thisArgument: node.arguments[0]
    };
  }
  const argumentsList = staticArguments(node.arguments);
  return {
    ambiguous: argumentsList === null,
    arguments: argumentsList ?? node.arguments,
    callee,
    construct: false,
    thisArgument: callee.object
  };
}

function invocationView(node, shadowedBindings = null) {
  let view = directInvocationView(node, shadowedBindings);
  let depth = 0;
  while (depth < 32) {
    const boundCall = unwrapCallee(view.callee);
    if (boundCall?.type !== "CallExpression") break;
    const bindMember = unwrapCallee(boundCall.callee);
    if (
      bindMember?.type !== "MemberExpression"
      || staticKey(bindMember.property, bindMember.computed) !== "bind"
    ) break;
    const boundArguments = staticArguments(boundCall.arguments);
    const normalized = boundArguments ?? boundCall.arguments;
    view = {
      ambiguous: view.ambiguous || boundArguments === null,
      arguments: [...normalized.slice(1), ...view.arguments],
      callee: unwrapCallee(bindMember.object),
      construct: view.construct,
      thisArgument: normalized[0],
      wrapped: true
    };
    depth += 1;
  }
  if (depth === 32 && unwrapCallee(view.callee)?.type === "CallExpression") {
    view.ambiguous = true;
  }
  return view;
}

export {
  intrinsicCallee,
  invocationView,
  staticGlobalName,
  staticKey,
  unwrapCallee,
  unwrapExpression
};
