function astChildren(node) {
  if (Array.isArray(node)) return node.filter(Boolean);
  if (!node || typeof node !== "object" || typeof node.type !== "string") return [];
  return Object.entries(node)
    .filter(([key]) => !["start", "end", "loc"].includes(key))
    .map(([, child]) => child)
    .filter((child) =>
      Array.isArray(child)
      || child !== null && typeof child === "object" && typeof child.type === "string"
    );
}

function patternBindings(pattern, trackedNames, bindings) {
  const pending = [pattern];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (value.type === "Identifier") {
      if (trackedNames.has(value.name)) bindings.add(value.name);
      continue;
    }
    if (value.type === "AssignmentPattern") {
      pending.push(value.left);
      continue;
    }
    if (value.type === "RestElement") {
      pending.push(value.argument);
      continue;
    }
    if (value.type === "ArrayPattern") {
      pending.push(...value.elements);
      continue;
    }
    if (value.type === "ObjectPattern") {
      for (const property of value.properties) {
        pending.push(property.type === "RestElement" ? property.argument : property.value);
      }
    }
  }
}

function createScope(parent, kind) {
  return {bindings: new Set(), kind, parent};
}

function nearestVariableScope(scope) {
  let current = scope;
  while (
    current
    && !["function", "program", "static-block"].includes(current.kind)
  ) current = current.parent;
  return current;
}

function addBinding(scope, pattern, trackedNames) {
  if (scope) patternBindings(pattern, trackedNames, scope.bindings);
}

function shadowedIdentifiers(ast, names, diagnostics) {
  const trackedNames = new Set(names);
  const scopeByNode = new WeakMap();
  const pending = [{node: ast, scope: null}];
  while (pending.length > 0) {
    const {node, scope: parentScope} = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        pending.push({node: node[index], scope: parentScope});
      }
      continue;
    }
    let scope = parentScope;
    let functionScopes = null;
    if (node.type === "Program") {
      scope = createScope(parentScope, "program");
    } else if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      if (node.type === "FunctionDeclaration") addBinding(parentScope, node.id, trackedNames);
      const parameterScope = createScope(parentScope, "function-parameters");
      const bodyScope = createScope(parameterScope, "function");
      scope = parameterScope;
      if (node.type === "FunctionExpression") addBinding(scope, node.id, trackedNames);
      for (const parameter of node.params) addBinding(scope, parameter, trackedNames);
      functionScopes = {bodyScope, parameterScope};
    } else if (["ClassDeclaration", "ClassExpression"].includes(node.type)) {
      if (node.type === "ClassDeclaration") addBinding(parentScope, node.id, trackedNames);
      scope = createScope(parentScope, "class");
      addBinding(scope, node.id, trackedNames);
    } else if (node.type === "CatchClause") {
      scope = createScope(parentScope, "block");
      addBinding(scope, node.param, trackedNames);
    } else if ([
      "BlockStatement",
      "ForInStatement",
      "ForOfStatement",
      "ForStatement",
      "SwitchStatement"
    ].includes(node.type)) {
      scope = createScope(parentScope, "block");
    } else if (node.type === "StaticBlock") {
      scope = createScope(parentScope, "static-block");
    }
    scopeByNode.set(node, scope);
    if (node.type === "VariableDeclaration") {
      const bindingScope = node.kind === "var" ? nearestVariableScope(scope) : scope;
      for (const declaration of node.declarations) {
        addBinding(bindingScope, declaration.id, trackedNames);
      }
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) addBinding(scope, specifier.local, trackedNames);
    }
    if (functionScopes) {
      pending.push({node: node.body, scope: functionScopes.bodyScope});
      for (let index = node.params.length - 1; index >= 0; index -= 1) {
        pending.push({node: node.params[index], scope: functionScopes.parameterScope});
      }
      if (node.id) pending.push({node: node.id, scope: functionScopes.parameterScope});
      continue;
    }
    const children = astChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({node: children[index], scope});
    }
  }

  const shadowed = new WeakSet();
  const resolutionCache = new WeakMap();
  function scopeShadowsName(initialScope, name) {
    const uncached = [];
    let scope = initialScope;
    let result = false;
    while (scope) {
      const cachedNames = resolutionCache.get(scope);
      if (cachedNames?.has(name)) {
        result = cachedNames.get(name);
        break;
      }
      uncached.push(scope);
      if (diagnostics) {
        diagnostics.lexicalBindingResolutionSteps =
          (diagnostics.lexicalBindingResolutionSteps ?? 0) + 1;
      }
      if (scope.bindings.has(name)) {
        result = true;
        break;
      }
      scope = scope.parent;
    }
    for (const visited of uncached) {
      let cachedNames = resolutionCache.get(visited);
      if (!cachedNames) {
        cachedNames = new Map();
        resolutionCache.set(visited, cachedNames);
      }
      cachedNames.set(name, result);
    }
    return result;
  }
  const identifiers = [ast];
  while (identifiers.length > 0) {
    const node = identifiers.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      identifiers.push(...node);
      continue;
    }
    if (node.type === "Identifier" && trackedNames.has(node.name)) {
      if (scopeShadowsName(scopeByNode.get(node), node.name)) shadowed.add(node);
    }
    identifiers.push(...astChildren(node));
  }
  return shadowed;
}

export {shadowedIdentifiers};
