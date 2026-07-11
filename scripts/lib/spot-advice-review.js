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

export const MAX_REVIEW_PAYLOAD_BYTES = 5 * 1024 * 1024;

const TOPICS = new Set(["size-translation", "tide", "swell", "period-energy", "wind", "season", "mechanics", "ability", "hazard", "crowd-access"]);
const DECISION_TOPICS = new Set(["size-translation", "tide", "swell", "wind", "mechanics"]);
const SCOPE_TYPES = new Set(["spot", "stretch", "area"]);
const PUBLICATION_STATUSES = new Set(["draft", "published", "rejected"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const CONSENSUS_VALUES = new Set(["settled", "unresolved"]);
const EVIDENCE_KINDS = new Set(["user-observed", "local-guide", "specialist-guide", "provider", "inference"]);
const EVIDENCE_STATUSES = new Set(["accepted", "rejected"]);

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

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) data[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((data[start] << 24) | (data[start + 1] << 16) | (data[start + 2] << 8) | data[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function digestReviewClaim(claim) {
  return sha256Hex(`${JSON.stringify(sortObjectKeys(claim), null, 2)}\n`);
}

export function isMaterialClaimChange(before, after) {
  if (!before || !after) return true;
  return MATERIAL_CLAIM_FIELDS.some((field) => !sameValue(before[field], after[field]));
}

function resetMaterialReview(baseline, next) {
  if (isMaterialClaimChange(baseline, next)) {
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
  const baseline = state.canonicalDocument.advice.find((claim) => claim.id === claimId);
  const candidate = { ...before, ...clone(patch) };
  document.advice[index] = resetMaterialReview(baseline, candidate);
  return withDocument(state, document);
}

export function applyClaimEditorPatch(state, claimId, patch) {
  const current = state.document.advice.find((claim) => claim.id === claimId);
  if (!current) throw new Error(`unknown claim ${claimId}`);
  let next = state;
  const remaining = clone(patch);
  if (remaining.scope && !sameValue(current.scope, remaining.scope)) {
    next = rescopeClaim(next, claimId, remaining.scope);
    delete remaining.scope;
  }
  return updateClaim(next, claimId, remaining);
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

export function normalizeReviewDocument(canonicalDocument, document) {
  const normalized = clone(document);
  const baseline = new Map(canonicalDocument.advice.map((claim) => [claim.id, claim]));
  for (const claim of normalized.advice) {
    const before = baseline.get(claim.id);
    if (!before || isMaterialClaimChange(before, claim)) {
      claim.publicationStatus = "draft";
      claim.reviewedAt = null;
      claim.calculationCandidate = false;
    }
  }
  return normalized;
}

export function exportFeedback(state) {
  return { schemaVersion: 1, baseDigest: state.baseDigest, document: normalizeReviewDocument(state.canonicalDocument, state.document) };
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

function payloadBytes(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return new TextEncoder().encode(text).byteLength;
}

function parseBoundedPayload(input, maxBytes, label) {
  if (payloadBytes(input) > maxBytes) throw new Error(`${label} is too large; maximum size is ${maxBytes} bytes`);
  return typeof input === "string" ? JSON.parse(input) : clone(input);
}

function requireReview(condition, message) {
  if (!condition) throw new Error(`spot advice review validation: ${message}`);
}

function requireString(value, label) {
  requireReview(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
}

function requireUnique(values, label) {
  requireReview(new Set(values).size === values.length, `duplicate ${label}`);
}

function validateReviewRule(rule, label) {
  requireReview(rule && typeof rule === "object" && !Array.isArray(rule), `${label} rule must be an object`);
  requireReview(["minimum", "tide-preference", "direction-preference", "qualitative"].includes(rule.type), `${label} rule type is unsupported`);
  if (rule.type === "minimum") {
    requireReview(rule.input === "primary-swell-height-m" && Number.isFinite(rule.value) && rule.value >= 0, `${label} minimum rule is invalid`);
  }
  if (rule.type === "tide-preference") requireReview(["low", "mid", "high"].includes(rule.stage), `${label} tide rule is invalid`);
  if (rule.type === "direction-preference") {
    requireReview(["primary-swell-direction-deg", "wind-direction-deg"].includes(rule.input), `${label} direction rule input is invalid`);
    requireReview(Array.isArray(rule.arcs) && rule.arcs.length > 0 && rule.arcs.every((arc) => Number.isFinite(arc?.start) && Number.isFinite(arc?.end)), `${label} direction rule arcs are invalid`);
  }
}

export function validateReviewDocument(document, context) {
  assertDocumentShape(document);
  requireReview(Array.isArray(context?.spotIds) && Array.isArray(context?.stretches?.stretches), "validation context is incomplete");
  const spotIds = context.spotIds;
  const spotSet = new Set(spotIds);
  const stretchSet = new Set(context.stretches.stretches.map((stretch) => stretch.id));
  const areaSet = new Set(document.areas.map((area) => area.id));
  requireUnique(document.areas.map((area) => area.id), "area id");
  for (const area of document.areas) {
    requireString(area.id, "area id"); requireString(area.name, `${area.id} area name`);
    requireReview(Array.isArray(area.spotIds) && area.spotIds.every((id) => spotSet.has(id)), `${area.id} area membership is invalid`);
  }
  const claims = document.advice;
  requireUnique(claims.map((claim) => claim?.id), "claim id");
  const claimsById = new Map();
  for (const [index, claim] of claims.entries()) {
    const label = `claim ${claim?.id ?? index}`;
    requireReview(claim && typeof claim === "object" && !Array.isArray(claim), `${label} must be an object`);
    requireString(claim.id, `${label} id`); requireString(claim.overrideKey, `${label} overrideKey`); requireString(claim.summary, `${label} summary`);
    requireReview(claim.scope && typeof claim.scope === "object" && SCOPE_TYPES.has(claim.scope.type), `${label} scope is invalid`);
    requireString(claim.scope.id, `${label} scope id`);
    requireReview(claim.scope.type !== "spot" || spotSet.has(claim.scope.id), `${label} spot scope is unknown`);
    requireReview(claim.scope.type !== "stretch" || stretchSet.has(claim.scope.id), `${label} stretch scope is unknown`);
    requireReview(claim.scope.type !== "area" || areaSet.has(claim.scope.id), `${label} area scope is unknown`);
    requireReview(TOPICS.has(claim.topic), `${label} topic is invalid`);
    requireReview(CONFIDENCES.has(claim.confidence), `${label} confidence is invalid`);
    requireReview(PUBLICATION_STATUSES.has(claim.publicationStatus), `${label} publicationStatus is invalid`);
    requireReview(CONSENSUS_VALUES.has(claim.consensus), `${label} consensus is invalid`);
    requireReview(claim.calculationCandidate === false, `${label} calculation activation is forbidden`);
    requireReview(claim.publicationStatus !== "published" || typeof claim.reviewedAt === "string", `${label} published claim needs reviewedAt`);
    validateReviewRule(claim.rule, label);
    requireReview(Array.isArray(claim.evidence) && claim.evidence.length > 0, `${label} evidence must be non-empty`);
    for (const [evidenceIndex, evidence] of claim.evidence.entries()) {
      const evidenceLabel = `${label} evidence ${evidenceIndex}`;
      requireReview(evidence && typeof evidence === "object", `${evidenceLabel} must be an object`);
      requireReview(EVIDENCE_KINDS.has(evidence.kind), `${evidenceLabel} kind is invalid`);
      requireReview(EVIDENCE_STATUSES.has(evidence.status), `${evidenceLabel} status is invalid`);
      for (const key of ["title", "publisher", "supportedClaim", "quality", "accessedAt"]) requireString(evidence[key], `${evidenceLabel} ${key}`);
      requireReview(evidence.url == null || isSafeExternalUrl(evidence.url), `${evidenceLabel} URL is unsafe`);
      if (evidence.kind === "inference") requireReview(Array.isArray(evidence.inputClaimIds) && evidence.inputClaimIds.length >= 2, `${evidenceLabel} inference inputs are invalid`);
    }
    claimsById.set(claim.id, claim);
  }
  for (const claim of claims) {
    for (const evidence of claim.evidence.filter((item) => item.kind === "inference" && item.status === "accepted")) {
      for (const inputId of evidence.inputClaimIds) {
        const input = claimsById.get(inputId);
        requireReview(input?.evidence.some((item) => item.status === "accepted"), `${claim.id} inference input ${inputId} is unknown or unsupported`);
      }
    }
  }
  const collisionGroups = new Map();
  for (const claim of claims.filter((item) => item.publicationStatus === "published")) {
    const key = `${claim.scope.type}\u0000${claim.scope.id}\u0000${claim.overrideKey}`;
    if (!collisionGroups.has(key)) collisionGroups.set(key, []);
    collisionGroups.get(key).push(claim);
  }
  for (const group of collisionGroups.values()) {
    if (group.length < 2) continue;
    requireReview(group.every((claim) => claim.consensus === "unresolved" && claim.conflictGroupId && claim.position)
      && new Set(group.map((claim) => claim.conflictGroupId)).size === 1, `published claim collision for ${group[0].overrideKey}`);
  }
  requireReview(Array.isArray(document.spotResearch) && document.spotResearch.length === spotIds.length, "research rows must match selected spots");
  requireReview(document.spotResearch.every((row, index) => row.spotId === spotIds[index]), "research identity and order must match selected spots");
  const directOwners = new Set();
  for (const row of document.spotResearch) {
    requireReview(row.status === "complete", `${row.spotId} research must be complete`);
    requireReview(["found", "no-credible-spot-source-found"].includes(row.directEvidenceOutcome), `${row.spotId} research outcome is invalid`);
    requireReview(Array.isArray(row.checkedSources) && row.checkedSources.length > 0, `${row.spotId} checked sources must be non-empty`);
    requireReview(row.checkedSources.every((source) => source && typeof source === "object" && isSafeExternalUrl(source.url)), `${row.spotId} checked source is invalid`);
    requireReview(Array.isArray(row.directClaimIds), `${row.spotId} direct claims must be an array`);
    requireUnique(row.directClaimIds, `${row.spotId} direct claim`);
    if (row.directEvidenceOutcome === "found") requireReview(row.directClaimIds.length > 0, `${row.spotId} found outcome needs a direct claim`);
    if (row.directEvidenceOutcome !== "found") requireReview(row.directClaimIds.length === 0, `${row.spotId} no-source outcome cannot have direct claims`);
    for (const id of row.directClaimIds) {
      const claim = claimsById.get(id);
      requireReview(claim?.scope.type === "spot" && claim.scope.id === row.spotId, `${row.spotId} direct claim ${id} has invalid scope`);
      directOwners.add(id);
    }
    requireReview(Array.isArray(row.inheritedApprovals ?? []), `${row.spotId} inherited approvals must be an array`);
    for (const approval of row.inheritedApprovals ?? []) {
      const claim = claimsById.get(approval.claimId);
      requireReview(claim && claim.scope.type !== "spot", `${row.spotId} inherited approval ${approval.claimId} is invalid`);
      requireReview(/^[a-f0-9]{64}$/.test(approval.claimDigest ?? "") && approval.claimDigest === digestReviewClaim(claim), `${row.spotId} approval digest changed for ${approval.claimId}`);
      const applicable = claim.scope.type === "area"
        ? document.areas.some((area) => area.id === claim.scope.id && area.spotIds.includes(row.spotId))
        : context.stretches.stretches.some((stretch) => stretch.id === claim.scope.id && stretch.surflineSpotIds.includes(row.spotId));
      requireReview(applicable, `${row.spotId} inherited approval ${approval.claimId} has inapplicable membership`);
    }
  }
  for (const claim of claims.filter((item) => item.publicationStatus === "published" && item.scope.type === "spot")) {
    requireReview(directOwners.has(claim.id), `${claim.id} published spot claim lacks direct membership`);
  }
  for (const spotId of spotIds) {
    const preview = resolveSpotAdvicePreview(document, context, spotId);
    requireReview(preview.effectiveClaims.some((claim) => DECISION_TOPICS.has(claim.topic)), `${spotId} lacks published decision coverage`);
  }
  return document;
}

export function recoverAutosave(canonicalDocument, baseDigest, serialized, { validationContext, maxBytes = MAX_REVIEW_PAYLOAD_BYTES } = {}) {
  const state = initializeWorkingState(canonicalDocument, baseDigest);
  const value = parseBoundedPayload(serialized, maxBytes, "autosave payload");
  assertObject(value, "autosave envelope");
  if (value.schemaVersion !== 1) throw new Error("autosave schemaVersion must be 1");
  if (value.baseDigest !== baseDigest) throw new Error("autosave digest does not match this canonical document");
  assertDocumentShape(value.document);
  if (value.editorDrafts !== undefined) assertObject(value.editorDrafts, "autosave editorDrafts");
  if (validationContext) validateReviewDocument(value.document, validationContext);
  return {
    ...state,
    document: clone(value.document),
    editorDrafts: clone(value.editorDrafts ?? {}),
    savedAt: value.savedAt ?? null
  };
}

export function importFeedback(state, input, { validationContext, maxBytes = MAX_REVIEW_PAYLOAD_BYTES } = {}) {
  const envelope = parseEnvelope(parseBoundedPayload(input, maxBytes, "feedback payload"));
  if (envelope.baseDigest !== state.baseDigest) throw new Error("feedback digest does not match this canonical document");
  if (validationContext) validateReviewDocument(envelope.document, validationContext);
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
    const ledgerClaims = [...new Map([...directClaims, ...inheritedClaims].map((claim) => [claim.id, claim])).values()];
    const directCount = directClaims.length;
    const inheritedCount = inheritedClaims.length;
    return {
      ...clone(catalog),
      areaIds: preview.areaIds,
      stretchIds: preview.stretchIds,
      research: clone(research),
      directClaimIds: directClaims.map((claim) => claim.id),
      inheritedClaimIds: inheritedClaims.map((claim) => claim.id),
      geographicallyApplicableClaimIds: applicable.map((claim) => claim.id),
      applicableClaimIds: ledgerClaims.map((claim) => claim.id),
      applicableScopeTypes: [...new Set(ledgerClaims.map((claim) => claim.scope.type))],
      topics: [...new Set(ledgerClaims.map((claim) => claim.topic))],
      confidences: [...new Set(ledgerClaims.map((claim) => claim.confidence))],
      publications: [...new Set(ledgerClaims.map((claim) => claim.publicationStatus))],
      consensuses: [...new Set(ledgerClaims.map((claim) => claim.consensus))],
      expiries: ledgerClaims.map((claim) => claim.revalidateAfter).filter(Boolean),
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
      conflictCount: ledgerClaims.filter((claim) => claim.consensus === "unresolved" || claim.conflictGroupId).length
    };
  });
}

function formatSavedTime(savedAt) {
  if (!savedAt) return "Autosave ready";
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? "Autosaved locally" : `Autosaved locally at ${date.toLocaleTimeString()}`;
}

export function createReviewRuntime({
  canonicalDocument,
  baseDigest,
  storage,
  now = () => new Date(),
  validationContext,
  maxPayloadBytes = MAX_REVIEW_PAYLOAD_BYTES
}) {
  if (validationContext) validateReviewDocument(canonicalDocument, validationContext);
  let current = initializeWorkingState(canonicalDocument, baseDigest);
  let unsaved = false;
  let status = "Autosave ready";
  const recovered = storage?.getItem?.(current.autosaveKey);
  if (recovered) {
    try {
      current = recoverAutosave(canonicalDocument, baseDigest, recovered, { validationContext, maxBytes: maxPayloadBytes });
      status = current.savedAt ? formatSavedTime(current.savedAt) : "Recovered local autosave";
    } catch {}
  }
  const validatedReplacement = (next) => {
    const normalized = { ...next, document: normalizeReviewDocument(canonicalDocument, next.document) };
    if (validationContext) validateReviewDocument(normalized.document, validationContext);
    return normalized;
  };
  return {
    state: () => current,
    replaceState(next) { current = validatedReplacement(next); unsaved = true; status = "Unsaved; autosave queued"; return current; },
    typeDraft(key, value) { current = setEditorDraft(current, key, value); unsaved = true; status = "Unsaved; autosave queued"; return current; },
    clearDraft(key) { current = clearEditorDraft(current, key); return current; },
    saveNow() {
      current = validatedReplacement(current);
      const savedAt = now().toISOString();
      current = { ...current, savedAt };
      storage?.setItem?.(current.autosaveKey, serializeAutosave(current, savedAt));
      unsaved = false;
      status = formatSavedTime(savedAt);
      return current;
    },
    importPayload(input) {
      current = importFeedback(current, input, { validationContext, maxBytes: maxPayloadBytes });
      unsaved = true;
      status = "Unsaved; autosave queued";
      return current;
    },
    feedback() {
      const feedback = exportFeedback(current);
      if (validationContext) validateReviewDocument(feedback.document, validationContext);
      return feedback;
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
