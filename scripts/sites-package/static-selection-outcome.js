import {isDirectRuntimeReference} from "./ast-utils.js";
import {
  dynamicOutputRelation,
  relationForStaticText,
  unionRelations
} from "./signed-query-relation.js";

const maxStaticSelectionAlternatives = 64;

function selectionOutcome({
  conservative = false,
  dynamic = false,
  nodes = [],
  undefinedOutcome = false
} = {}) {
  const staticNodes = [];
  for (const node of nodes) {
    if (isDirectRuntimeReference(node)) {
      dynamic = true;
    } else {
      staticNodes.push(node);
    }
  }
  return {conservative, dynamic, nodes: staticNodes, undefinedOutcome};
}

function selectionNode(node) {
  return node === null || node === undefined
    ? selectionOutcome({undefinedOutcome: true})
    : selectionOutcome({nodes: [node]});
}

function mergeSelectionOutcomes(...outcomes) {
  const nodes = [];
  const seen = new Set();
  let conservative = false;
  let dynamic = false;
  let undefinedOutcome = false;
  for (const outcome of outcomes) {
    if (!outcome) continue;
    const normalized = selectionOutcome(outcome);
    conservative ||= normalized.conservative;
    dynamic ||= normalized.dynamic;
    undefinedOutcome ||= normalized.undefinedOutcome;
    for (const node of normalized.nodes) {
      if (seen.has(node)) continue;
      if (nodes.length >= maxStaticSelectionAlternatives) {
        conservative = true;
        break;
      }
      seen.add(node);
      nodes.push(node);
    }
  }
  return selectionOutcome({conservative, dynamic, nodes, undefinedOutcome});
}

function mapSelectionNodes(outcome, mapper, diagnostics) {
  if (!outcome) return null;
  let result = selectionOutcome({
    conservative: outcome.conservative,
    dynamic: outcome.dynamic,
    undefinedOutcome: outcome.undefinedOutcome
  });
  if (result.conservative) return result;
  for (const node of outcome.nodes) {
    if (diagnostics) {
      diagnostics.staticSelectionAlternativeSteps =
        (diagnostics.staticSelectionAlternativeSteps ?? 0) + 1;
    }
    result = mergeSelectionOutcomes(result, mapper(node));
    if (result.conservative) break;
  }
  return result;
}

function singleSelectionNode(outcome) {
  return outcome
    && !outcome.conservative
    && !outcome.dynamic
    && !outcome.undefinedOutcome
    && outcome.nodes.length === 1
    ? outcome.nodes[0]
    : null;
}

function relationForSelectionOutcome(outcome, relationForNode) {
  if (!outcome) return null;
  const relations = outcome.nodes.map(relationForNode).filter(Boolean);
  if (outcome.conservative) {
    relations.push(relationForStaticText("?wmsAuthSign=x"));
  }
  if (outcome.dynamic) relations.push(dynamicOutputRelation);
  if (outcome.undefinedOutcome) {
    relations.push(relationForStaticText("undefined"));
  }
  if (relations.length === 0) return dynamicOutputRelation;
  return relations.length === 1 ? relations[0] : unionRelations(...relations);
}

export {
  mapSelectionNodes,
  maxStaticSelectionAlternatives,
  mergeSelectionOutcomes,
  relationForSelectionOutcome,
  selectionNode,
  selectionOutcome,
  singleSelectionNode
};
