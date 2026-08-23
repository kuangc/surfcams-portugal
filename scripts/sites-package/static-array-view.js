import {unwrapExpression} from "./credential-call-view.js";
import {arrayOperation} from "./static-array-operation.js";

const unknownArray = Symbol("unknown static array");
const arrayHole = Symbol("static array hole");
const optionalArraySegmentMarker = Symbol("optional static array segment");
const optionalStaticElementMarker = Symbol("optional static array element");
const materializedUndefined = {
  argument: {type: "Literal", value: 0},
  operator: "void",
  prefix: true,
  type: "UnaryExpression"
};

function producerState(context) {
  context.producerState.arrayElements ??= new WeakMap();
  context.producerState.arrayMaterializations ??= new WeakMap();
  context.producerState.arraySliceSummaries ??= new WeakMap();
  context.producerState.arrayStrings ??= new WeakMap();
  return context.producerState;
}

function optionalArraySegment(node) {
  return {[optionalArraySegmentMarker]: true, node};
}

function optionalArrayElement(node) {
  return {
    [optionalArraySegmentMarker]: true,
    [optionalStaticElementMarker]: true,
    node
  };
}

function isOptionalArraySegment(value) {
  return Boolean(value?.[optionalArraySegmentMarker]);
}

function isOptionalStaticArrayElement(value) {
  return Boolean(value?.[optionalStaticElementMarker]);
}

function optionalArraySegmentNode(value) {
  return value?.node;
}

function leafView(elements) {
  return {
    elements,
    kind: "leaf",
    length: elements.length,
    variableLength: elements.some(isOptionalArraySegment)
  };
}

function concatView(parts) {
  const nonempty = parts.filter((part) => part.length > 0);
  if (nonempty.length === 0) return leafView([]);
  if (nonempty.length === 1) return nonempty[0];
  return {
    kind: "concat",
    length: nonempty.reduce((sum, part) => sum + part.length, 0),
    parts: nonempty,
    variableLength: nonempty.some((part) => part.variableLength)
  };
}

function sliceView(source, start, end) {
  return {
    end,
    kind: "slice",
    length: Math.max(end - start, 0),
    source,
    start,
    variableLength: false
  };
}

function spreadView(source) {
  return {
    kind: "spread",
    length: source.length,
    source,
    variableLength: source.variableLength
  };
}

function operationDependencies(operation, context) {
  if (operation.kind === "literal") {
    return operation.elements
      .filter((element) => element?.type === "SpreadElement")
      .map((element) => element.argument);
  }
  if (operation.kind === "of") return [];
  const dependencies = [operation.receiver];
  if (operation.kind === "concat") {
    for (const argument of operation.arguments) {
      if (arrayOperation(argument, context)) dependencies.push(argument);
    }
  }
  return dependencies.filter(Boolean);
}

function integerOrInfinity(node, fallback, context) {
  if (node === undefined) return fallback;
  const primitive = context.primitiveOf(node);
  if (!primitive.known) return null;
  if (primitive.value === undefined) return fallback;
  let number;
  try {
    number = Number(primitive.value);
  } catch {
    return null;
  }
  if (Number.isNaN(number) || number === 0) return 0;
  return Number.isFinite(number) ? Math.trunc(number) : number;
}

function boundedIndex(relative, length) {
  if (relative === -Infinity) return 0;
  if (relative < 0) return Math.max(length + relative, 0);
  return Math.min(relative, length);
}

function variableSliceSummary(source, context) {
  const state = producerState(context);
  if (state.arraySliceSummaries.has(source)) {
    if (context.diagnostics) {
      context.diagnostics.staticArraySliceSummaryCacheHits =
        (context.diagnostics.staticArraySliceSummaryCacheHits ?? 0) + 1;
    }
    return state.arraySliceSummaries.get(source);
  }
  const elements = materializeArray(source, context);
  let firstVariable = -1;
  let lastVariable = -1;
  for (let index = 0; index < elements.length; index += 1) {
    if (context.diagnostics) {
      context.diagnostics.staticArraySliceMappingSteps =
        (context.diagnostics.staticArraySliceMappingSteps ?? 0) + 1;
    }
    if (!isOptionalArraySegment(elements[index])) continue;
    if (firstVariable === -1) firstVariable = index;
    lastVariable = index;
  }
  const prefixEnd = firstVariable === -1 ? elements.length : firstVariable;
  const suffixStart = lastVariable === -1 ? elements.length : lastVariable + 1;
  const summary = {
    approximation: null,
    elements,
    prefix: elements.slice(0, prefixEnd),
    suffix: elements.slice(suffixStart)
  };
  state.arraySliceSummaries.set(source, summary);
  return summary;
}

