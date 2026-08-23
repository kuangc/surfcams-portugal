const unknownStaticValue = Symbol("unknown static value");
const staticValueCache = new WeakMap();

function staticValue(node) {
  if (!node || typeof node !== "object") return unknownStaticValue;
  if (staticValueCache.has(node)) return staticValueCache.get(node);
  const value = computeStaticValue(node);
  staticValueCache.set(node, value);
  return value;
}

function computeStaticValue(node) {
  if (node.type === "Literal") {
    return ["string", "number", "boolean", "bigint"].includes(typeof node.value)
      ? node.value
      : node.value === null ? null : unknownStaticValue;
  }
  if (node.type === "TemplateElement") return node.value.cooked ?? node.value.raw;
  if (node.type === "TemplateLiteral") {
    let value = "";
    for (let index = 0; index < node.quasis.length; index += 1) {
      value += staticValue(node.quasis[index]);
      if (index < node.expressions.length) {
        const expression = staticValue(node.expressions[index]);
        if (expression === unknownStaticValue) return unknownStaticValue;
        value += String(expression);
      }
    }
    return value;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticValue(node.left);
    const right = staticValue(node.right);
    if (left === unknownStaticValue || right === unknownStaticValue) return unknownStaticValue;
    try {
      return left + right;
    } catch {
      return unknownStaticValue;
    }
  }
  if (node.type === "UnaryExpression" && ["+", "-", "!", "~"].includes(node.operator)) {
    const argument = staticValue(node.argument);
    if (argument === unknownStaticValue) return unknownStaticValue;
    if (node.operator === "!") return !argument;
    if (node.operator === "~") return ~Number(argument);
    return node.operator === "-" ? -Number(argument) : Number(argument);
  }
  if (node.type === "ConditionalExpression") {
    const test = staticValue(node.test);
    if (test !== unknownStaticValue) return staticValue(test ? node.consequent : node.alternate);
    const consequent = staticValue(node.consequent);
    const alternate = staticValue(node.alternate);
    return consequent !== unknownStaticValue && Object.is(consequent, alternate)
      ? consequent
      : unknownStaticValue;
  }
  if (node.type === "LogicalExpression") {
    const left = staticValue(node.left);
    if (left === unknownStaticValue) return unknownStaticValue;
    if (node.operator === "||") return left || staticValue(node.right);
    if (node.operator === "&&") return left && staticValue(node.right);
    if (node.operator === "??") return left ?? staticValue(node.right);
  }
  if (node.type === "SequenceExpression") return staticValue(node.expressions.at(-1));
  if (node.type === "AssignmentPattern" || (node.type === "AssignmentExpression" && node.operator === "=")) {
    return staticValue(node.right);
  }
  if (node.type === "AwaitExpression") return staticValue(node.argument);
  if (node.type === "ParenthesizedExpression" || node.type === "ChainExpression") {
    return staticValue(node.expression);
  }
  return unknownStaticValue;
}

function staticStringValue(node) {
  const value = staticValue(node);
  if (value === unknownStaticValue || value === null) return null;
  return String(value);
}

function isDirectRuntimeReference(node) {
  let value = node;
  while (value?.type === "ChainExpression" || value?.type === "ParenthesizedExpression") {
    value = value.expression;
  }
  if (value?.type === "Identifier") return true;
  return value?.type === "MemberExpression"
    && isDirectRuntimeReference(value.object)
    && (!value.computed || isSideEffectFreeSelector(value.property));
}

function isSideEffectFreeSelector(node) {
  let value = node;
  while (value?.type === "ChainExpression" || value?.type === "ParenthesizedExpression") {
    value = value.expression;
  }
  if (["Identifier", "Literal", "ThisExpression"].includes(value?.type)) return true;
  if (value?.type === "MemberExpression") return isDirectRuntimeReference(value);
  if (value?.type === "ConditionalExpression") {
    return isSideEffectFreeSelector(value.test)
      && isSideEffectFreeSelector(value.consequent)
      && isSideEffectFreeSelector(value.alternate);
  }
  if (value?.type === "LogicalExpression" || value?.type === "BinaryExpression") {
    return isSideEffectFreeSelector(value.left) && isSideEffectFreeSelector(value.right);
  }
  if (value?.type === "UnaryExpression" && value.operator !== "delete") {
    return isSideEffectFreeSelector(value.argument);
  }
  if (value?.type === "TemplateLiteral") {
    return value.expressions.every(isSideEffectFreeSelector);
  }
  return false;
}

function walkAst(value, visitor) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = walkAst(entry, visitor);
      if (match) return match;
    }
    return null;
  }
  if (value === null || typeof value !== "object" || typeof value.type !== "string") {
    return null;
  }
  const match = visitor(value);
  if (match) return match;
  for (const [key, child] of Object.entries(value)) {
    if (["start", "end", "loc"].includes(key)) continue;
    const childMatch = walkAst(child, visitor);
    if (childMatch) return childMatch;
  }
  return null;
}

function withoutAstLiteralText(text, ast) {
  const characters = text.split("");
  walkAst(ast, (node) => {
    if (!["JSXText", "Literal", "TemplateElement"].includes(node.type)) return null;
    for (let index = node.start; index < node.end; index += 1) characters[index] = " ";
    return null;
  });
  return characters.join("");
}

export {
  isDirectRuntimeReference,
  staticStringValue,
  staticValue,
  unknownStaticValue,
  walkAst,
  withoutAstLiteralText
};
