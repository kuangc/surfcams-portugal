import { createHash } from "node:crypto";

const TOPICS = new Set(["size-translation", "tide", "swell", "period-energy", "wind", "season", "mechanics", "ability", "hazard", "crowd-access"]);
const DECISION_TOPICS = new Set(["size-translation", "tide", "swell", "wind", "mechanics"]);
const SCOPE_TYPES = new Set(["spot", "stretch", "area"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const PUBLICATION_STATUSES = new Set(["draft", "published", "rejected"]);
const CONSENSUS_VALUES = new Set(["settled", "unresolved"]);
const EVIDENCE_KINDS = new Set(["user-observed", "local-guide", "specialist-guide", "provider", "inference"]);
const EVIDENCE_STATUSES = new Set(["accepted", "rejected"]);
const LOCATION_MATCHES = new Set(["exact-spot", "stretch", "area", "mismatch"]);
const SOURCE_DECISIONS = new Set(["accepted", "rejected"]);
const RESEARCH_OUTCOMES = new Set(["found", "no-credible-spot-source-found"]);
const SCOPE_RANK = { area: 1, stretch: 2, spot: 3 };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`spot advice validation: ${message}`);
}

function requireValue(condition, message) {
  if (!condition) fail(message);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function digestDocument(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function digestClaim(claim) {
  return digestDocument(claim);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  requireValue(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
}

function requireDate(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requireValue(typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), `${label} must be a YYYY-MM-DD date${nullable ? " or null" : ""}`);
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requireValue(typeof value === "string" && !Number.isNaN(Date.parse(value)), `${label} must be an ISO timestamp${nullable ? " or null" : ""}`);
}

function requireSafeUrl(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requireString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a safe http/https URL${nullable ? " or null" : ""}`);
  }
  requireValue(parsed.protocol === "http:" || parsed.protocol === "https:", `${label} must be a safe http/https URL${nullable ? " or null" : ""}`);
}

function requireUnique(values, label) {
  requireValue(new Set(values).size === values.length, `duplicate ${label}`);
}

function requireExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  requireValue(unknown.length === 0, `${label} has unsupported field(s): ${unknown.join(", ")}`);
}

function validateRule(rule, label) {
  if (rule == null) return;
  requireValue(isObject(rule), `${label} rule must be an object`);
  switch (rule.type) {
    case "minimum": {
      requireExactKeys(rule, ["type", "input", "value", "comparison", "effectBelow", "effectAtOrAbove"], `${label} minimum rule`);
      requireValue(rule.input === "primary-swell-height-m", `${label} rule input/unit is unsupported`);
      requireValue(Number.isFinite(rule.value) && rule.value >= 0 && rule.value <= 30, `${label} rule value must be a finite metric height from 0 to 30`);
      requireValue(rule.comparison === "greater-than-or-equal", `${label} rule comparison is unsupported`);
      requireString(rule.effectBelow, `${label} rule effectBelow`);
      if (rule.effectAtOrAbove !== undefined) requireString(rule.effectAtOrAbove, `${label} rule effectAtOrAbove`);
      break;
    }
    case "tide-preference":
      requireExactKeys(rule, ["type", "stage", "direction"], `${label} tide rule`);
      requireValue(["low", "mid", "high"].includes(rule.stage), `${label} rule tide stage is unsupported`);
      if (rule.direction !== undefined) requireValue(["rising", "falling"].includes(rule.direction), `${label} rule tide direction is unsupported`);
      break;
    case "direction-preference":
      requireExactKeys(rule, ["type", "input", "arcs"], `${label} direction rule`);
      requireValue(["primary-swell-direction-deg", "wind-direction-deg"].includes(rule.input), `${label} rule input/unit is unsupported`);
      requireValue(Array.isArray(rule.arcs) && rule.arcs.length > 0, `${label} rule arcs must be a non-empty array`);
      for (const [index, arc] of rule.arcs.entries()) {
        requireValue(isObject(arc), `${label} rule arc ${index} must be an object`);
        requireExactKeys(arc, ["start", "end"], `${label} rule arc ${index}`);
        for (const key of ["start", "end"]) requireValue(Number.isFinite(arc[key]) && arc[key] >= 0 && arc[key] < 360, `${label} rule arc ${index} ${key} must be degrees in [0, 360)`);
      }
      break;
    case "qualitative":
      requireExactKeys(rule, ["type"], `${label} qualitative rule`);
      break;
    default:
      fail(`${label} rule type is unsupported`);
  }
}

function validateCheckedSource(source, label) {
  requireValue(isObject(source), `${label} checked source must be an object`);
  for (const key of ["title", "publisher", "rationale"]) requireString(source[key], `${label} checked source ${key}`);
  requireSafeUrl(source.url, `${label} checked source safe URL`);
  requireValue(LOCATION_MATCHES.has(source.locationMatch), `${label} checked source locationMatch is invalid`);
  requireValue(SOURCE_DECISIONS.has(source.decision), `${label} checked source decision is invalid`);
}

function validateEvidence(evidence, claimId, evidenceIndex) {
  const label = `${claimId} evidence ${evidenceIndex}`;
  requireValue(isObject(evidence), `${label} must be an object`);
  requireValue(EVIDENCE_KINDS.has(evidence.kind), `${label} kind is invalid`);
  for (const key of ["title", "publisher", "supportedClaim", "quality"]) requireString(evidence[key], `${label} ${key}`);
  requireSafeUrl(evidence.url, `${label} safe URL`, { nullable: true });
  requireDate(evidence.accessedAt, `${label} accessedAt`);
  requireValue(EVIDENCE_STATUSES.has(evidence.status), `${label} status is invalid`);
  if (evidence.locationMatch !== undefined) requireValue(LOCATION_MATCHES.has(evidence.locationMatch), `${label} locationMatch is invalid`);
  if (evidence.kind === "inference") {
    requireValue(Array.isArray(evidence.inputClaimIds) && evidence.inputClaimIds.length >= 2, `${label} inference must cite at least two input claim ids`);
    requireUnique(evidence.inputClaimIds, `${label} inference input claim id`);
  }
}

function isTimeSensitive(claim) {
  if (["hazard", "crowd-access"].includes(claim.topic)) return true;
  return claim.topic === "mechanics" && /(sand ?banks?|shifting (?:banks?|peaks?)|bank (?:quality|placement)|changing (?:left|right|peaks?))/i.test(claim.summary);
}

function validateClaim(claim, index, { selectedSet, areaIds, stretchIds, updatedAt }) {
  const label = `advice[${index}]${claim?.id ? ` ${claim.id}` : ""}`;
  requireValue(isObject(claim), `${label} must be an object`);
  for (const key of ["id", "overrideKey", "summary"]) requireString(claim[key], `${label} ${key}`);
  requireValue(isObject(claim.scope) && SCOPE_TYPES.has(claim.scope.type), `${label} scope type is invalid`);
  requireString(claim.scope.id, `${label} scope id`);
  if (claim.scope.type === "spot") requireValue(selectedSet.has(claim.scope.id), `${label} has unknown spot id ${claim.scope.id}`);
  if (claim.scope.type === "area") requireValue(areaIds.has(claim.scope.id), `${label} has unknown area id ${claim.scope.id}`);
  if (claim.scope.type === "stretch") requireValue(stretchIds.has(claim.scope.id), `${label} has unknown stretch id ${claim.scope.id}`);
  requireValue(TOPICS.has(claim.topic), `${label} topic is invalid`);
  requireValue(CONFIDENCES.has(claim.confidence), `${label} confidence is invalid`);
  requireValue(PUBLICATION_STATUSES.has(claim.publicationStatus), `${label} publicationStatus is invalid`);
  requireValue(CONSENSUS_VALUES.has(claim.consensus), `${label} consensus is invalid`);
  requireValue(claim.calculationCandidate === false, `${label} calculation activation is forbidden in schema v1`);
  requireTimestamp(claim.reviewedAt, `${label} reviewedAt`, { nullable: claim.publicationStatus !== "published" });
  requireDate(claim.revalidateAfter, `${label} revalidateAfter`, { nullable: true });
  if (claim.revalidateAfter !== null) requireValue(claim.revalidateAfter >= updatedAt, `${label} revalidateAfter is expired relative to document updatedAt`);
  if (claim.publicationStatus === "published" && isTimeSensitive(claim)) requireValue(claim.revalidateAfter !== null, `${label} time-sensitive claim requires revalidateAfter expiry`);
  validateRule(claim.rule, label);
  requireValue(Array.isArray(claim.evidence) && claim.evidence.length > 0, `${label} evidence must be a non-empty array`);
  claim.evidence.forEach((item, evidenceIndex) => validateEvidence(item, claim.id, evidenceIndex));
  if (claim.publicationStatus === "published") {
    const accepted = claim.evidence.filter((item) => item.status === "accepted");
    requireValue(accepted.length > 0, `${label} published claim needs accepted evidence`);
    requireValue(accepted.some((item) => item.quality !== "general-beach-directory"), `${label} source quality cannot rely only on a general beach directory`);
  }
  if (claim.consensus === "unresolved") requireString(claim.conflictGroupId, `${label} unresolved conflictGroupId`);
  if (claim.conflictGroupId !== undefined) {
    requireValue(claim.consensus === "unresolved", `${label} conflictGroupId requires unresolved consensus`);
    requireString(claim.position, `${label} unresolved position`);
  }
}

function validateContext(context) {
  requireValue(isObject(context), "context must be an object");
  const selected = context.promotions?.promoted?.map((row) => row.surflineSpotId);
  requireValue(Array.isArray(selected), "promotions.promoted must be an array");
  requireValue(selected.length === 44, `promotion identity must contain exactly 44 selected Surfline ids (found ${selected.length})`);
  selected.forEach((id, index) => requireString(id, `promotion ${index} surflineSpotId`));
  requireUnique(selected, "promotion Surfline id");
  requireValue(Array.isArray(context.surflineSpots?.spots), "surflineSpots.spots must be an array");
  const surflineIds = context.surflineSpots.spots.map((spot) => spot.id);
  requireUnique(surflineIds, "Surfline spot id");
  const surflineSet = new Set(surflineIds);
  for (const id of selected) requireValue(surflineSet.has(id), `promotion has unknown Surfline spot id ${id}`);
  requireValue(Array.isArray(context.stretches?.stretches), "stretches.stretches must be an array");
  const stretchIds = context.stretches.stretches.map((stretch) => stretch.id);
  requireUnique(stretchIds, "stretch id");
  for (const stretch of context.stretches.stretches) {
    requireString(stretch.id, "stretch id");
    requireValue(Array.isArray(stretch.surflineSpotIds), `${stretch.id} surflineSpotIds must be an array`);
    requireUnique(stretch.surflineSpotIds, `${stretch.id} stretch member`);
    for (const id of stretch.surflineSpotIds) requireValue(surflineSet.has(id), `${stretch.id} stretch has unknown Surfline membership ${id}`);
    requireValue(Array.isArray(stretch.meoCamIds), `${stretch.id} meoCamIds must be an array`);
    requireUnique(stretch.meoCamIds, `${stretch.id} MEO camera member`);
  }
  const selectedSet = new Set(selected);
  const stretchMembership = new Map(selected.map((id) => [id, []]));
  for (const stretch of context.stretches.stretches) for (const id of stretch.surflineSpotIds) if (selectedSet.has(id)) stretchMembership.get(id).push(stretch.id);
  for (const [id, memberships] of stretchMembership) requireValue(memberships.length <= 1, `${id} has multiple stretch memberships: ${memberships.join(", ")}`);
  requireValue(Array.isArray(context.promotedDb?.promoted), "promotedDb.promoted must be an array");
  requireValue(Array.isArray(context.promotedDb?.deferred), "promotedDb.deferred must be an array");
  requireValue(Array.isArray(context.enrichmentDb?.entries), "enrichmentDb.entries must be an array");
  requireValue(Array.isArray(context.defaultFavoriteIds), "defaultFavoriteIds must be an array");
  requireUnique(context.defaultFavoriteIds, "default favorite id");
  return { selected, selectedSet, surflineSet, stretchIds: new Set(stretchIds), stretchMembership };
}

function validateAreas(document, selectedSet) {
  requireValue(Array.isArray(document.areas), "areas must be an array");
  const areaIds = document.areas.map((area) => area.id);
  requireUnique(areaIds, "area id");
  const membership = new Map([...selectedSet].map((id) => [id, []]));
  for (const area of document.areas) {
    requireString(area.id, "area id");
    requireString(area.name, `${area.id} area name`);
    requireValue(Array.isArray(area.spotIds), `${area.id} area spotIds must be an array`);
    requireUnique(area.spotIds, `${area.id} area member`);
    for (const id of area.spotIds) {
      requireValue(selectedSet.has(id), `${area.id} area has unknown spot membership ${id}`);
      membership.get(id).push(area.id);
    }
  }
  for (const [id, memberships] of membership) requireValue(memberships.length <= 1, `${id} has multiple area memberships: ${memberships.join(", ")}`);
  return { areaIds: new Set(areaIds), areaMembership: membership };
}

function appliesToSpot(claim, spotId, areaMembership, stretchMembership) {
  if (claim.scope.type === "spot") return claim.scope.id === spotId;
  if (claim.scope.type === "area") return areaMembership.get(spotId).includes(claim.scope.id);
  return stretchMembership.get(spotId).includes(claim.scope.id);
}

function validateCollisions(publishedClaims) {
  const groups = new Map();
  for (const claim of publishedClaims) {
    const key = `${claim.scope.type}\u0000${claim.scope.id}\u0000${claim.overrideKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(claim);
  }
  for (const claims of groups.values()) {
    if (claims.length < 2) continue;
    const groupIds = new Set(claims.map((claim) => claim.conflictGroupId));
    const explicitConflict = groupIds.size === 1
      && !groupIds.has(undefined)
      && claims.every((claim) => claim.consensus === "unresolved" && claim.position);
    requireValue(explicitConflict, `same-scope overrideKey collision for ${claims[0].scope.type}:${claims[0].scope.id}:${claims[0].overrideKey}`);
  }
  const conflictGroups = new Map();
  for (const claim of publishedClaims.filter((item) => item.conflictGroupId)) {
    if (!conflictGroups.has(claim.conflictGroupId)) conflictGroups.set(claim.conflictGroupId, []);
    conflictGroups.get(claim.conflictGroupId).push(claim);
  }
  for (const [groupId, claims] of conflictGroups) {
    requireValue(claims.length >= 2, `unresolved conflict group ${groupId} needs at least two published alternatives`);
    requireValue(new Set(claims.map((claim) => `${claim.scope.type}:${claim.scope.id}:${claim.overrideKey}`)).size === 1, `unresolved conflict group ${groupId} must share scope and overrideKey`);
    requireUnique(claims.map((claim) => claim.position), `${groupId} conflict position`);
  }
}

function validateIdentity(context, contextInfo, selectedSet) {
  const { surflineSet, selected } = contextInfo;
  const entries = context.enrichmentDb.entries;
  requireUnique(entries.map((entry) => entry.id), "enrichment camera id");
  const byCameraId = Object.fromEntries(selected.map((id) => [id, id]));
  const adviceBearingCameraIds = [];
  for (const entry of entries) {
    requireString(entry.id, "enrichment camera id");
    const metadata = entry.surfMetadata;
    if (!metadata || ["needs-review", "rejected"].includes(metadata.reviewStatus) || !metadata.conditionsSourceSpotId) continue;
    requireValue(["curated", "generated"].includes(metadata.reviewStatus), `${entry.id} identity has unknown reviewStatus`);
    requireValue(surflineSet.has(metadata.conditionsSourceSpotId), `${entry.id} identity conditionsSourceSpotId ${metadata.conditionsSourceSpotId} is mismatched or unknown`);
    if (!selectedSet.has(metadata.conditionsSourceSpotId)) continue;
    byCameraId[entry.id] = metadata.conditionsSourceSpotId;
    adviceBearingCameraIds.push(entry.id);
  }
  adviceBearingCameraIds.sort();
  for (const id of context.defaultFavoriteIds) requireValue(byCameraId[id], `default favorite ${id} has no trusted advice identity`);
  return {
    selectedSurflineIds: [...selected],
    defaultFavoriteIds: [...context.defaultFavoriteIds],
    adviceBearingCameraIds,
    byCameraId
  };
}

export function validateSpotAdvice(document, context) {
  requireValue(isObject(document), "document must be an object");
  requireValue(document.schemaVersion === 1, "schemaVersion must be 1");
  requireDate(document.updatedAt, "updatedAt");
  const contextInfo = validateContext(context);
  const { selected, selectedSet, stretchIds, stretchMembership } = contextInfo;
  const { areaIds, areaMembership } = validateAreas(document, selectedSet);
  requireValue(Array.isArray(document.advice), "advice must be an array");
  document.advice.forEach((claim, index) => validateClaim(claim, index, { selectedSet, areaIds, stretchIds, updatedAt: document.updatedAt }));
  requireUnique(document.advice.map((claim) => claim.id), "advice id");
  const claimsById = new Map(document.advice.map((claim) => [claim.id, claim]));
  for (const claim of document.advice) {
    for (const inference of claim.evidence.filter((item) => item.kind === "inference" && item.status === "accepted")) {
      for (const inputId of inference.inputClaimIds) {
        const input = claimsById.get(inputId);
        requireValue(input && input.evidence.some((item) => item.status === "accepted"), `${claim.id} inference input ${inputId} is unknown or lacks accepted evidence`);
      }
    }
  }
  validateCollisions(document.advice.filter((claim) => claim.publicationStatus === "published"));
  requireValue(Array.isArray(document.spotResearch), "spotResearch must be an array");
  const researchIds = document.spotResearch.map((row) => row.spotId);
  requireValue(researchIds.length === selected.length && researchIds.every((id, index) => id === selected[index]), "research identity and order must exactly match promotions");
  requireUnique(researchIds, "research spot id");
  const directOwner = new Map();
  for (const [index, research] of document.spotResearch.entries()) {
    const label = `research ${research.spotId || index}`;
    requireValue(research.status === "complete", `${label} must be complete`);
    requireValue(RESEARCH_OUTCOMES.has(research.directEvidenceOutcome), `${label} directEvidenceOutcome is invalid`);
    requireValue(Array.isArray(research.checkedSources) && research.checkedSources.length > 0, `${label} checkedSources must be a non-empty array`);
    research.checkedSources.forEach((source) => validateCheckedSource(source, label));
    requireValue(Array.isArray(research.directClaimIds), `${label} directClaimIds must be an array`);
    requireUnique(research.directClaimIds, `${label} direct claim id`);
    if (research.directEvidenceOutcome === "found") requireValue(research.directClaimIds.length > 0, `${label} found outcome requires a direct claim`);
    if (research.directEvidenceOutcome === "no-credible-spot-source-found") requireValue(research.directClaimIds.length === 0, `${label} no-source outcome cannot list direct claims`);
    const acceptedUrls = new Set(research.checkedSources.filter((source) => source.decision === "accepted").map((source) => source.url));
    for (const claimId of research.directClaimIds) {
      const claim = claimsById.get(claimId);
      requireValue(claim, `${label} references unknown direct claim ${claimId}`);
      requireValue(claim.scope.type === "spot" && claim.scope.id === research.spotId, `${label} direct claim ${claimId} has the wrong spot scope`);
      requireValue(!directOwner.has(claimId), `${claimId} is a duplicate direct claim membership`);
      directOwner.set(claimId, research.spotId);
      const accepted = claim.evidence.filter((item) => item.status === "accepted");
      requireValue(accepted.some((item) => item.kind === "user-observed" || item.locationMatch === "exact-spot"), `${label} direct claim ${claimId} lacks exact-spot or user-observed evidence`);
      for (const evidence of accepted.filter((item) => item.url)) requireValue(acceptedUrls.has(evidence.url), `${label} direct claim ${claimId} evidence URL was not an accepted checked source`);
    }
    const approvals = research.inheritedApprovals ?? [];
    requireValue(Array.isArray(approvals), `${label} inheritedApprovals must be an array`);
    requireUnique(approvals.map((approval) => approval.claimId), `${label} inherited approval claim id`);
    for (const approval of approvals) {
      requireValue(isObject(approval), `${label} inherited approval must be an object`);
      requireString(approval.claimId, `${label} inherited approval claimId`);
      requireValue(SHA256_PATTERN.test(approval.claimDigest), `${label} approval digest must be SHA-256`);
      const claim = claimsById.get(approval.claimId);
      requireValue(claim, `${label} approval references unknown claim ${approval.claimId}`);
      requireValue(claim.scope.type !== "spot" && appliesToSpot(claim, research.spotId, areaMembership, stretchMembership), `${label} approval ${approval.claimId} has unknown or inapplicable membership`);
      requireValue(approval.claimDigest === digestClaim(claim), `${label} approval digest changed for ${approval.claimId}`);
    }
    if (research.tideCameraId !== undefined) {
      requireString(research.tideCameraId, `${label} tideCameraId`);
      const stretchId = stretchMembership.get(research.spotId)[0];
      const stretch = context.stretches.stretches.find((item) => item.id === stretchId);
      requireValue(stretch?.meoCamIds.includes(research.tideCameraId), `${label} tideCameraId is not a member of its stretch`);
    }
    requireTimestamp(research.reviewedAt, `${label} reviewedAt`);
    const approvedIds = new Set(approvals.map((approval) => approval.claimId));
    const effective = document.advice.filter((claim) => claim.publicationStatus === "published" && (
      (claim.scope.type === "spot" && claim.scope.id === research.spotId && research.directClaimIds.includes(claim.id))
      || (claim.scope.type !== "spot" && approvedIds.has(claim.id))
    ));
    const resolvedCoverage = resolveClaims(effective).winning;
    requireValue(resolvedCoverage.some((claim) => DECISION_TOPICS.has(claim.topic)), `${label} has no published decision-effective coverage through a direct claim or exact inherited approval`);
  }
  for (const claim of document.advice.filter((item) => item.publicationStatus === "published" && item.scope.type === "spot")) {
    requireValue(directOwner.has(claim.id), `${claim.id} published spot claim is missing direct research coverage`);
  }
  const identityReport = validateIdentity(context, contextInfo, selectedSet);
  return { selected, selectedSet, areaMembership, stretchMembership, claimsById, identityReport };
}

function publicEvidence(evidence) {
  return Object.fromEntries([
    ["kind", evidence.kind],
    ["title", evidence.title],
    ["publisher", evidence.publisher],
    ["url", evidence.url],
    ["accessedAt", evidence.accessedAt],
    ["supportedClaim", evidence.supportedClaim],
    ["quality", evidence.quality],
    ...(evidence.locationMatch !== undefined ? [["locationMatch", evidence.locationMatch]] : []),
    ...(evidence.inputClaimIds !== undefined ? [["inputClaimIds", [...evidence.inputClaimIds]]] : [])
  ]);
}

function publicClaim(claim) {
  return Object.fromEntries([
    ["id", claim.id],
    ["scope", { type: claim.scope.type, id: claim.scope.id }],
    ["topic", claim.topic],
    ["overrideKey", claim.overrideKey],
    ["summary", claim.summary],
    ...(claim.rule !== undefined ? [["rule", clonePublicValue(claim.rule)]] : []),
    ["evidence", claim.evidence.filter((item) => item.status === "accepted").map(publicEvidence)],
    ["confidence", claim.confidence],
    ["consensus", claim.consensus],
    ["reviewedAt", claim.reviewedAt],
    ["revalidateAfter", claim.revalidateAfter],
    ...(claim.conflictGroupId !== undefined ? [["conflictGroupId", claim.conflictGroupId], ["position", claim.position]] : [])
  ]);
}

function clonePublicValue(value) {
  if (Array.isArray(value)) return value.map(clonePublicValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePublicValue(item)]));
}

