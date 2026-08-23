const unknownStaticValue = Symbol("unknown static value");
const staticValueCache = new WeakMap();

function staticValue(node) {
  if (!node || typeof node !== "object") return unknownStaticValue;
  if (staticValueCache.has(node)) return staticValueCache.get(node);
  const pending = [{ expanded: false, node }];
  while (pending.length > 0) {
    const frame = pending.pop();
    const value = frame.node;
    if (!value || typeof value !== "object" || staticValueCache.has(value)) continue;
    const children = staticValueChildren(value);
    if (!frame.expanded && children.length > 0) {
      pending.push({ expanded: true, node: value });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child && typeof child === "object" && !staticValueCache.has(child)) {
          pending.push({ expanded: false, node: child });
        }
      }
      continue;
    }
    staticValueCache.set(value, computeStaticValue(value));
  }
  return staticValueCache.has(node) ? staticValueCache.get(node) : unknownStaticValue;
}

function staticValueChildren(node) {
  if (node.type === "TemplateLiteral") {
    return node.quasis.flatMap((quasi, index) =>
      index < node.expressions.length ? [quasi, node.expressions[index]] : [quasi]
    );
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [node.left, node.right];
  }
  if (node.type === "UnaryExpression" && ["+", "-", "!", "~"].includes(node.operator)) {
    return [node.argument];
  }
  if (node.type === "ConditionalExpression") {
    return [node.test, node.consequent, node.alternate];
  }
  if (node.type === "LogicalExpression") return [node.left, node.right];
  if (node.type === "SequenceExpression") return [node.expressions.at(-1)];
  if (
    node.type === "AssignmentPattern"
    || node.type === "AssignmentExpression" && node.operator === "="
  ) return [node.right];
  if (node.type === "AwaitExpression") return [node.argument];
  if (node.type === "ParenthesizedExpression" || node.type === "ChainExpression") {
    return [node.expression];
  }
  return [];
}

function cachedStaticValue(node) {
  return node && typeof node === "object" && staticValueCache.has(node)
    ? staticValueCache.get(node)
    : unknownStaticValue;
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
      value += cachedStaticValue(node.quasis[index]);
      if (index < node.expressions.length) {
        const expression = cachedStaticValue(node.expressions[index]);
        if (expression === unknownStaticValue) return unknownStaticValue;
        value += String(expression);
      }
    }
    return value;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = cachedStaticValue(node.left);
    const right = cachedStaticValue(node.right);
    if (left === unknownStaticValue || right === unknownStaticValue) return unknownStaticValue;
    try {
      return left + right;
    } catch {
      return unknownStaticValue;
    }
  }
  if (node.type === "UnaryExpression" && ["+", "-", "!", "~"].includes(node.operator)) {
    const argument = cachedStaticValue(node.argument);
    if (argument === unknownStaticValue) return unknownStaticValue;
    try {
      if (node.operator === "!") return !argument;
      if (node.operator === "~") return ~argument;
      return node.operator === "-" ? -argument : +argument;
    } catch {
      return unknownStaticValue;
    }
  }
  if (node.type === "ConditionalExpression") {
    const test = cachedStaticValue(node.test);
    if (test !== unknownStaticValue) {
      return cachedStaticValue(test ? node.consequent : node.alternate);
    }
    const consequent = cachedStaticValue(node.consequent);
    const alternate = cachedStaticValue(node.alternate);
    return consequent !== unknownStaticValue && Object.is(consequent, alternate)
      ? consequent
      : unknownStaticValue;
  }
  if (node.type === "LogicalExpression") {
    const left = cachedStaticValue(node.left);
    if (left === unknownStaticValue) return unknownStaticValue;
    const right = cachedStaticValue(node.right);
    if (node.operator === "||") return left || right;
    if (node.operator === "&&") return left && right;
    if (node.operator === "??") return left ?? right;
  }
  if (node.type === "SequenceExpression") return cachedStaticValue(node.expressions.at(-1));
  if (node.type === "AssignmentPattern" || (node.type === "AssignmentExpression" && node.operator === "=")) {
    return cachedStaticValue(node.right);
  }
  if (node.type === "AwaitExpression") return cachedStaticValue(node.argument);
  if (node.type === "ParenthesizedExpression" || node.type === "ChainExpression") {
    return cachedStaticValue(node.expression);
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
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (
      current === null
      || typeof current !== "object"
      || typeof current.type !== "string"
    ) continue;
    const match = visitor(current);
    if (match) return match;
    const children = Object.entries(current)
      .filter(([key]) => !["start", "end", "loc"].includes(key));
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index][1]);
    }
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
