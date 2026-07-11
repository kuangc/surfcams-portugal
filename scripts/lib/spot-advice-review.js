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
  if (isMaterialClaimChange(before, next)) {
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
    document: clone(canonicalDocument),
    editorDrafts: {},
    savedAt: null
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
  if (!sameValue(target.scope, source.scope)) throw new Error("merge claims must share one scope");
  const combinedEvidence = [...clone(target.evidence ?? [])];
  for (const evidence of source.evidence ?? []) {
    if (!combinedEvidence.some((item) => sameValue(item, evidence))) combinedEvidence.push(clone(evidence));
  }
  let next = updateClaim(state, targetId, { ...clone(patch), evidence: combinedEvidence });
  next = deleteClaim(next, sourceId);
  const document = clone(next.document);
  withoutClaimMemberships(document, targetId);
  const merged = document.advice.find((claim) => claim.id === targetId);
  if (merged.scope.type === "spot") {
    const row = document.spotResearch.find((item) => item.spotId === merged.scope.id);
    if (!row) throw new Error(`unknown research spot ${merged.scope.id}`);
    row.directClaimIds ??= [];
    row.directClaimIds.push(targetId);
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
  const changedRows = (beforeRows, afterRows, key) => {
    const before = new Map(beforeRows.map((row) => [row[key], row]));
    const after = new Map(afterRows.map((row) => [row[key], row]));
    return new Set([...before.keys(), ...after.keys()]).size === 0
      ? 0
      : [...new Set([...before.keys(), ...after.keys()])].filter((id) => !sameValue(before.get(id), after.get(id))).length;
  };
  const canonical = state.canonicalDocument;
  let count = changedRows(canonical.advice, state.document.advice, "id")
    + changedRows(canonical.spotResearch, state.document.spotResearch, "spotId")
    + changedRows(canonical.areas, state.document.areas, "id");
  if (canonical.schemaVersion !== state.document.schemaVersion || canonical.updatedAt !== state.document.updatedAt) count += 1;
  count += Object.keys(state.editorDrafts ?? {}).length;
  return count;
}

export function exportFeedback(state) {
  return { schemaVersion: 1, baseDigest: state.baseDigest, document: clone(state.document) };
}

export function setEditorDraft(state, key, value) {
  if (typeof key !== "string" || !key) throw new Error("editor draft key is required");
  const previous = state.editorDrafts?.[key];
  const mergeable = previous && value
    && typeof previous === "object" && !Array.isArray(previous)
    && typeof value === "object" && !Array.isArray(value);
  const nextValue = mergeable ? { ...clone(previous), ...clone(value) } : clone(value);
  return { ...state, editorDrafts: { ...(state.editorDrafts ?? {}), [key]: nextValue } };
}

export function clearEditorDraft(state, key) {
  const editorDrafts = { ...(state.editorDrafts ?? {}) };
  delete editorDrafts[key];
  return { ...state, editorDrafts };
}

export function serializeAutosave(state, savedAt = state.savedAt) {
  return JSON.stringify({
    schemaVersion: 1,
    baseDigest: state.baseDigest,
    document: clone(state.document),
    editorDrafts: clone(state.editorDrafts ?? {}),
    savedAt: savedAt ?? null
  });
}

export function recoverAutosave(canonicalDocument, baseDigest, serialized) {
  const state = initializeWorkingState(canonicalDocument, baseDigest);
  const value = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
  assertObject(value, "autosave envelope");
  if (value.schemaVersion !== 1) throw new Error("autosave schemaVersion must be 1");
  if (value.baseDigest !== baseDigest) throw new Error("autosave digest does not match this canonical document");
  assertDocumentShape(value.document);
  if (value.editorDrafts !== undefined) assertObject(value.editorDrafts, "autosave editorDrafts");
  return {
    ...state,
    document: clone(value.document),
    editorDrafts: clone(value.editorDrafts ?? {}),
    savedAt: value.savedAt ?? null
  };
}

export function importFeedback(state, input) {
  const envelope = parseEnvelope(input);
  if (envelope.baseDigest !== state.baseDigest) throw new Error("feedback digest does not match this canonical document");
  return { ...withDocument(state, clone(envelope.document)), editorDrafts: {}, savedAt: null };
}

export function resetWorkingState(state) {
  return { ...withDocument(state, clone(state.canonicalDocument)), editorDrafts: {}, savedAt: null };
}

export function filterReviewSpots(spots, filters = {}) {
  const topic = String(filters.topic ?? "").trim().toLowerCase();
  return spots.filter((spot) => (
    (!filters.area || spot.areaIds.includes(filters.area))
    && (!filters.scope || spot.applicableScopeTypes.includes(filters.scope))
    && (!topic || spot.topics.some((value) => value.toLowerCase().includes(topic)))
    && (!filters.confidence || spot.confidences.includes(filters.confidence))
    && (!filters.publication || spot.publications.includes(filters.publication))
    && (!filters.consensus || spot.consensuses.includes(filters.consensus))
    && (!filters.expiry || (filters.expiry === "set" ? spot.expiries.length > 0 : spot.expiries.length === 0))
    && (!filters.missingDirect || spot.missingDirectEvidence)
  ));
}

const SCOPE_RANK = { area: 1, stretch: 2, spot: 3 };

export function resolveSpotAdvicePreview(document, context, spotId) {
  const research = document.spotResearch.find((row) => row.spotId === spotId);
  if (!research) throw new Error(`unknown research spot ${spotId}`);
  const areaIds = document.areas.filter((area) => area.spotIds.includes(spotId)).map((area) => area.id);
  const stretchIds = (context.stretches?.stretches ?? []).filter((stretch) => stretch.surflineSpotIds.includes(spotId)).map((stretch) => stretch.id);
  const directIds = new Set(research.directClaimIds ?? []);
  const inheritedIds = new Set((research.inheritedApprovals ?? []).map((approval) => approval.claimId));
  const applies = (claim) => claim.scope.type === "spot"
    ? claim.scope.id === spotId
    : claim.scope.type === "area"
      ? areaIds.includes(claim.scope.id)
      : stretchIds.includes(claim.scope.id);
  const applicableClaims = document.advice.filter((claim) => applies(claim));
  const signedOffClaims = applicableClaims.filter((claim) => claim.publicationStatus === "published" && (
    (claim.scope.type === "spot" && directIds.has(claim.id))
    || (claim.scope.type !== "spot" && inheritedIds.has(claim.id))
  ));
  const grouped = new Map();
  for (const claim of signedOffClaims) {
    if (!grouped.has(claim.overrideKey)) grouped.set(claim.overrideKey, []);
    grouped.get(claim.overrideKey).push(claim);
  }
  const effectiveClaims = [];
  const overriddenClaims = [];
  for (const claims of grouped.values()) {
    const rank = Math.max(...claims.map((claim) => SCOPE_RANK[claim.scope.type]));
    effectiveClaims.push(...claims.filter((claim) => SCOPE_RANK[claim.scope.type] === rank));
    overriddenClaims.push(...claims.filter((claim) => SCOPE_RANK[claim.scope.type] < rank));
  }
  effectiveClaims.sort((left, right) => left.id.localeCompare(right.id));
  overriddenClaims.sort((left, right) => left.id.localeCompare(right.id));
  return {
    spotId,
    areaIds,
    stretchIds,
    applicableClaims,
    signedOffClaims,
    effectiveClaims,
    overriddenClaims,
    directClaimIds: [...directIds],
    inheritedClaimIds: [...inheritedIds]
  };
}

export function buildDynamicReviewSpots(document, spotCatalog, context) {
  const claimsById = new Map(document.advice.map((claim) => [claim.id, claim]));
  const researchById = new Map(document.spotResearch.map((row) => [row.spotId, row]));
  return spotCatalog.map((catalog) => {
    const research = researchById.get(catalog.id);
    const preview = resolveSpotAdvicePreview(document, context, catalog.id);
    const applicable = preview.applicableClaims;
    const directClaims = (research?.directClaimIds ?? []).map((id) => claimsById.get(id)).filter(Boolean);
    const inheritedClaims = (research?.inheritedApprovals ?? []).map((approval) => claimsById.get(approval.claimId)).filter(Boolean);
    const directCount = directClaims.length;
    const inheritedCount = inheritedClaims.length;
    return {
      ...clone(catalog),
      areaIds: preview.areaIds,
      stretchIds: preview.stretchIds,
      research: clone(research),
      directClaimIds: directClaims.map((claim) => claim.id),
      inheritedClaimIds: inheritedClaims.map((claim) => claim.id),
      applicableClaimIds: applicable.map((claim) => claim.id),
      applicableScopeTypes: [...new Set(applicable.map((claim) => claim.scope.type))],
      topics: [...new Set(applicable.map((claim) => claim.topic))],
      confidences: [...new Set(applicable.map((claim) => claim.confidence))],
      publications: [...new Set(applicable.map((claim) => claim.publicationStatus))],
      consensuses: [...new Set(applicable.map((claim) => claim.consensus))],
      expiries: applicable.map((claim) => claim.revalidateAfter).filter(Boolean),
      missingDirectEvidence: research?.directEvidenceOutcome === "no-credible-spot-source-found",
      adviceCoverage: {
        status: preview.effectiveClaims.length > 0 ? "published" : "missing",
        effectiveCount: preview.effectiveClaims.length,
        effectiveClaimIds: preview.effectiveClaims.map((claim) => claim.id),
        overriddenClaimIds: preview.overriddenClaims.map((claim) => claim.id)
      },
      applicabilitySignoff: {
        directCount,
        inheritedCount,
        reviewedAt: research?.reviewedAt ?? null,
        label: `${directCount} direct signed off · ${inheritedCount} inherited approved`
      },
      conflictCount: applicable.filter((claim) => claim.consensus === "unresolved" || claim.conflictGroupId).length
    };
  });
}

function formatSavedTime(savedAt) {
  if (!savedAt) return "Autosave ready";
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? "Autosaved locally" : `Autosaved locally at ${date.toLocaleTimeString()}`;
}

export function createReviewRuntime({ canonicalDocument, baseDigest, storage, now = () => new Date() }) {
  let current = initializeWorkingState(canonicalDocument, baseDigest);
  let unsaved = false;
  let status = "Autosave ready";
  const recovered = storage?.getItem?.(current.autosaveKey);
  if (recovered) {
    try {
      current = recoverAutosave(canonicalDocument, baseDigest, recovered);
      status = current.savedAt ? formatSavedTime(current.savedAt) : "Recovered local autosave";
    } catch {}
  }
  return {
    state: () => current,
    replaceState(next) { current = next; unsaved = true; status = "Unsaved; autosave queued"; return current; },
    typeDraft(key, value) { current = setEditorDraft(current, key, value); unsaved = true; status = "Unsaved; autosave queued"; return current; },
    clearDraft(key) { current = clearEditorDraft(current, key); return current; },
    saveNow() {
      const savedAt = now().toISOString();
      current = { ...current, savedAt };
      storage?.setItem?.(current.autosaveKey, serializeAutosave(current, savedAt));
      unsaved = false;
      status = formatSavedTime(savedAt);
      return current;
    },
    reset() {
      storage?.removeItem?.(current.autosaveKey);
      current = resetWorkingState(current);
      unsaved = false;
      status = "Reset to canonical";
      return current;
    },
    beforeUnloadShouldWarn: () => unsaved,
    pendingCount: () => pendingCount(current),
    autosaveStatus: () => status
  };
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