function resolveClaims(effective) {
  const byKey = new Map();
  for (const claim of effective) {
    if (!byKey.has(claim.overrideKey)) byKey.set(claim.overrideKey, []);
    byKey.get(claim.overrideKey).push(claim);
  }
  const winning = [];
  const overriddenClaimIds = [];
  for (const claims of byKey.values()) {
    const rank = Math.max(...claims.map((claim) => SCOPE_RANK[claim.scope.type]));
    const atRank = claims.filter((claim) => SCOPE_RANK[claim.scope.type] === rank);
    winning.push(...atRank);
    overriddenClaimIds.push(...claims.filter((claim) => SCOPE_RANK[claim.scope.type] < rank).map((claim) => claim.id));
  }
  winning.sort((a, b) => a.id.localeCompare(b.id));
  overriddenClaimIds.sort();
  return { winning, overriddenClaimIds };
}

export function compileSpotAdvice(document, context) {
  const validated = validateSpotAdvice(document, context);
  const surflineById = new Map(context.surflineSpots.spots.map((spot) => [spot.id, spot]));
  const deferred = new Set(context.promotedDb.deferred.map((row) => row.surflineSpotId));
  const researchBySpot = new Map(document.spotResearch.map((row) => [row.spotId, row]));
  const subjects = {};
  for (const spotId of validated.selected) {
    const research = researchBySpot.get(spotId);
    const directIds = new Set(research.directClaimIds);
    const approvedIds = new Set((research.inheritedApprovals ?? []).map((approval) => approval.claimId));
    const effective = document.advice.filter((claim) => claim.publicationStatus === "published" && (
      (claim.scope.type === "spot" && claim.scope.id === spotId && directIds.has(claim.id))
      || (claim.scope.type !== "spot" && approvedIds.has(claim.id))
    ));
    const { winning, overriddenClaimIds } = resolveClaims(effective);
    const claims = winning.map(publicClaim);
    const decisiveClaims = claims.filter((claim) => claim.consensus === "settled");
    const conflictsById = new Map();
    for (const claim of claims.filter((item) => item.conflictGroupId)) {
      if (!conflictsById.has(claim.conflictGroupId)) conflictsById.set(claim.conflictGroupId, []);
      conflictsById.get(claim.conflictGroupId).push(claim);
    }
    const conflicts = [...conflictsById].sort(([a], [b]) => a.localeCompare(b)).map(([id, alternatives]) => ({
      id,
      overrideKey: alternatives[0].overrideKey,
      decisive: false,
      claims: alternatives
    }));
    const topicIndex = {};
    for (const claim of claims) {
      topicIndex[claim.topic] ||= [];
      topicIndex[claim.topic].push(claim.id);
    }
    subjects[spotId] = {
      id: spotId,
      name: surflineById.get(spotId).name,
      guideOnly: deferred.has(spotId),
      tideCameraId: research.tideCameraId ?? null,
      claims,
      decisiveClaims,
      conflicts,
      overriddenClaimIds,
      topicIndex
    };
  }
  return {
    schemaVersion: 1,
    sourceDigest: digestDocument(document),
    subjects,
    identityReport: validated.identityReport
  };
}