function conservativeSliceView(source, summary) {
  if (source.conservativeSlice) return source;
  if (summary.approximation) return summary.approximation;
  const view = leafView(summary.elements.map((element) =>
    isOptionalArraySegment(element) ? element : optionalArrayElement(element)
  ));
  view.conservativeSlice = true;
  summary.approximation = view;
  return view;
}

function variableSliceView(source, start, end, context) {
  if (start === Infinity || end === -Infinity) return leafView([]);
  const frontStart = start === -Infinity ? 0 : start;
  if (frontStart === 0 && end === Infinity) return source;
  if (
    frontStart >= 0
    && end >= 0
    && end !== Infinity
    && end <= frontStart
  ) return leafView([]);
  const summary = variableSliceSummary(source, context);
  if (
    frontStart >= 0
    && end >= 0
    && end !== Infinity
    && end <= summary.prefix.length
  ) {
    return leafView(summary.prefix.slice(
      Math.min(frontStart, end),
      end
    ));
  }
  if (start < 0 && start !== -Infinity) {
    const fromEnd = -start;
    if (fromEnd <= summary.suffix.length) {
      const suffixStart = summary.suffix.length - fromEnd;
      if (end === Infinity) {
        return leafView(summary.suffix.slice(suffixStart));
      }
      if (end < 0 && end !== -Infinity && -end <= summary.suffix.length) {
        return leafView(summary.suffix.slice(
          suffixStart,
          summary.suffix.length + end
        ));
      }
      if (end === 0) return leafView([]);
    }
  }
  return conservativeSliceView(source, summary);
}

function materializeArray(view, context) {
  const state = producerState(context);
  if (state.arrayMaterializations.has(view)) {
    return state.arrayMaterializations.get(view);
  }
  const elements = [];
  const pending = [{end: view.length, materializeHoles: false, start: 0, view}];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame.view.kind === "leaf") {
      for (let index = frame.start; index < frame.end; index += 1) {
        const element = frame.view.elements[index];
        elements.push(
          frame.materializeHoles && element === arrayHole
            ? materializedUndefined
            : element
        );
        if (context.diagnostics) {
          context.diagnostics.staticArrayElementMaterializations =
            (context.diagnostics.staticArrayElementMaterializations ?? 0) + 1;
        }
      }
      continue;
    }
    if (frame.view.kind === "slice") {
      pending.push({
        ...frame,
        end: frame.view.start + frame.end,
        start: frame.view.start + frame.start,
        view: frame.view.source
      });
      continue;
    }
    if (frame.view.kind === "spread") {
      pending.push({
        ...frame,
        materializeHoles: true,
        view: frame.view.source
      });
      continue;
    }
    const children = [];
    let offset = 0;
    for (const part of frame.view.parts) {
      const start = Math.max(frame.start - offset, 0);
      const end = Math.min(frame.end - offset, part.length);
      if (start < end) children.push({...frame, end, start, view: part});
      offset += part.length;
      if (offset >= frame.end) break;
    }
    pending.push(...children.reverse());
  }
  state.arrayMaterializations.set(view, elements);
  return elements;
}

function flattenToDepth(source, depth, cache, context) {
  const flattened = [];
  const pending = materializeArray(source, context)
    .map((element) => ({depth, element}))
    .reverse();
  while (pending.length > 0) {
    const frame = pending.pop();
    let element = frame.element;
    let optional = Boolean(frame.optional);
    if (isOptionalArraySegment(element)) {
      if (!isOptionalStaticArrayElement(element)) {
        flattened.push(element);
        continue;
      }
      optional = true;
      element = optionalArraySegmentNode(element);
    }
    if (element === arrayHole) continue;
    const nested = frame.depth > 0
      ? cachedArray(element, cache, context)
      : null;
    if (nested === unknownArray || nested === null) {
      const primitive = context.primitiveOf(element);
      flattened.push(
        frame.depth > 0 && !primitive.known
          ? optionalArraySegment(element)
          : optional ? optionalArrayElement(element) : element
      );
      continue;
    }
    const nestedElements = materializeArray(nested, context);
    for (let index = nestedElements.length - 1; index >= 0; index -= 1) {
      pending.push({
        depth: frame.depth - 1,
        element: nestedElements[index],
        optional
      });
    }
  }
  return leafView(flattened);
}

