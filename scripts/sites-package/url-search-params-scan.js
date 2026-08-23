import {
  isDirectRuntimeReference
} from "./ast-utils.js";

function unwrapExpression(node) {
  while (["ChainExpression", "ParenthesizedExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function flattenConcatenation(node) {
  const children = [];
  const pending = [node];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value?.type === "BinaryExpression" && value.operator === "+") {
      pending.push(value.right, value.left);
    } else {
      children.push(value);
    }
  }
  return children;
}

function createUrlSearchParamsAnalyzer({
  credentialLabel,
  credentialPrefixLabel,
  hasStaticOutcome
}) {
  const maxStaticFieldChars = 256;
  const maxPartialFields = 64;
  const composedTextCache = new WeakMap();
  const partialFieldCache = new WeakMap();
  const resultCache = new WeakMap();
  const trailingCache = new WeakMap();

  function staticTextLabel(text) {
    for (const [key, value] of new URLSearchParams(text)) {
      const label = credentialLabel(key);
      if (label && value.length > 0) return label;
    }
    return null;
  }

  function trailingLabelForText(text) {
    if (!text.endsWith("=")) return null;
    const entries = [...new URLSearchParams(text)];
    const [key, value] = entries.at(-1) ?? [];
    return value === "" ? credentialLabel(key) : null;
  }

  function partialKeyLabel(text) {
    const field = text.split("&").at(-1);
    if (field.length === 0 || field.includes("=")) return null;
    const [key] = [...new URLSearchParams(`${field}=`)][0] ?? [];
    return credentialPrefixLabel(key);
  }

  function directStaticText(value) {
    if (value.type === "Literal") {
      if (value.regex) return null;
      return ["string", "number", "boolean", "bigint"].includes(typeof value.value)
        || value.value === null
        ? String(value.value)
        : null;
    }
    if (value.type === "TemplateElement") {
      return value.value?.cooked ?? value.value?.raw ?? "";
    }
    return null;
  }

  function boundedStaticFieldText(text) {
    if (text.length <= maxStaticFieldChars) return text;
    const firstDelimiter = text.indexOf("&");
    if (firstDelimiter === -1) return text.slice(0, maxStaticFieldChars);
    const lastDelimiter = text.lastIndexOf("&");
    const leadingBudget = Math.floor((maxStaticFieldChars - 1) / 2);
    const trailingBudget = maxStaticFieldChars - leadingBudget - 1;
    return `${text.slice(0, firstDelimiter).slice(0, leadingBudget)}&${
      text.slice(lastDelimiter + 1).slice(0, trailingBudget)
    }`;
  }

  function composedShape(value) {
    if (value.type === "BinaryExpression" && value.operator === "+") {
      return { children: [value.left, value.right], kind: "concat" };
    }
    if (value.type === "TemplateLiteral") {
      return {
        children: value.quasis.flatMap((quasi, index) =>
          index < value.expressions.length ? [quasi, value.expressions[index]] : [quasi]
        ),
        kind: "concat"
      };
    }
    if (
      value.type === "AssignmentPattern"
      || value.type === "AssignmentExpression" && value.operator === "="
    ) return { children: [value.right], kind: "wrapper" };
    if (value.type === "AwaitExpression") {
      return { children: [value.argument], kind: "wrapper" };
    }
    if (value.type === "SequenceExpression") {
      return { children: [value.expressions.at(-1)], kind: "wrapper" };
    }
    if (!["CallExpression", "NewExpression"].includes(value.type)) return null;
    const callee = unwrapExpression(value.callee);
    const method = callee?.type === "MemberExpression"
      ? (callee.computed ? directStaticText(unwrapExpression(callee.property)) : callee.property?.name)
      : null;
    if (method === "concat") {
      return { children: [callee.object, ...value.arguments], kind: "concat" };
    }
    const receiver = unwrapExpression(callee?.object);
    if (method === "join" && receiver?.type === "ArrayExpression") {
      return {
        children: [value.arguments[0], ...receiver.elements].filter(Boolean),
        elements: receiver.elements,
        kind: "join",
        separator: value.arguments[0]
      };
    }
    return null;
  }

  function cachedComposedText(node) {
    const value = unwrapExpression(node);
    return value && typeof value === "object" ? composedTextCache.get(value) ?? null : null;
  }

  function staticComposedText(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object") return null;
    if (composedTextCache.has(root)) return composedTextCache.get(root);
    const pending = [{ expanded: false, node: root }];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (!value || typeof value !== "object" || composedTextCache.has(value)) continue;
      const shape = composedShape(value);
      if (!frame.expanded && shape) {
        pending.push({ expanded: true, node: value });
        for (let index = shape.children.length - 1; index >= 0; index -= 1) {
          const child = unwrapExpression(shape.children[index]);
          if (child && typeof child === "object" && !composedTextCache.has(child)) {
            pending.push({ expanded: false, node: child });
          }
        }
        continue;
      }
      let text = directStaticText(value);
      if (shape?.kind === "wrapper") {
        text = cachedComposedText(shape.children[0]);
      } else if (shape?.kind === "concat") {
        const parts = shape.children.map(cachedComposedText);
        text = parts.every((part) => part !== null) ? parts.join("") : null;
      } else if (shape?.kind === "join") {
        const separator = shape.separator
          ? cachedComposedText(shape.separator)
          : ",";
        const parts = shape.elements.map((element) => {
          if (element === null || unwrapExpression(element)?.value === null) return "";
          return cachedComposedText(element);
        });
        text = separator !== null && parts.every((part) => part !== null)
          ? parts.join(separator)
          : null;
      }
      if (text !== null) text = boundedStaticFieldText(text);
      composedTextCache.set(value, text);
    }
    return composedTextCache.get(root) ?? null;
  }

  function partialFieldChildren(value) {
    if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
      return value.type === "ConditionalExpression"
        ? [value.consequent, value.alternate]
        : [value.left, value.right];
    }
    if (["AssignmentPattern", "AssignmentExpression"].includes(value.type)) {
      return [value.right];
    }
    if (value.type === "AwaitExpression") return [value.argument];
    if (value.type === "SequenceExpression") return [value.expressions.at(-1)];
    return [];
  }

  function possiblePartialFields(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object") return { fields: [], overflow: false };
    if (partialFieldCache.has(root)) return partialFieldCache.get(root);
    const pending = [{ expanded: false, node: root }];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (!value || typeof value !== "object" || partialFieldCache.has(value)) continue;
      const text = staticComposedText(value);
      const children = text === null ? partialFieldChildren(value) : [];
      if (!frame.expanded && children.length > 0) {
        pending.push({ expanded: true, node: value });
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = unwrapExpression(children[index]);
          if (child && typeof child === "object" && !partialFieldCache.has(child)) {
            pending.push({ expanded: false, node: child });
          }
        }
        continue;
      }
      let fields = text !== null && partialKeyLabel(text)
        ? [text.split("&").at(-1)]
        : [];
      let overflow = false;
      if (text === null) {
        const summaries = children.map((child) =>
          partialFieldCache.get(unwrapExpression(child)) ?? { fields: [], overflow: false }
        );
        overflow = summaries.some((summary) => summary.overflow);
        fields = [...new Set(summaries.flatMap((summary) => summary.fields))];
        if (fields.length > maxPartialFields) {
          overflow = true;
          fields = fields.slice(0, maxPartialFields);
        }
      }
      partialFieldCache.set(value, { fields, overflow });
    }
    return partialFieldCache.get(root) ?? { fields: [], overflow: false };
  }

  function partialCompositionLabel(children) {
    for (let index = 0; index < children.length - 1; index += 1) {
      const partials = possiblePartialFields(children[index]);
      if (partials.overflow) return credentialLabel("wmsAuthSign");
      for (const prefix of partials.fields) {
        let candidate = prefix;
        for (let next = index + 1; next < children.length; next += 1) {
          const text = typeof children[next] === "string"
            ? children[next]
            : staticComposedText(children[next]);
          if (text === null || candidate.length + text.length > maxStaticFieldChars) break;
          candidate += text;
          const label = staticTextLabel(candidate);
          if (label) return label;
        }
      }
    }
    return null;
  }

  function trailingChildren(value) {
    if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
      return value.type === "ConditionalExpression"
        ? [value.consequent, value.alternate]
        : [value.left, value.right];
    }
    if (["AssignmentPattern", "AssignmentExpression"].includes(value.type)) {
      return [value.right];
    }
    if (value.type === "AwaitExpression") return [value.argument];
    if (value.type === "SequenceExpression") return [value.expressions.at(-1)];
    if (value.type === "BinaryExpression" && value.operator === "+") {
      return [value.left, value.right];
    }
    if (value.type === "TemplateLiteral" && value.expressions.length > 0) {
      return [value.expressions.at(-1)];
    }
    return [];
  }

  function cachedTrailingLabel(node) {
    const value = unwrapExpression(node);
    return value && typeof value === "object" ? trailingCache.get(value) ?? null : null;
  }

  function possibleTrailingLabel(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object") return null;
    if (trailingCache.has(root)) return trailingCache.get(root);
    const pending = [{ expanded: false, node: root }];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (!value || typeof value !== "object" || trailingCache.has(value)) continue;
      const text = staticComposedText(value);
      const children = text === null ? trailingChildren(value) : [];
      if (!frame.expanded && children.length > 0) {
        pending.push({ expanded: true, node: value });
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = unwrapExpression(children[index]);
          if (child && typeof child === "object" && !trailingCache.has(child)) {
            pending.push({ expanded: false, node: child });
          }
        }
        continue;
      }
      let label = text === null ? null : trailingLabelForText(text);
      if (text === null) {
        if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
          label = children.map(cachedTrailingLabel).find(Boolean) ?? null;
        } else if (
          ["AssignmentPattern", "AssignmentExpression", "AwaitExpression", "SequenceExpression"]
            .includes(value.type)
        ) {
          label = cachedTrailingLabel(children.at(-1));
        } else if (value.type === "BinaryExpression" && value.operator === "+") {
          label = staticComposedText(value.right) === ""
            ? cachedTrailingLabel(value.left)
            : cachedTrailingLabel(value.right);
        } else if (value.type === "TemplateLiteral") {
          const tail = value.quasis.at(-1)?.value?.cooked ?? "";
          label = tail === "" && value.expressions.length > 0
            ? cachedTrailingLabel(value.expressions.at(-1))
            : trailingLabelForText(tail);
        }
      }
      trailingCache.set(value, label);
    }
    return trailingCache.get(root) ?? null;
  }

  function staticChildText(child) {
    return typeof child === "string" ? child : staticComposedText(child);
  }

  function cachedFindLabel(node) {
    const value = unwrapExpression(node);
    if (!value || typeof value !== "object" || isDirectRuntimeReference(value)) return null;
    return resultCache.get(value) ?? null;
  }

  function orderedChildrenLabel(children) {
    const partialLabel = partialCompositionLabel(children);
    if (partialLabel) return partialLabel;
    const state = {
      deadField: false,
      dynamicLabel: null,
      field: "",
      fieldBlocked: false,
      pendingLabel: null
    };

    function appendStaticText(text) {
      if (state.dynamicLabel) {
        const delimiter = text.indexOf("&");
        if (delimiter === -1) return text.length > 0 ? state.dynamicLabel : null;
        if (delimiter > 0) return state.dynamicLabel;
        state.dynamicLabel = null;
      }
      for (const [index, part] of text.split("&").entries()) {
        if (index > 0) {
          state.deadField = false;
          state.field = "";
          state.fieldBlocked = false;
        }
        if (state.deadField) {
          if (state.fieldBlocked) continue;
          const candidate = state.field + part;
          const label = staticTextLabel(candidate);
          if (label) return label;
          if (candidate.length > maxStaticFieldChars) {
            state.field = "";
            state.fieldBlocked = true;
          } else {
            state.field = candidate;
          }
          continue;
        }
        const candidate = state.field + part;
        const label = staticTextLabel(candidate);
        if (label) return label;
        if (candidate.length > maxStaticFieldChars) {
          state.deadField = true;
          state.field = "";
          state.fieldBlocked = true;
        } else {
          state.field = candidate;
        }
      }
      state.pendingLabel = state.deadField ? null : trailingLabelForText(state.field);
      return null;
    }

    for (const child of children) {
      const text = staticChildText(child);
      if (text !== null) {
        const label = appendStaticText(text);
        if (label) return label;
        continue;
      }
      const label = cachedFindLabel(child);
      if (label) return label;
      if (state.pendingLabel) {
        if (hasStaticOutcome(child)) return state.pendingLabel;
        state.dynamicLabel = state.pendingLabel;
        state.pendingLabel = null;
        state.deadField = true;
        state.field = "";
        state.fieldBlocked = false;
        continue;
      }
      const childPending = possibleTrailingLabel(child);
      state.pendingLabel = childPending;
      state.dynamicLabel = null;
      state.deadField = childPending === null;
      state.field = "";
      state.fieldBlocked = false;
    }
    return null;
  }

  function joinedChildren(callee, argumentsList) {
    const receiver = unwrapExpression(callee.object);
    if (receiver?.type !== "ArrayExpression") return [receiver, ...argumentsList];
    const separator = argumentsList.length === 0
      ? ","
      : staticComposedText(argumentsList[0]);
    if (separator === null) return [receiver, ...argumentsList];
    const children = [];
    for (let index = 0; index < receiver.elements.length; index += 1) {
      if (index > 0) children.push(separator);
      children.push(receiver.elements[index]);
    }
    return children;
  }

  function concatenatedChildren(callee, argumentsList) {
    if (staticComposedText(callee.object) === null) {
      return [callee.object, ...argumentsList];
    }
    return [callee.object, ...argumentsList.map((argument) => {
      const value = staticComposedText(argument);
      return value === null ? argument : value;
    })];
  }

  function orderedValueChildren(value) {
    if (value.type === "BinaryExpression" && value.operator === "+") {
      return flattenConcatenation(value);
    }
    if (value.type === "TemplateLiteral") {
      return value.quasis.flatMap((quasi, index) =>
        index < value.expressions.length ? [quasi, value.expressions[index]] : [quasi]
      );
    }
    if (["CallExpression", "NewExpression"].includes(value.type)) {
      const callee = unwrapExpression(value.callee);
      const method = callee?.type === "MemberExpression"
        ? (callee.computed
          ? staticComposedText(callee.property)
          : callee.property?.name)
        : null;
      if (method === "concat") return concatenatedChildren(callee, value.arguments);
      if (method === "join") return joinedChildren(callee, value.arguments);
      return callee?.type === "MemberExpression"
        ? [callee.object, ...value.arguments]
        : value.arguments;
    }
    if (value.type === "TaggedTemplateExpression") return [value.quasi];
    if (value.type === "ArrayExpression") return value.elements;
    return null;
  }

  function findDependencies(value) {
    if (directStaticText(value) !== null) return [];
    if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
      return value.type === "ConditionalExpression"
        ? [value.consequent, value.alternate]
        : [value.left, value.right];
    }
    if (["AssignmentPattern", "AssignmentExpression"].includes(value.type)) {
      return [value.right];
    }
    if (value.type === "AwaitExpression") return [value.argument];
    if (value.type === "SequenceExpression") return [value.expressions.at(-1)];
    return (orderedValueChildren(value) ?? []).filter((child) =>
      typeof child !== "string" && staticChildText(child) === null
    );
  }

  function computeFindLabel(value) {
    const text = directStaticText(value);
    if (text !== null) return staticTextLabel(text);
    if (["ConditionalExpression", "LogicalExpression"].includes(value.type)) {
      const branches = value.type === "ConditionalExpression"
        ? [value.consequent, value.alternate]
        : [value.left, value.right];
      return branches.map(cachedFindLabel).find(Boolean) ?? null;
    }
    if (["AssignmentPattern", "AssignmentExpression"].includes(value.type)) {
      return cachedFindLabel(value.right);
    }
    if (value.type === "AwaitExpression") return cachedFindLabel(value.argument);
    if (value.type === "SequenceExpression") {
      return cachedFindLabel(value.expressions.at(-1));
    }
    const children = orderedValueChildren(value);
    return children ? orderedChildrenLabel(children) : null;
  }

  function find(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object" || isDirectRuntimeReference(root)) return null;
    if (resultCache.has(root)) return resultCache.get(root);
    const pending = [{ expanded: false, node: root }];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (
        !value
        || typeof value !== "object"
        || isDirectRuntimeReference(value)
        || resultCache.has(value)
      ) continue;
      const dependencies = findDependencies(value);
      if (!frame.expanded && dependencies.length > 0) {
        pending.push({ expanded: true, node: value });
        for (let index = dependencies.length - 1; index >= 0; index -= 1) {
          const child = unwrapExpression(dependencies[index]);
          if (
            child
            && typeof child === "object"
            && !isDirectRuntimeReference(child)
            && !resultCache.has(child)
          ) pending.push({ expanded: false, node: child });
        }
        continue;
      }
      resultCache.set(value, computeFindLabel(value));
    }
    return resultCache.get(root) ?? null;
  }

  return {find};
}

export { createUrlSearchParamsAnalyzer };
