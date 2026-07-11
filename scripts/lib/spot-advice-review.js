const MATERIAL_CLAIM_FIELDS = [
  "summary",
  "rule",
  "scope",
  "overrideKey",
  "evidence",
  "confidence",
  "consensus",
  "conflictGroupId",
  "position"
];

const clone = (value) => structuredClone(value);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertDigest(value, label = "base digest") {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertDocumentShape(document) {
  assertObject(document, "feedback document");
  if (document.schemaVersion !== 1) throw new Error("feedback document schemaVersion must be 1");
  if (!Array.isArray(document.areas) || !Array.isArray(document.spotResearch) || !Array.isArray(document.advice)) {
    throw new Error("feedback document shape requires areas, spotResearch, and advice arrays");
  }
}

function parseEnvelope(input) {
  const envelope = typeof input === "string" ? JSON.parse(input) : clone(input);
  assertObject(envelope, "feedback envelope");
  const keys = Object.keys(envelope);
  if (keys.length !== 3 || !["schemaVersion", "baseDigest", "document"].every((key) => keys.includes(key))) {
    throw new Error("feedback envelope shape must contain exactly schemaVersion, baseDigest, and document fields");
  }
  if (envelope.schemaVersion !== 1) throw new Error("feedback schemaVersion must be 1");
  assertDigest(envelope.baseDigest);
  assertDocumentShape(envelope.document);
  return envelope;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(sortObjectKeys(left)) === JSON.stringify(sortObjectKeys(right));
}

export function isMaterialClaimChange(before, after) {
  if (!before || !after) return true;
  return MATERIAL_CLAIM_FIELDS.some((field) => !sameValue(before[field], after[field]));
}

function resetMaterialReview(before, next) {
  if (before?.publicationStatus === "published" && isMaterialClaimChange(before, next)) {
    return { ...next, publicationStatus: "draft", reviewedAt: null, calculationCandidate: false };
  }
  return next;
}

function withDocument(state, document) {
  return { ...state, document };
}

function claimIndex(document, claimId) {
  const index = document.advice.findIndex((claim) => claim.id === claimId);
  if (index < 0) throw new Error(`unknown claim ${claimId}`);
  return index;
}

function withoutClaimMemberships(document, claimId) {
  for (const research of document.spotResearch) {
    research.directClaimIds = (research.directClaimIds ?? []).filter((id) => id !== claimId);
    if (research.inheritedApprovals) {
      research.inheritedApprovals = research.inheritedApprovals.filter((approval) => approval.claimId !== claimId);
      if (research.inheritedApprovals.length === 0) delete research.inheritedApprovals;
    }
  }
}

export function initializeWorkingState(canonicalDocument, baseDigest) {
  assertDigest(baseDigest);
  assertDocumentShape(canonicalDocument);
  return {
    baseDigest,
    autosaveKey: `spot-advice-review:${baseDigest}`,
    canonicalDocument: clone(canonicalDocument),
    document: clone(canonicalDocument)
  };
}

export function updateClaim(state, claimId, patch) {
  const document = clone(state.document);
  const index = claimIndex(document, claimId);
  const before = document.advice[index];
  const candidate = { ...before, ...clone(patch) };
  document.advice[index] = resetMaterialReview(before, candidate);
  return withDocument(state, document);
}

export function addClaim(state, claim, { directSpotId } = {}) {
  const document = clone(state.document);
  if (document.advice.some((item) => item.id === claim?.id)) throw new Error(`duplicate claim ${claim.id}`);
  const next = {
    ...clone(claim),
    publicationStatus: "draft",
    reviewedAt: null,
    calculationCandidate: false
  };
  document.advice.push(next);
  if (directSpotId) {
    const research = document.spotResearch.find((row) => row.spotId === directSpotId);
    if (!research) throw new Error(`unknown research spot ${directSpotId}`);
    research.directClaimIds ??= [];
    if (!research.directClaimIds.includes(next.id)) research.directClaimIds.push(next.id);
  }
  return withDocument(state, document);
}

export function deleteClaim(state, claimId) {
  const document = clone(state.document);
  const index = claimIndex(document, claimId);
  document.advice.splice(index, 1);
  withoutClaimMemberships(document, claimId);
  for (const claim of document.advice) {
    for (const evidence of claim.evidence ?? []) {
      if (Array.isArray(evidence.inputClaimIds)) evidence.inputClaimIds = evidence.inputClaimIds.filter((id) => id !== claimId);
    }
  }
  return withDocument(state, document);
}

export function addEvidence(state, claimId, evidence) {
  const claim = state.document.advice.find((item) => item.id === claimId);
  if (!claim) throw new Error(`unknown claim ${claimId}`);
  return updateClaim(state, claimId, { evidence: [...claim.evidence, clone(evidence)] });
}

export function updateEvidence(state, claimId, evidenceIndex, patch) {
  const claim = state.document.advice.find((item) => item.id === claimId);
  if (!claim) throw new Error(`unknown claim ${claimId}`);
  if (!claim.evidence[evidenceIndex]) throw new Error(`unknown evidence ${evidenceIndex} for ${claimId}`);
  const evidence = clone(claim.evidence);
  evidence[evidenceIndex] = { ...evidence[evidenceIndex], ...clone(patch) };
  return updateClaim(state, claimId, { evidence });
}

export function deleteEvidence(state, claimId, evidenceIndex) {
  const claim = state.document.advice.find((item) => item.id === claimId);
  if (!claim) throw new Error(`unknown claim ${claimId}`);
  if (!claim.evidence[evidenceIndex]) throw new Error(`unknown evidence ${evidenceIndex} for ${claimId}`);
  return updateClaim(state, claimId, { evidence: claim.evidence.filter((_, index) => index !== evidenceIndex) });
}

export function rescopeClaim(state, claimId, scope) {
  let next = updateClaim(state, claimId, { scope: clone(scope) });
  const document = clone(next.document);
  withoutClaimMemberships(document, claimId);
  if (scope.type === "spot") {
    const research = document.spotResearch.find((row) => row.spotId === scope.id);
    if (!research) throw new Error(`unknown research spot ${scope.id}`);
    research.directClaimIds ??= [];
    research.directClaimIds.push(claimId);
  }
  return withDocument(next, document);
}

export function splitClaim(state, claimId, { newId, originalPatch = {}, newClaimPatch = {} }) {
  if (!newId) throw new Error("split claim requires newId");
  let next = updateClaim(state, claimId, originalPatch);
  const source = next.document.advice.find((claim) => claim.id === claimId);
  const split = { ...clone(source), ...clone(newClaimPatch), id: newId };
  let directSpotId;
  for (const research of next.document.spotResearch) {
    if (research.directClaimIds?.includes(claimId)) directSpotId = research.spotId;
  }
  next = addClaim(next, split, { directSpotId });
  return next;
}

export function mergeClaims(state, targetId, sourceId, patch = {}) {
  if (targetId === sourceId) throw new Error("merge claims must be different");
  const target = state.document.advice.find((claim) => claim.id === targetId);
  const source = state.document.advice.find((claim) => claim.id === sourceId);
  if (!target || !source) throw new Error("merge references an unknown claim");
  const combinedEvidence = [...clone(target.evidence ?? [])];
  for (const evidence of source.evidence ?? []) {
    if (!combinedEvidence.some((item) => sameValue(item, evidence))) combinedEvidence.push(clone(evidence));
  }
  let next = updateClaim(state, targetId, { ...clone(patch), evidence: combinedEvidence });
  const sourceDirectOwners = next.document.spotResearch.filter((row) => row.directClaimIds?.includes(sourceId));
  next = deleteClaim(next, sourceId);
  const document = clone(next.document);
  for (const research of sourceDirectOwners) {
    const row = document.spotResearch.find((item) => item.spotId === research.spotId);
    if (row && !row.directClaimIds.includes(targetId)) row.directClaimIds.push(targetId);
  }
  return withDocument(next, document);
}

export function updateResearchRow(state, spotId, patch) {
  const document = clone(state.document);
  const index = document.spotResearch.findIndex((row) => row.spotId === spotId);
  if (index < 0) throw new Error(`unknown research spot ${spotId}`);
  document.spotResearch[index] = { ...document.spotResearch[index], ...clone(patch), spotId };
  return withDocument(state, document);
}

export function pendingCount(state) {
  return state.document.advice.filter((claim) => claim.publicationStatus === "draft" || claim.reviewedAt == null).length;
}

export function exportFeedback(state) {
  return { schemaVersion: 1, baseDigest: state.baseDigest, document: clone(state.document) };
}

export function serializeAutosave(state) {
  return JSON.stringify(exportFeedback(state));
}

export function recoverAutosave(canonicalDocument, baseDigest, serialized) {
  const state = initializeWorkingState(canonicalDocument, baseDigest);
  return importFeedback(state, serialized);
}

export function importFeedback(state, input) {
  const envelope = parseEnvelope(input);
  if (envelope.baseDigest !== state.baseDigest) throw new Error("feedback digest does not match this canonical document");
  return withDocument(state, clone(envelope.document));
}

export function resetWorkingState(state) {
  return withDocument(state, clone(state.canonicalDocument));
}

export function isSafeExternalUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export { MATERIAL_CLAIM_FIELDS };