function cachedArray(node, cache, context) {
  const value = unwrapExpression(node);
  if (!value || typeof value !== "object") return unknownArray;
  if (!cache.has(value)) staticArrayElements(value, context);
  return cache.get(value) ?? unknownArray;
}

function evaluateArrayOperation(operation, cache, context) {
  if (operation.ambiguous) return unknownArray;
  if (operation.kind === "literal") {
    const parts = [];
    let elements = [];
    const flush = () => {
      if (elements.length > 0) parts.push(leafView(elements));
      elements = [];
    };
    for (const element of operation.elements) {
      if (element?.type !== "SpreadElement") {
        elements.push(element ?? arrayHole);
        continue;
      }
      flush();
      const spread = cachedArray(element.argument, cache, context);
      parts.push(
        spread === unknownArray
          ? leafView([optionalArraySegment(element.argument)])
          : spreadView(spread)
      );
    }
    flush();
    return concatView(parts);
  }
  if (operation.kind === "of") return leafView([...operation.arguments]);
  const source = cachedArray(operation.receiver, cache, context);
  if (source === unknownArray) return unknownArray;
  if (operation.kind === "slice") {
    if (context.diagnostics) {
      context.diagnostics.staticArraySliceOperations =
        (context.diagnostics.staticArraySliceOperations ?? 0) + 1;
    }
    const start = integerOrInfinity(operation.arguments[0], 0, context);
    const end = integerOrInfinity(
      operation.arguments[1],
      source.variableLength ? Infinity : source.length,
      context
    );
    if (start === null || end === null) {
      return conservativeSliceView(source, variableSliceSummary(source, context));
    }
    if (source.variableLength) {
      return variableSliceView(source, start, end, context);
    }
    return sliceView(
      source,
      boundedIndex(start, source.length),
      boundedIndex(end, source.length)
    );
  }
  if (operation.kind === "flat") {
    const depth = integerOrInfinity(operation.arguments[0], 1, context);
    if (depth === null) return unknownArray;
    return flattenToDepth(source, Math.max(depth, 0), cache, context);
  }
  const parts = [source];
  for (const argument of operation.arguments) {
    const nested = arrayOperation(argument, context)
      ? cachedArray(argument, cache, context)
      : unknownArray;
    if (nested !== unknownArray) {
      parts.push(nested);
      continue;
    }
    const primitive = context.primitiveOf(argument);
    parts.push(leafView([
      primitive.known ? argument : optionalArraySegment(argument)
    ]));
  }
  return concatView(parts);
}

function staticArrayElements(root, context) {
  const cache = producerState(context).arrayElements;
  const value = unwrapExpression(context.coercionTarget?.(root) ?? root);
  if (!value || typeof value !== "object") return null;
  if (cache.has(value)) {
    const cached = cache.get(value);
    return cached === unknownArray ? null : cached;
  }
  const pending = [{expanded: false, node: value}];
  while (pending.length > 0) {
    const frame = pending.pop();
    const node = unwrapExpression(frame.node);
    if (!node || typeof node !== "object" || cache.has(node)) continue;
    const operation = arrayOperation(node, context);
    if (!operation) {
      cache.set(node, unknownArray);
      continue;
    }
    if (!frame.expanded) {
      pending.push({expanded: true, node, operation});
      const dependencies = operationDependencies(operation, context);
      for (let index = dependencies.length - 1; index >= 0; index -= 1) {
        const dependency = unwrapExpression(dependencies[index]);
        if (dependency && !cache.has(dependency)) {
          pending.push({expanded: false, node: dependency});
        }
      }
      continue;
    }
    cache.set(node, evaluateArrayOperation(frame.operation, cache, context));
  }
  const result = cache.get(value);
  return result === unknownArray ? null : result;
}

export {
  arrayHole,
  isOptionalArraySegment,
  isOptionalStaticArrayElement,
  materializeArray,
  optionalArraySegmentNode,
  producerState,
  staticArrayElements
};
