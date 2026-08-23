import { staticStringValue } from "./ast-utils.js";

function unwrapExpression(node) {
  while (["ChainExpression", "ParenthesizedExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function isExecutionBoundary(node) {
  return /^(?:Function|Class)/.test(node?.type) || node?.type === "ArrowFunctionExpression";
}

function staticPropertyKey(property) {
  if (!property?.computed && property?.key?.type === "Identifier") {
    return property.key.name;
  }
  return staticStringValue(property?.key);
}

function createCredentialAssignmentIndex({
  ast,
  diagnostics,
  hasStaticOutcome,
  referencePath
}) {
  let assignmentIndex = null;
  let executionBoundaries = null;
  const summariesBuilding = new WeakSet();

  function objectPropertyProjection(object, key) {
    let ambiguous = false;
    let resolved = false;
    let value = null;
    for (const property of object.properties) {
      if (property.type === "SpreadElement") {
        const argument = unwrapExpression(property.argument);
        if (argument?.type !== "ObjectExpression") {
          ambiguous = true;
          continue;
        }
        const nested = objectPropertyProjection(argument, key);
        if (nested.resolved) {
          ({ambiguous, value} = nested);
          resolved = true;
        } else if (nested.ambiguous) {
          ambiguous = true;
        }
        continue;
      }
      if (property.type !== "Property") {
        ambiguous = true;
        continue;
      }
      const propertyKey = staticPropertyKey(property);
      if (propertyKey === null) {
        ambiguous = true;
      } else if (propertyKey === key) {
        ambiguous = false;
        resolved = true;
        value = property.value;
      }
    }
    return {ambiguous, resolved, value};
  }

  function patternRecords(pattern, source, records = []) {
    const target = unwrapExpression(pattern);
    const value = unwrapExpression(source);
    if (!target || typeof target !== "object") return records;
    if (target.type === "RestElement") return patternRecords(target.argument, value, records);
    if (target.type === "AssignmentPattern") {
      patternRecords(target.left, value, records);
      return patternRecords(target.left, target.right, records);
    }
    if (target.type === "ArrayPattern") {
      for (let index = 0; index < target.elements.length; index += 1) {
        patternRecords(
          target.elements[index],
          value?.type === "ArrayExpression" ? value.elements[index] : value,
          records
        );
      }
      return records;
    }
    if (target.type === "ObjectPattern") {
      for (const property of target.properties) {
        if (property.type === "RestElement") {
          patternRecords(property.argument, value, records);
          continue;
        }
        const key = staticPropertyKey(property);
        const projection = value?.type === "ObjectExpression"
          ? objectPropertyProjection(value, key)
          : null;
        const projectedValue = projection?.ambiguous
          ? value
          : projection?.resolved ? projection.value : value?.type === "ObjectExpression" ? null : value;
        patternRecords(property.value, projectedValue, records);
      }
      return records;
    }
    const path = referencePath(target);
    if (path !== null) records.push({path, value});
    return records;
  }

  function ensureIndex() {
    if (assignmentIndex) return;
    assignmentIndex = new Map();
    executionBoundaries = new WeakMap();
    const pending = [{boundary: null, value: ast}];
    while (pending.length > 0) {
      const {boundary, value} = pending.pop();
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          pending.push({boundary, value: value[index]});
        }
        continue;
      }
      if (!value || typeof value !== "object" || typeof value.type !== "string") continue;
      executionBoundaries.set(value, boundary);
      if (diagnostics) {
        diagnostics.credentialAssignmentNodes =
          (diagnostics.credentialAssignmentNodes ?? 0) + 1;
      }
      if (
        value.type === "AssignmentExpression"
        && ["=", "||=", "&&=", "??="].includes(value.operator)
      ) {
        const records = ["ArrayPattern", "ObjectPattern"].includes(value.left?.type)
          ? patternRecords(value.left, value.right)
          : [{path: referencePath(value.left), value: value.right}];
        for (const record of records) {
          if (record.path === null) continue;
          const groups = assignmentIndex.get(record.path) ?? new Map();
          const group = groups.get(boundary) ?? {assignments: [], unsafePrefix: null};
          group.assignments.push({node: value, value: record.value});
          groups.set(boundary, group);
          assignmentIndex.set(record.path, groups);
        }
      }
      const childBoundary = isExecutionBoundary(value) ? value : boundary;
      const children = Object.entries(value)
        .filter(([key]) => !["start", "end", "loc"].includes(key));
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({boundary: childBoundary, value: children[index][1]});
      }
    }
    for (const groups of assignmentIndex.values()) {
      for (const group of groups.values()) {
        group.assignments.sort((left, right) => left.node.start - right.node.start);
      }
    }
  }

  function lowerBound(assignments, start) {
    let low = 0;
    let high = assignments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (assignments[middle].node.start < start) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function unsafePrefix(group) {
    if (group.unsafePrefix) return group.unsafePrefix;
    if (summariesBuilding.has(group)) return null;
    summariesBuilding.add(group);
    const prefix = [0];
    for (const assignment of group.assignments) {
      if (diagnostics) {
        diagnostics.credentialAssignmentCandidateInspections =
          (diagnostics.credentialAssignmentCandidateInspections ?? 0) + 1;
      }
      prefix.push(prefix.at(-1) + Number(hasStaticOutcome(assignment.value)));
    }
    summariesBuilding.delete(group);
    group.unsafePrefix = prefix;
    return prefix;
  }

  function assignsStaticValue(node, path) {
    const value = unwrapExpression(node);
    if (!value || typeof value !== "object" || isExecutionBoundary(value)) return false;
    ensureIndex();
    const boundary = executionBoundaries.get(value) ?? null;
    const group = assignmentIndex.get(path)?.get(boundary);
    if (!group) return false;
    const prefix = unsafePrefix(group);
    if (!prefix) return true;
    const start = lowerBound(group.assignments, value.start);
    const end = lowerBound(group.assignments, value.end);
    return prefix[end] > prefix[start];
  }

  return {assignsStaticValue};
}

export { createCredentialAssignmentIndex };
