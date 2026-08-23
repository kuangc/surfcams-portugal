import {
  arrayHole,
  isOptionalArraySegment,
  isOptionalStaticArrayElement,
  materializeArray,
  optionalArraySegmentNode,
  producerState,
  staticArrayElements
} from "./static-array-view.js";

function staticArrayIndexOutcomes(root, index, context) {
  const view = staticArrayElements(root, context);
  if (!view) return null;
  const state = producerState(context);
  state.arrayIndexOutcomes ??= new WeakMap();
  let indexed = state.arrayIndexOutcomes.get(view);
  if (!indexed) {
    indexed = new Map();
    state.arrayIndexOutcomes.set(view, indexed);
  }
  if (indexed.has(index)) return indexed.get(index);
  const nodes = [];
  const seen = new Set();
  let dynamic = false;
  let fixedBefore = 0;
  let optionalBefore = false;
  let undefinedOutcome = false;
  for (const element of materializeArray(view, context)) {
    if (context.diagnostics) {
      context.diagnostics.staticArrayIndexOutcomeSteps =
        (context.diagnostics.staticArrayIndexOutcomeSteps ?? 0) + 1;
    }
    if (isOptionalArraySegment(element)) {
      if (fixedBefore <= index) {
        if (isOptionalStaticArrayElement(element)) {
          const candidate = optionalArraySegmentNode(element);
          if (candidate === arrayHole) {
            undefinedOutcome = true;
          } else if (!seen.has(candidate)) {
            seen.add(candidate);
            nodes.push(candidate);
          }
        } else {
          dynamic = true;
        }
      }
      optionalBefore = true;
      continue;
    }
    const canOccupyIndex = optionalBefore
      ? fixedBefore <= index
      : fixedBefore === index;
    if (canOccupyIndex) {
      if (element === arrayHole) {
        undefinedOutcome = true;
      } else if (!seen.has(element)) {
        seen.add(element);
        nodes.push(element);
      }
    }
    fixedBefore += 1;
  }
  if (fixedBefore <= index) undefinedOutcome = true;
  const result = {conservative: false, dynamic, nodes, undefinedOutcome};
  indexed.set(index, result);
  return result;
}

export {staticArrayIndexOutcomes};
