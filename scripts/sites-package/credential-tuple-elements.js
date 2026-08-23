import { isDirectRuntimeReference } from "./ast-utils.js";
import {
  intrinsicCallee,
  staticKey,
  unwrapCallee,
  unwrapExpression
} from "./credential-call-view.js";

function createCredentialTupleAnalyzer() {
  const cache = new WeakMap();

  function shape(node) {
    if (node.type === "ArrayExpression") {
      return {kind: "items", items: node.elements};
    }
    if (!["CallExpression", "NewExpression"].includes(node.type)) return null;
    const intrinsic = intrinsicCallee(node.callee);
    if (
      (intrinsic.method === "Array"
        && [null, "globalThis", "self", "window"].includes(intrinsic.owner))
      || (intrinsic.owner === "Array" && intrinsic.method === "of")
    ) return {kind: "items", items: node.arguments};
    const callee = unwrapCallee(node.callee);
    if (
      callee?.type === "MemberExpression"
      && staticKey(callee.property, callee.computed) === "concat"
    ) {
      return {
        arguments: node.arguments,
        kind: "concat",
        receiver: callee.object
      };
    }
    return null;
  }

  function dynamicSegment(node) {
    return node?.type === "SpreadElement"
      ? node
      : {argument: node, type: "SpreadElement"};
  }

  function cachedElements(node) {
    const value = unwrapExpression(node);
    return value && typeof value === "object" && cache.has(value)
      ? cache.get(value)
      : null;
  }

  function appendItem(output, item) {
    if (item?.type !== "SpreadElement") {
      output.push(item);
      return;
    }
    const spread = cachedElements(item.argument);
    output.push(...(spread ?? [dynamicSegment(item)]));
  }

  function appendConcatPart(output, part) {
    const nested = cachedElements(part);
    if (nested) {
      output.push(...nested);
    } else if (isDirectRuntimeReference(unwrapExpression(part))) {
      output.push(dynamicSegment(part));
    } else {
      output.push(part);
    }
  }

  function compute(node, nodeShape) {
    const output = [];
    if (nodeShape.kind === "items") {
      for (const item of nodeShape.items) appendItem(output, item);
      return output;
    }
    appendConcatPart(output, nodeShape.receiver);
    for (const argument of nodeShape.arguments) {
      if (argument?.type !== "SpreadElement") {
        appendConcatPart(output, argument);
        continue;
      }
      const expandedArguments = cachedElements(argument.argument);
      if (!expandedArguments) {
        output.push(dynamicSegment(argument));
        continue;
      }
      for (const expanded of expandedArguments) appendConcatPart(output, expanded);
    }
    return output;
  }

  function elements(node) {
    const root = unwrapExpression(node);
    if (!root || typeof root !== "object") return null;
    const pending = [{expanded: false, node: root}];
    while (pending.length > 0) {
      const frame = pending.pop();
      const value = unwrapExpression(frame.node);
      if (!value || typeof value !== "object" || cache.has(value)) continue;
      const nodeShape = shape(value);
      if (!nodeShape) {
        cache.set(value, null);
        continue;
      }
      if (frame.expanded) {
        cache.set(value, compute(value, nodeShape));
        continue;
      }
      pending.push({expanded: true, node: value});
      const children = nodeShape.kind === "items"
        ? nodeShape.items
          .filter((item) => item?.type === "SpreadElement")
          .map((item) => item.argument)
        : [nodeShape.receiver, ...nodeShape.arguments.map((argument) =>
          argument?.type === "SpreadElement" ? argument.argument : argument
        )];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = unwrapExpression(children[index]);
        if (child && typeof child === "object" && !cache.has(child)) {
          pending.push({expanded: false, node: child});
        }
      }
    }
    return cache.get(root) ?? null;
  }

  return {elements};
}

export { createCredentialTupleAnalyzer };
