import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { buildSpotAdviceFiles } from "../scripts/build-spot-advice.js";
import {
  canonicalJson,
  compileSpotAdvice,
  digestClaim,
  digestDocument,
  validateSpotAdvice
} from "../scripts/lib/spot-advice-build.js";
import {
  addClaim,
  addEvidence,
  applyClaimEditorPatch,
  buildDynamicReviewSpots,
  deleteClaim,
  deleteEvidence,
  exportFeedback,
  filterReviewSpots,
  importFeedback,
  initializeWorkingState,
  isSafeExternalUrl,
  mergeClaims,
  MAX_REVIEW_PAYLOAD_BYTES,
  pendingCount,
  createReviewRuntime,
  recoverAutosave,
  resetWorkingState,
  rescopeClaim,
  resolveSpotAdvicePreview,
  serializeAutosave,
  setEditorDraft,
  signOffClaim,
  splitClaim,
  updateClaim,
  updateEvidence,
  updateResearchRow,
  validateReviewDocument
} from "../scripts/lib/spot-advice-review.js";
import {
  buildSpotAdviceReviewFiles,
  buildSpotAdviceReviewModel,
  renderSpotAdviceReviewHtml
} from "../scripts/build-spot-advice-review-html.js";
import {
  applyFeedback as applyFeedbackFile,
  prepareFeedbackCandidate
} from "../scripts/apply-spot-advice-feedback.js";

const clone = (value) => structuredClone(value);
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

function fixtureDocument() {
  return readJson("data/spot-advice.json");
}

function fixtureContext() {
  return {
    promotions: readJson("data/surfline-promotions.json"),
    surflineSpots: readJson("data/surfline-spots.json"),
    stretches: readJson("data/stretches.json"),
    promotedDb: readJson("data/promoted-spots.json"),
    enrichmentDb: readJson("data/spot-metadata-enrichment.json"),
    defaultFavoriteIds: [...DEFAULT_FAVORITE_IDS]
  };
}

function stateFixture() {
  const document = fixtureDocument();
  return initializeWorkingState(document, digestDocument(document));
}

function draftClaim(id = "review-fixture-claim") {
  return {
    id,
    scope: { type: "spot", id: "surfline-nazare" },
    topic: "wind",
    overrideKey: `wind.${id}`,
    summary: "A local review fixture.",
    rule: { type: "qualitative" },
    evidence: [{
      kind: "user-observed",
      title: "Review fixture",
      publisher: "Local knowledge",
      url: null,
      accessedAt: "2026-07-11",
      supportedClaim: "A local review fixture.",
      quality: "first-hand",
      status: "accepted"
    }],
    confidence: "medium",
    publicationStatus: "draft",
    consensus: "settled",
    calculationCandidate: false,
    reviewedAt: null,
    revalidateAfter: null
  };
}

test("working state starts from an isolated canonical document and digest", () => {
  const canonical = fixtureDocument();
  const digest = digestDocument(canonical);
  const state = initializeWorkingState(canonical, digest);
  assert.equal(state.baseDigest, digest);
  assert.deepEqual(state.document, canonical);
  assert.deepEqual(state.canonicalDocument, canonical);
  state.document.advice[0].summary = "changed";
  assert.notEqual(state.canonicalDocument.advice[0].summary, "changed");
  assert.equal(state.autosaveKey, `spot-advice-review:${digest}`);
});

test("every material claim field resets publication review metadata", async (t) => {
  const materialCases = [
    ["summary", (claim) => { claim.summary += " Material edit."; }],
    ["rule", (claim) => { claim.rule = { type: "qualitative" }; }],
    ["scope", (claim) => { claim.scope = { type: "area", id: "nazare-area" }; }],
    ["overrideKey", (claim) => { claim.overrideKey += ".edited"; }],
    ["evidence", (claim) => { claim.evidence[0].supportedClaim += " Edited."; }],
    ["confidence", (claim) => { claim.confidence = claim.confidence === "low" ? "medium" : "low"; }],
    ["consensus", (claim) => { claim.consensus = "unresolved"; claim.conflictGroupId = "fixture-conflict"; claim.position = "first"; }],
    ["conflictGroupId", (claim) => { claim.consensus = "unresolved"; claim.conflictGroupId = "fixture-conflict"; claim.position = "first"; }],
    ["position", (claim) => { claim.consensus = "unresolved"; claim.conflictGroupId = "fixture-conflict"; claim.position = "second"; }]
  ];
  for (const [field, mutate] of materialCases) {
    await t.test(field, () => {
      const state = stateFixture();
      const claim = clone(state.document.advice[0]);
      mutate(claim);
      const next = updateClaim(state, claim.id, claim);
      const edited = next.document.advice.find((item) => item.id === claim.id);
      assert.equal(edited.publicationStatus, "draft");
      assert.equal(edited.reviewedAt, null);
      assert.equal(edited.calculationCandidate, false);
    });
  }
});

test("material edits reset rejected and draft claims in both editor and apply-time defense", () => {
  const rejectedState = stateFixture();
  rejectedState.document.advice[0].publicationStatus = "rejected";
  const rejected = updateClaim(rejectedState, rejectedState.document.advice[0].id, { summary: "Rejected claim changed." });
  assert.deepEqual(
    Object.fromEntries(["publicationStatus", "reviewedAt", "calculationCandidate"].map((key) => [key, rejected.document.advice[0][key]])),
    { publicationStatus: "draft", reviewedAt: null, calculationCandidate: false }
  );

  const draftState = stateFixture();
  draftState.document.advice[0].publicationStatus = "draft";
  const draft = updateClaim(draftState, draftState.document.advice[0].id, { summary: "Draft claim changed." });
  assert.equal(draft.document.advice[0].reviewedAt, null);

  const canonical = fixtureDocument();
  canonical.advice[0].publicationStatus = "rejected";
  const feedback = { schemaVersion: 1, baseDigest: digestDocument(canonical), document: clone(canonical) };
  feedback.document.advice[0].summary = "Apply-time rejected edit.";
  const candidate = prepareFeedbackCandidate(canonical, feedback);
  assert.equal(candidate.advice[0].publicationStatus, "draft");
  assert.equal(candidate.advice[0].reviewedAt, null);
  assert.equal(candidate.advice[0].calculationCandidate, false);
});

test("nonmaterial edits preserve publication state while a material draft cannot republish against its old baseline", () => {
  const state = stateFixture();
  const claim = state.document.advice[0];
  const expiry = updateClaim(state, claim.id, { revalidateAfter: "2027-01-01" });
  const preserved = expiry.document.advice.find((item) => item.id === claim.id);
  assert.equal(preserved.publicationStatus, "published");
  assert.equal(preserved.reviewedAt, claim.reviewedAt);
  const reorderedRule = { arcs: clone(claim.rule.arcs), input: claim.rule.input, type: claim.rule.type };
  const reordered = updateClaim(state, claim.id, { rule: reorderedRule });
  assert.equal(reordered.document.advice.find((item) => item.id === claim.id).publicationStatus, "published");

  const drafted = updateClaim(expiry, claim.id, { summary: `${claim.summary} Edited.` });
  const reviewedAt = "2026-07-12T10:00:00.000Z";
  const published = updateClaim(drafted, claim.id, { publicationStatus: "published", reviewedAt });
  assert.equal(published.document.advice.find((item) => item.id === claim.id).publicationStatus, "draft");
  assert.equal(published.document.advice.find((item) => item.id === claim.id).reviewedAt, null);
});

test("material edits cannot be republished until a second canonical review pass and export equals apply output", () => {
  let state = stateFixture();
  const id = "research-praia-da-rainha-tide";
  state = updateClaim(state, id, { summary: "Rainha material edit awaiting a new pass." });
  state = updateClaim(state, id, { publicationStatus: "published", reviewedAt: "2026-07-12T10:00:00.000Z" });
  assert.equal(state.document.advice.find((claim) => claim.id === id).publicationStatus, "draft");
  assert.equal(state.document.advice.find((claim) => claim.id === id).reviewedAt, null);
  const feedback = exportFeedback(state);
  assert.deepEqual(prepareFeedbackCandidate(state.canonicalDocument, feedback), feedback.document);

  const { canonicalPath } = tempCanonical();
  const applied = applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() });
  assert.deepEqual(applied.document, feedback.document);
  assert.deepEqual(readJson(canonicalPath), feedback.document);

  let secondPass = initializeWorkingState(applied.document, digestDocument(applied.document));
  secondPass = updateClaim(secondPass, id, { publicationStatus: "published", reviewedAt: "2026-07-13T10:00:00.000Z" });
  assert.equal(secondPass.document.advice.find((claim) => claim.id === id).publicationStatus, "published");
});

test("sole Nazaré claim supports explicit two-step signoff and exact coverage-valid apply", () => {
  const initial = stateFixture();
  const runtime = createReviewRuntime({
    canonicalDocument: initial.canonicalDocument,
    baseDigest: initial.baseDigest,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    validationContext: fixtureContext()
  });
  let state = runtime.replaceState(updateClaim(runtime.state(), "research-nazare-swell", { summary: "Corrected Nazaré swell guidance." }));
  assert.equal(state.document.advice[0].publicationStatus, "draft");
  assert.equal(state.document.advice[0].reviewedAt, null);
  assert.equal(pendingCount(state), 1);
  assert.throws(() => signOffClaim(state, "research-nazare-swell", "2026-07-10T12:00:00.000Z"), /fresh/i);
  state = runtime.replaceState(signOffClaim(state, "research-nazare-swell", "2026-07-12T12:00:00.000Z"));
  assert.equal(state.document.advice[0].publicationStatus, "published");
  assert.equal(state.document.advice[0].reviewedAt, "2026-07-12T12:00:00.000Z");
  const feedback = runtime.feedback();
  assert.doesNotThrow(() => validateSpotAdvice(feedback.document, fixtureContext()));
  const { canonicalPath } = tempCanonical();
  const applied = applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() });
  assert.deepEqual(applied.document, feedback.document);
  assert.deepEqual(readJson(canonicalPath), feedback.document);
  const html = renderSpotAdviceReviewHtml(buildSpotAdviceReviewModel({ document: fixtureDocument(), context: fixtureContext() }));
  assert.match(html, /Review \/ Sign off/);
  assert.match(html, /signOffClaim/);
});

test("a new claim can be explicitly signed off and applies with exact readback", () => {
  let state = stateFixture();
  state = addClaim(state, draftClaim("new-reviewed-claim"), { directSpotId: "surfline-nazare" });
  assert.equal(state.document.advice.find((claim) => claim.id === "new-reviewed-claim").publicationStatus, "draft");
  state = signOffClaim(state, "new-reviewed-claim", "2026-07-12T14:00:00.000Z");
  const feedback = exportFeedback(state);
  assert.equal(feedback.document.advice.find((claim) => claim.id === "new-reviewed-claim").publicationStatus, "published");
  const { canonicalPath } = tempCanonical();
  const applied = applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() });
  assert.deepEqual(applied.document, feedback.document);
  assert.deepEqual(readJson(canonicalPath), feedback.document);
});

test("claim CRUD, evidence CRUD, split, merge, and re-scope keep review state coherent", () => {
  let state = stateFixture();
  const before = state.document.advice.length;
  state = addClaim(state, draftClaim());
  assert.equal(state.document.advice.length, before + 1);
  assert.equal(state.document.advice.at(-1).publicationStatus, "draft");
  assert.equal(pendingCount(state), 1);

  state = addEvidence(state, "review-fixture-claim", {
    kind: "provider", title: "Provider", publisher: "Fixture", url: "https://example.com/source",
    accessedAt: "2026-07-11", supportedClaim: "Fixture support", quality: "provider-record", status: "accepted", locationMatch: "exact-spot"
  });
  assert.equal(state.document.advice.at(-1).evidence.length, 2);
  state = updateEvidence(state, "review-fixture-claim", 1, { title: "Updated provider" });
  assert.equal(state.document.advice.at(-1).evidence[1].title, "Updated provider");
  state = deleteEvidence(state, "review-fixture-claim", 1);
  assert.equal(state.document.advice.at(-1).evidence.length, 1);

  state = rescopeClaim(state, "review-fixture-claim", { type: "area", id: "nazare-area" });
  assert.deepEqual(state.document.advice.at(-1).scope, { type: "area", id: "nazare-area" });
  state = splitClaim(state, "review-fixture-claim", {
    newId: "review-fixture-split",
    originalPatch: { summary: "First half." },
    newClaimPatch: { summary: "Second half.", overrideKey: "wind.review-fixture-split" }
  });
  assert.equal(state.document.advice.find((item) => item.id === "review-fixture-claim").summary, "First half.");
  assert.equal(state.document.advice.find((item) => item.id === "review-fixture-split").publicationStatus, "draft");
  state = mergeClaims(state, "review-fixture-claim", "review-fixture-split", { summary: "Merged again." });
  assert.equal(state.document.advice.some((item) => item.id === "review-fixture-split"), false);
  assert.equal(state.document.advice.find((item) => item.id === "review-fixture-claim").summary, "Merged again.");
  state = deleteClaim(state, "review-fixture-claim");
  assert.equal(state.document.advice.length, before);
  assert.equal(pendingCount(state), 0);
});

test("deleting and adding claims update direct research memberships", () => {
  let state = stateFixture();
  const claim = draftClaim("review-direct-claim");
  state = addClaim(state, claim, { directSpotId: "surfline-nazare" });
  assert.ok(state.document.spotResearch[0].directClaimIds.includes(claim.id));
  state = deleteClaim(state, claim.id);
  assert.ok(!state.document.spotResearch[0].directClaimIds.includes(claim.id));
});

test("research rows can be edited without resetting unrelated claim publication", () => {
  const state = stateFixture();
  const firstClaim = state.document.advice[0];
  const next = updateResearchRow(state, "surfline-nazare", { editorialNotes: "Recheck the canyon wording." });
  assert.equal(next.document.spotResearch[0].editorialNotes, "Recheck the canyon wording.");
  assert.equal(next.document.advice[0].publicationStatus, firstClaim.publicationStatus);
});

test("pending count compares the complete document to canonical and includes unsaved editor drafts", () => {
  const state = stateFixture();
  assert.equal(pendingCount(state), 0);
  assert.equal(pendingCount(updateResearchRow(state, "surfline-nazare", { editorialNotes: "changed" })), 1);
  assert.equal(pendingCount(updateClaim(state, state.document.advice[0].id, { revalidateAfter: "2027-01-01" })), 1);
  assert.equal(pendingCount(updateEvidence(state, state.document.advice[0].id, 0, { title: "Changed evidence" })), 1);
  assert.equal(pendingCount(deleteClaim(state, state.document.advice[0].id)), 2);
  assert.equal(pendingCount(setEditorDraft(state, "claim:research-nazare-swell", { summary: "typed, not saved" })), 1);
});

test("review runtime autosaves typed drafts with a saved time, recovers them, warns only before save, and reset returns zero pending", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const canonical = fixtureDocument();
  const baseDigest = digestDocument(canonical);
  const runtime = createReviewRuntime({ canonicalDocument: canonical, baseDigest, storage, now: () => new Date("2026-07-11T12:34:56.000Z") });
  runtime.typeDraft("research:surfline-nazare", "typed before Save");
  assert.equal(runtime.beforeUnloadShouldWarn(), true);
  assert.equal(runtime.pendingCount(), 1);
  runtime.saveNow();
  assert.equal(runtime.beforeUnloadShouldWarn(), false);
  assert.match(runtime.autosaveStatus(), /34:56/i);

  const recovered = createReviewRuntime({ canonicalDocument: canonical, baseDigest, storage, now: () => new Date("2026-07-11T12:35:00.000Z") });
  assert.equal(recovered.state().editorDrafts["research:surfline-nazare"], "typed before Save");
  assert.equal(recovered.pendingCount(), 1);
  recovered.reset();
  assert.deepEqual(recovered.state().document, canonical);
  assert.deepEqual(recovered.state().editorDrafts, {});
  assert.equal(recovered.pendingCount(), 0);
  assert.equal(recovered.beforeUnloadShouldWarn(), false);
});

test("typed draft recovery preserves complete claim fields with invalid rule JSON and explicit empty textareas", () => {
  let state = stateFixture();
  const claimKey = "claim:research-nazare-swell";
  state = setEditorDraft(state, claimKey, { summary: "Changed before save", topic: "swell", rule: { type: "qualitative" } });
  state = setEditorDraft(state, claimKey, { rule: "{ invalid json" });
  state = setEditorDraft(state, "evidence:research-nazare-swell:0", "");
  state = setEditorDraft(state, "research:surfline-nazare", "");
  const recovered = recoverAutosave(state.canonicalDocument, state.baseDigest, serializeAutosave(state, "2026-07-11T12:34:56.000Z"));
  assert.equal(recovered.editorDrafts[claimKey].summary, "Changed before save");
  assert.equal(recovered.editorDrafts[claimKey].topic, "swell");
  assert.equal(recovered.editorDrafts[claimKey].rule, "{ invalid json");
  assert.equal(recovered.editorDrafts["evidence:research-nazare-swell:0"], "");
  assert.equal(recovered.editorDrafts["research:surfline-nazare"], "");
});

test("autosave serialization recovers only the matching digest and reset restores canonical", () => {
  const state = updateResearchRow(stateFixture(), "surfline-nazare", { editorialNotes: "Autosaved" });
  const serialized = serializeAutosave(state);
  const recovered = recoverAutosave(state.canonicalDocument, state.baseDigest, serialized);
  assert.equal(recovered.document.spotResearch[0].editorialNotes, "Autosaved");
  assert.equal(recovered.autosaveKey, state.autosaveKey);
  assert.throws(() => recoverAutosave(state.canonicalDocument, "0".repeat(64), serialized), /digest/i);
  const reset = resetWorkingState(recovered);
  assert.equal(reset.document.spotResearch[0].editorialNotes, undefined);
});

test("import validates the envelope and digest; export has the exact feedback shape", () => {
  const state = stateFixture();
  const payload = exportFeedback(state);
  assert.deepEqual(Object.keys(payload), ["schemaVersion", "baseDigest", "document"]);
  assert.deepEqual(payload, { schemaVersion: 1, baseDigest: state.baseDigest, document: state.document });
  assert.deepEqual(importFeedback(state, JSON.stringify(payload)).document, state.document);
  assert.throws(() => importFeedback(state, { ...payload, baseDigest: "0".repeat(64) }), /digest/i);
  assert.throws(() => importFeedback(state, { ...payload, surprise: true }), /shape|field/i);
  assert.throws(() => importFeedback(state, { schemaVersion: 2, baseDigest: state.baseDigest, document: state.document }), /schema/i);
});

test("URL policy accepts only HTTP(S) external links", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,bad", "file:///tmp/bad", "//example.com/path", "mailto:a@example.com", "not a url"]) {
    assert.equal(isSafeExternalUrl(value), false, value);
  }
  assert.equal(isSafeExternalUrl("https://example.com/path"), true);
  assert.equal(isSafeExternalUrl("http://example.com/path"), true);
  assert.equal(isSafeExternalUrl(null), false);
});

test("review model and HTML expose all 44 spots, filters, cockpit panes, and editing actions", () => {
  const document = fixtureDocument();
  const model = buildSpotAdviceReviewModel({ document, context: fixtureContext(), baseDigest: digestDocument(document) });
  assert.equal(model.spots.length, 44);
  const html = renderSpotAdviceReviewHtml(model);
  assert.equal((html.match(/data-spot-id=/g) || []).length, 44);
  assert.equal((html.match(/aria-current="false"/g) || []).length, 44);
  assert.match(html, /id="pending-count"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="autosave-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
  assert.match(html, /data-spot-id="surfline-nazare"[\s\S]*?research complete[\s\S]*?direct found/i);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
  const executable = scripts.find((match) => !match[0].includes('type="application/json"'))?.[1];
  assert.ok(executable);
  assert.doesNotThrow(() => new Function(executable.replace(/^\s*import[\s\S]*?;\s*/, "")));
  assert.match(executable, /setAttribute\("aria-current"/);
  assert.match(executable, /ariaPressed|aria-pressed/);
  const fileSizeGuard = executable.indexOf("file.size");
  const fileTextRead = executable.indexOf("file.text()");
  assert.ok(fileSizeGuard >= 0 && fileTextRead > fileSizeGuard, "File.size must be checked before File.text()");
  for (const marker of [
    "filter-area", "filter-scope", "filter-topic", "filter-confidence", "filter-publication", "filter-consensus", "filter-expiry", "filter-missing-direct",
    "research outcome", "direct evidence", "coverage", "conflicts", "claim-editor", "evidence-editor", "Split claim", "Merge claim", "Re-scope",
    "conflict group", "confidence", "publication", "reviewed", "expiry", "source-pane", "inheritance-preview", "Local lens", "Import", "Export", "Reset",
    "autosave-status", "pending-count", "beforeunload", "localStorage"
  ]) assert.match(html, new RegExp(marker, "i"), marker);
});

test("filter runtime uses canonical area and actual applicable claim scopes", () => {
  const document = fixtureDocument();
  const model = buildSpotAdviceReviewModel({ document, context: fixtureContext() });
  const peniche = filterReviewSpots(model.spots, { area: "peniche" });
  assert.equal(peniche.length, 5);
  assert.ok(peniche.every((spot) => spot.areaIds.includes("peniche")));
  const spotScoped = filterReviewSpots(model.spots, { scope: "spot" });
  assert.equal(spotScoped.length, 42);
  assert.ok(spotScoped.every((spot) => spot.applicableScopeTypes.includes("spot")));
  assert.ok(!spotScoped.some((spot) => spot.id === "surfline-praia-da-laje" || spot.id === "surfline-praia-do-rei"));
});

test("dynamic review rows rebuild filter metadata, advice coverage, and mixed applicability from working state", () => {
  const document = fixtureDocument();
  const context = fixtureContext();
  const model = buildSpotAdviceReviewModel({ document, context });
  let rows = buildDynamicReviewSpots(document, model.spotCatalog, model.previewContext);
  let nazare = rows.find((spot) => spot.id === "surfline-nazare");
  assert.ok(nazare.publications.includes("published"));
  assert.equal(nazare.adviceCoverage.status, "published");

  let state = initializeWorkingState(document, digestDocument(document));
  state = updateClaim(state, "research-nazare-swell", {
    summary: "A material draft edit.",
    topic: "wind",
    confidence: "low",
    revalidateAfter: "2027-01-01"
  });
  rows = buildDynamicReviewSpots(state.document, model.spotCatalog, model.previewContext);
  nazare = rows.find((spot) => spot.id === "surfline-nazare");
  assert.deepEqual(nazare.publications, ["draft"]);
  assert.ok(nazare.topics.includes("wind"));
  assert.ok(nazare.confidences.includes("low"));
  assert.deepEqual(nazare.expiries, ["2027-01-01"]);
  assert.equal(nazare.adviceCoverage.status, "missing");
  assert.equal(filterReviewSpots(rows, { publication: "published" }).some((spot) => spot.id === nazare.id), false);
  assert.equal(filterReviewSpots(rows, { publication: "draft" }).some((spot) => spot.id === nazare.id), true);

  state = rescopeClaim(state, "research-nazare-swell", { type: "spot", id: "surfline-baleal" });
  rows = buildDynamicReviewSpots(state.document, model.spotCatalog, model.previewContext);
  assert.equal(rows.find((spot) => spot.id === "surfline-nazare").applicableScopeTypes.includes("spot"), false);
  assert.equal(rows.find((spot) => spot.id === "surfline-baleal").topics.includes("wind"), true);

  const rainha = buildDynamicReviewSpots(document, model.spotCatalog, model.previewContext).find((spot) => spot.id === "surfline-praia-da-rainha");
  assert.ok(rainha.applicabilitySignoff.directCount > 0);
  assert.ok(rainha.applicabilitySignoff.inheritedCount > 0);
  assert.match(rainha.applicabilitySignoff.label, /direct.*inherited/i);
});

test("Torre filter ledger excludes unsigned geographic claims after its signed direct claim becomes draft", () => {
  const document = fixtureDocument();
  const context = fixtureContext();
  const model = buildSpotAdviceReviewModel({ document, context });
  let state = initializeWorkingState(document, digestDocument(document));
  state = updateClaim(state, "user-torre-minimum-primary-swell", { summary: "Torre threshold edited into draft." });
  const rows = buildDynamicReviewSpots(state.document, model.spotCatalog, model.previewContext);
  const torre = rows.find((spot) => spot.id === "surfline-praia-de-torre");
  assert.deepEqual(torre.publications, ["draft"]);
  assert.deepEqual(torre.topics, ["size-translation"]);
  assert.deepEqual(torre.applicableScopeTypes, ["spot"]);
  assert.equal(torre.adviceCoverage.status, "missing");
  assert.equal(torre.adviceCoverage.effectiveCount, 0);
  assert.equal(filterReviewSpots(rows, { publication: "draft" }).some((spot) => spot.id === torre.id), true);
  assert.equal(filterReviewSpots(rows, { publication: "published" }).some((spot) => spot.id === torre.id), false);
});

test("spot ledger separates camera and published advice coverage with applicability signoff and effective inheritance", () => {
  const document = fixtureDocument();
  const context = fixtureContext();
  const model = buildSpotAdviceReviewModel({ document, context });
  const laje = model.spots.find((spot) => spot.id === "surfline-praia-da-laje");
  assert.equal(laje.cameraCoverage, "spot");
  assert.equal(laje.adviceCoverage.status, "published");
  assert.match(laje.applicabilitySignoff.label, /inherited|approved/i);
  const lajePreview = resolveSpotAdvicePreview(document, context, laje.id);
  assert.ok(lajePreview.effectiveClaims.some((claim) => claim.id === "linha-stretch-sheltered-size-translation"));
  assert.ok(lajePreview.effectiveClaims.some((claim) => claim.scope.type === "stretch"));

  const rainhaPreview = resolveSpotAdvicePreview(document, context, "surfline-praia-da-rainha");
  assert.ok(rainhaPreview.effectiveClaims.some((claim) => claim.id === "research-praia-da-rainha-tide"));
  assert.ok(rainhaPreview.overriddenClaims.some((claim) => claim.id === "user-caparica-high-tide"));

  const withArea = clone(document);
  const areaClaim = {
    ...clone(withArea.advice[0]),
    id: "fixture-peniche-area-wind",
    scope: { type: "area", id: "peniche" },
    topic: "wind",
    overrideKey: "wind.fixture-area",
    summary: "Fixture area wind guidance."
  };
  withArea.advice.push(areaClaim);
  withArea.spotResearch.find((row) => row.spotId === "surfline-baleal").inheritedApprovals = [
    { claimId: areaClaim.id, claimDigest: digestClaim(areaClaim) }
  ];
  const areaPreview = resolveSpotAdvicePreview(withArea, context, "surfline-baleal");
  assert.ok(areaPreview.effectiveClaims.some((claim) => claim.id === areaClaim.id && claim.scope.type === "area"));
});

test("merge and re-scope clean all memberships and produce Task2-valid browser-state exports", () => {
  const context = fixtureContext();
  let state = stateFixture();
  state = addClaim(state, draftClaim("browser-merge-target"), { directSpotId: "surfline-nazare" });
  state = addClaim(state, draftClaim("browser-merge-source"), { directSpotId: "surfline-nazare" });
  state.document.spotResearch[1].inheritedApprovals = [
    { claimId: "browser-merge-source", claimDigest: "0".repeat(64) },
    { claimId: "browser-merge-target", claimDigest: "1".repeat(64) }
  ];
  state = mergeClaims(state, "browser-merge-target", "browser-merge-source", { summary: "Browser merged draft." });
  assert.ok(state.document.spotResearch[0].directClaimIds.includes("browser-merge-target"));
  assert.ok(state.document.spotResearch.every((row) => !(row.directClaimIds ?? []).includes("browser-merge-source")));
  assert.ok(state.document.spotResearch.every((row) => !(row.inheritedApprovals ?? []).some((approval) => ["browser-merge-source", "browser-merge-target"].includes(approval.claimId))));
  assert.doesNotThrow(() => compileSpotAdvice(exportFeedback(state).document, context));

  state = rescopeClaim(state, "browser-merge-target", { type: "spot", id: "surfline-baleal" });
  assert.ok(!state.document.spotResearch[0].directClaimIds.includes("browser-merge-target"));
  assert.ok(state.document.spotResearch[1].directClaimIds.includes("browser-merge-target"));
  assert.ok(state.document.spotResearch.every((row) => !(row.inheritedApprovals ?? []).some((approval) => approval.claimId === "browser-merge-target")));
  assert.doesNotThrow(() => compileSpotAdvice(exportFeedback(state).document, context));

  const model = buildSpotAdviceReviewModel({ document: fixtureDocument(), context });
  const html = renderSpotAdviceReviewHtml(model);
  assert.match(html, /import\s*\{[^}]*mergeClaims[^}]*rescopeClaim[^}]*\}\s*from\s*["']\.\.\/scripts\/lib\/spot-advice-review\.js["']/s);
  assert.match(html, /buildDynamicReviewSpots/);
  assert.match(html, /function refreshSpotRows/);
});

test("Save Claim scope changes route through membership-safe editor patch behavior", () => {
  let state = stateFixture();
  state = addClaim(state, draftClaim("browser-scope-save"), { directSpotId: "surfline-nazare" });
  state.document.spotResearch[1].inheritedApprovals = [{ claimId: "browser-scope-save", claimDigest: "0".repeat(64) }];
  state = applyClaimEditorPatch(state, "browser-scope-save", {
    scope: { type: "spot", id: "surfline-baleal" },
    summary: "Scope changed through Save Claim."
  });
  assert.ok(!state.document.spotResearch[0].directClaimIds.includes("browser-scope-save"));
  assert.ok(state.document.spotResearch[1].directClaimIds.includes("browser-scope-save"));
  assert.ok(state.document.spotResearch.every((row) => !(row.inheritedApprovals ?? []).some((approval) => approval.claimId === "browser-scope-save")));
  assert.doesNotThrow(() => compileSpotAdvice(exportFeedback(state).document, fixtureContext()));
  const html = renderSpotAdviceReviewHtml(buildSpotAdviceReviewModel({ document: fixtureDocument(), context: fixtureContext() }));
  assert.match(html, /applyClaimEditorPatch/);
});

function browserValidationContext() {
  return fixtureContext();
}

test("browser validation blocks deleting inference inputs and the last evidence without replacing runtime state", () => {
  const validationContext = browserValidationContext();
  const state = stateFixture();
  const runtime = createReviewRuntime({
    canonicalDocument: state.canonicalDocument,
    baseDigest: state.baseDigest,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    validationContext
  });
  const before = runtime.state().document;
  assert.throws(() => runtime.replaceState(deleteClaim(runtime.state(), "user-caxias-minimum-primary-swell")), /inference|input/i);
  assert.deepEqual(runtime.state().document, before);
  assert.throws(() => runtime.replaceState(deleteEvidence(runtime.state(), "research-nazare-swell", 0)), /evidence/i);
  assert.deepEqual(runtime.state().document, before);
});

test("deep bounded import and stored recovery reject malformed matching-digest documents without changing state", () => {
  const state = stateFixture();
  const validationContext = browserValidationContext();
  const malformed = exportFeedback(state);
  malformed.document.advice[0].scope = null;
  assert.throws(() => importFeedback(state, malformed, { validationContext }), /scope/i);
  assert.deepEqual(state.document, state.canonicalDocument);

  const oversized = JSON.stringify(exportFeedback(state));
  assert.ok(Buffer.byteLength(oversized) < MAX_REVIEW_PAYLOAD_BYTES);
  assert.throws(() => importFeedback(state, oversized, { validationContext, maxBytes: 100 }), /large|size/i);

  const key = state.autosaveKey;
  const storage = { getItem: (candidate) => candidate === key ? JSON.stringify({ ...malformed, editorDrafts: {}, savedAt: null }) : null, setItem() { throw new Error("must not overwrite malformed recovery"); }, removeItem() {} };
  const runtime = createReviewRuntime({ canonicalDocument: state.canonicalDocument, baseDigest: state.baseDigest, storage, validationContext });
  assert.deepEqual(runtime.state().document, state.canonicalDocument);
  assert.equal(runtime.pendingCount(), 0);
});

test("browser validator accepts the canonical document and rejects null scopes", () => {
  const document = fixtureDocument();
  assert.doesNotThrow(() => validateReviewDocument(document, browserValidationContext()));
  document.advice[0].scope = null;
  assert.throws(() => validateReviewDocument(document, browserValidationContext()), /scope/i);
});

test("browser validator rejects stale and geographically inapplicable inherited approvals", () => {
  const stale = fixtureDocument();
  const inherited = stale.spotResearch.find((row) => row.inheritedApprovals?.length);
  inherited.inheritedApprovals[0].claimDigest = "0".repeat(64);
  assert.throws(() => validateReviewDocument(stale, browserValidationContext()), /approval digest/i);

  const inapplicable = fixtureDocument();
  inapplicable.spotResearch[0].inheritedApprovals = [{
    claimId: "user-caparica-high-tide",
    claimDigest: digestClaim(inapplicable.advice.find((claim) => claim.id === "user-caparica-high-tide"))
  }];
  assert.throws(() => validateReviewDocument(inapplicable, browserValidationContext()), /inapplicable|membership/i);
});

test("review validation has exact Task2 parity for strict dates and a mutation corpus", () => {
  const context = fixtureContext();
  const cases = [
    (document) => { document.advice[0].evidence[0].accessedAt = "2026-02-30"; },
    (document) => { document.advice[0].scope = null; },
    (document) => { document.advice[0].confidence = "certain"; },
    (document) => { document.spotResearch[0].checkedSources[0].url = "javascript:bad"; },
    (document) => { document.advice[0].rule = { type: "formula" }; },
    (document) => { document.advice.push(clone(document.advice[0])); }
  ];
  for (const mutate of cases) {
    const document = fixtureDocument(); mutate(document);
    let task2Error; let reviewError;
    try { validateSpotAdvice(document, context); } catch (error) { task2Error = error; }
    try { validateReviewDocument(document, context); } catch (error) { reviewError = error; }
    assert.equal(Boolean(reviewError), Boolean(task2Error));
  }
  const strictDate = fixtureDocument(); strictDate.advice[0].evidence[0].accessedAt = "2026-02-30";
  assert.throws(() => validateReviewDocument(strictDate, context), /valid.*date/i);
});

test("working validation skips only coverage while rejecting an unrelated invalid timestamp", () => {
  const context = fixtureContext();
  const canonical = fixtureDocument();
  const draft = clone(canonical);
  const nazare = draft.advice.find((claim) => claim.id === "research-nazare-swell");
  nazare.publicationStatus = "draft";
  nazare.reviewedAt = null;
  assert.throws(() => validateSpotAdvice(draft, context), /coverage/i);
  assert.doesNotThrow(() => validateSpotAdvice(draft, context, { requirePublishedCoverage: false }));

  const runtime = createReviewRuntime({
    canonicalDocument: canonical,
    baseDigest: digestDocument(canonical),
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    validationContext: context
  });
  runtime.replaceState(updateClaim(runtime.state(), "research-nazare-swell", { summary: "Draft while reviewing." }));
  assert.throws(() => runtime.feedback(), /coverage/i);
  const { canonicalPath } = tempCanonical();
  const beforeApply = fs.readFileSync(canonicalPath, "utf8");
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback: exportFeedback(runtime.state()), context }), /coverage/i);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), beforeApply);
  const before = runtime.state().document;
  assert.throws(() => runtime.replaceState(updateClaim(runtime.state(), "research-baleal-mechanics", { reviewedAt: "invalid" })), /timestamp/i);
  assert.deepEqual(runtime.state().document, before);
});

test("all derived HTML is escaped and unsafe links are omitted while safe links are hardened", () => {
  const document = fixtureDocument();
  document.spotResearch[0].checkedSources.push({
    title: "<script>source()</script>", publisher: "Bad & Co", url: "javascript:alert(1)",
    locationMatch: "exact-spot", decision: "rejected", rationale: "<img src=x onerror=bad()>"
  });
  document.advice[0].evidence.push({
    kind: "provider", title: "<script>evidence()</script>", publisher: "Bad", url: "data:text/html,bad", accessedAt: "2026-07-11",
    supportedClaim: "<b>bad</b>", quality: "provider-record", status: "rejected", locationMatch: "exact-spot"
  });
  const model = buildSpotAdviceReviewModel({ document, context: fixtureContext(), baseDigest: digestDocument(document) });
  const html = renderSpotAdviceReviewHtml(model);
  assert.doesNotMatch(html, /<script>source\(\)<\/script>|<script>evidence\(\)<\/script>|<img src=x onerror/);
  assert.doesNotMatch(html, /href="(?:javascript|data):/i);
  assert.match(html, /href="https:\/\/[^\"]+" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<\/script><script>/i);
});

test("review builder creates a nonempty local cockpit file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-review-build-"));
  const outputPath = path.join(temp, ".local", "spot-advice-review.html");
  const result = buildSpotAdviceReviewFiles({ root: process.cwd(), outputPath });
  assert.equal(result.outputPath, outputPath);
  assert.ok(fs.statSync(outputPath).size > 1_000);
  assert.equal((fs.readFileSync(outputPath, "utf8").match(/data-spot-id=/g) || []).length, 44);
});

test("prepareFeedbackCandidate rejects stale feedback and defensively resets unreviewed material edits", () => {
  const canonical = fixtureDocument();
  const feedback = { schemaVersion: 1, baseDigest: digestDocument(canonical), document: clone(canonical) };
  feedback.document.advice[0].summary += " Edited without a new review timestamp.";
  const candidate = prepareFeedbackCandidate(canonical, feedback);
  assert.equal(candidate.advice[0].publicationStatus, "draft");
  assert.equal(candidate.advice[0].reviewedAt, null);
  assert.equal(candidate.advice[0].calculationCandidate, false);
  feedback.document.advice[0].publicationStatus = "published";
  feedback.document.advice[0].reviewedAt = "2026-07-10T10:00:00.000Z";
  const staleRepublish = prepareFeedbackCandidate(canonical, feedback);
  assert.equal(staleRepublish.advice[0].publicationStatus, "draft");
  assert.equal(staleRepublish.advice[0].reviewedAt, null);
  feedback.document.advice[0].publicationStatus = "published";
  feedback.document.advice[0].reviewedAt = "2026-07-12T10:00:00.000Z";
  const explicitlyRepublished = prepareFeedbackCandidate(canonical, feedback);
  assert.equal(explicitlyRepublished.advice[0].publicationStatus, "published");
  assert.equal(explicitlyRepublished.advice[0].reviewedAt, "2026-07-12T10:00:00.000Z");
  assert.throws(() => prepareFeedbackCandidate(canonical, { ...feedback, baseDigest: "0".repeat(64) }), /stale|digest/i);
});

function feedbackFor(document) {
  const candidate = clone(document);
  candidate.spotResearch[0].editorialNotes = "Atomic feedback accepted.";
  return { schemaVersion: 1, baseDigest: digestDocument(document), document: candidate };
}

function failOnceFs(method) {
  let failed = false;
  return new Proxy(fs, {
    get(target, property) {
      if (property === method) return (...args) => {
        if (!failed) { failed = true; throw new Error(`injected ${method} failure`); }
        return target[property](...args);
      };
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function tempCanonical() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-apply-"));
  const canonicalPath = path.join(dir, "spot-advice.json");
  fs.writeFileSync(canonicalPath, canonicalJson(fixtureDocument()));
  return { dir, canonicalPath };
}

function tempFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.includes(".tmp"));
}

function canonicalLockPath(canonicalPath) {
  return path.join(path.dirname(canonicalPath), `.${path.basename(canonicalPath)}.lock`);
}

function canonicalLockPaths(canonicalPath) {
  const prefix = path.basename(canonicalLockPath(canonicalPath));
  return fs.readdirSync(path.dirname(canonicalPath))
    .filter((name) => name === prefix || name.startsWith(`${prefix}.owner.`))
    .map((name) => path.join(path.dirname(canonicalPath), name));
}

function spawnApplyChild({ canonicalPath, feedbackPath, holdMs = 0 }) {
  const script = `
    import fs from "node:fs";
    import { applyFeedback } from ${JSON.stringify(new URL("../scripts/apply-spot-advice-feedback.js", import.meta.url).href)};
    import { DEFAULT_FAVORITE_IDS } from ${JSON.stringify(new URL("../src/config.js", import.meta.url).href)};
    const read = (name) => JSON.parse(fs.readFileSync(process.env.DATA_ROOT + "/" + name, "utf8"));
    const context = { promotions: read("surfline-promotions.json"), surflineSpots: read("surfline-spots.json"), stretches: read("stretches.json"), promotedDb: read("promoted-spots.json"), enrichmentDb: read("spot-metadata-enrichment.json"), defaultFavoriteIds: DEFAULT_FAVORITE_IDS };
    const feedback = JSON.parse(fs.readFileSync(process.env.FEEDBACK_PATH, "utf8"));
    try {
      applyFeedback({ canonicalPath: process.env.CANONICAL_PATH, feedback, context, afterLock: Number(process.env.HOLD_MS) ? () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.HOLD_MS)) : undefined });
      console.log("applied");
    } catch (error) { console.error(error.message); process.exitCode = 2; }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANONICAL_PATH: canonicalPath, FEEDBACK_PATH: feedbackPath, DATA_ROOT: path.join(process.cwd(), "data"), HOLD_MS: String(holdMs) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, completion };
}

async function waitForOwnedLock(canonicalPath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [ownerPath] = canonicalLockPaths(canonicalPath).filter((candidate) => candidate.includes(".owner."));
    if (ownerPath) return ownerPath;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for owned lock for ${canonicalPath}`);
}

test("atomic feedback rejects stale digest without writing", () => {
  const { dir, canonicalPath } = tempCanonical();
  const before = fs.readFileSync(canonicalPath, "utf8");
  const feedback = feedbackFor(JSON.parse(before));
  feedback.baseDigest = "0".repeat(64);
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() }), /stale|digest/i);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
  assert.deepEqual(tempFiles(dir), []);
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
});

test("pre-existing exclusive apply lock blocks before digest read and preserves canonical", () => {
  const { dir, canonicalPath } = tempCanonical();
  const before = fs.readFileSync(canonicalPath, "utf8");
  const lockPath = canonicalLockPath(canonicalPath);
  fs.writeFileSync(lockPath, "held");
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(JSON.parse(before)), context: fixtureContext() }), /lock|busy|EEXIST/i);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
  assert.deepEqual(tempFiles(dir), []);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "held");
  fs.unlinkSync(lockPath);
});

test("partial metadata from a dead generation is recoverable and removed", () => {
  const { canonicalPath } = tempCanonical();
  const partialPath = `${canonicalLockPath(canonicalPath)}.owner.999999.partial`;
  fs.writeFileSync(partialPath, "");
  assert.doesNotThrow(() => applyFeedbackFile({
    canonicalPath,
    feedback: feedbackFor(readJson(canonicalPath)),
    context: fixtureContext(),
    processIsAlive: (pid) => pid === process.pid
  }));
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
});

test("owner discovery failures clean the exact generation and allow a same-process retry", () => {
  const { canonicalPath } = tempCanonical();
  let failed = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "readdirSync") return (...args) => {
        if (!failed) { failed = true; throw new Error("injected readdirSync failure"); }
        return target.readdirSync(...args);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }), /readdirSync/);
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
  assert.doesNotThrow(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext() }));
});

test("owner discovery cleanup failures remain explicitly reclaimable", () => {
  const { canonicalPath } = tempCanonical();
  let discoveryFailed = false; let cleanupFailed = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "readdirSync") return (...args) => {
        if (!discoveryFailed) { discoveryFailed = true; throw new Error("injected owner discovery failure"); }
        return target.readdirSync(...args);
      };
      if (property === "unlinkSync") return (filePath) => {
        if (filePath.includes(`.owner.${process.pid}.`) && !cleanupFailed) { cleanupFailed = true; throw new Error("injected owner cleanup failure"); }
        return target.unlinkSync(filePath);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let error;
  try { applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }); } catch (caught) { error = caught; }
  assert.match(error?.message ?? "", /acquisition.*cleanup/i);
  assert.equal(error?.reclaimable, true);
  const [ownerPath] = canonicalLockPaths(canonicalPath);
  assert.equal(readJson(ownerPath).state, "releasable");
  assert.doesNotThrow(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext() }));
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
});

test("acquisition cleanup remains retryable when metadata read or marker write also fails", async (t) => {
  for (const mode of ["readFileSync", "writeFileSync"]) {
    await t.test(mode, () => {
      const { canonicalPath } = tempCanonical();
      let discoveryFailed = false; let unlinkFailed = false; let metadataFailure = false;
      const fileSystem = new Proxy(fs, {
        get(target, property) {
          if (property === "readdirSync") return (...args) => {
            if (!discoveryFailed) { discoveryFailed = true; throw new Error("injected discovery failure"); }
            return target.readdirSync(...args);
          };
          if (property === "unlinkSync") return (filePath) => {
            if (filePath.includes(`.owner.${process.pid}.`) && !unlinkFailed) { unlinkFailed = true; throw new Error("injected unlink failure"); }
            return target.unlinkSync(filePath);
          };
          if (property === mode) return (...args) => {
            const ownerPath = typeof args[0] === "string" && args[0].includes(`.owner.${process.pid}.`);
            if (discoveryFailed && ownerPath && !metadataFailure) { metadataFailure = true; throw new Error(`injected ${mode} metadata failure`); }
            return target[property](...args);
          };
          const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
        }
      });
      let error;
      try { applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }); } catch (caught) { error = caught; }
      assert.equal(error?.reclaimable, true);
      assert.doesNotThrow(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext() }));
      assert.deepEqual(canonicalLockPaths(canonicalPath), []);
    });
  }
});

test("acquisition cleanup never marks a replacement token reclaimable", () => {
  const { canonicalPath } = tempCanonical();
  let discoveryFailed = false; let replaced = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "readdirSync") return (...args) => {
        if (!discoveryFailed) { discoveryFailed = true; throw new Error("injected discovery failure"); }
        return target.readdirSync(...args);
      };
      if (property === "unlinkSync") return (filePath) => {
        if (filePath.includes(`.owner.${process.pid}.`) && !replaced) {
          replaced = true;
          target.writeFileSync(filePath, JSON.stringify({ pid: process.pid, token: "replacement-token", createdAt: "2026-07-11T00:00:00.000Z", state: "active" }));
          throw new Error("injected ownership replacement");
        }
        return target.unlinkSync(filePath);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let error;
  try { applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }); } catch (caught) { error = caught; }
  assert.equal(error?.reclaimable, false);
  const [ownerPath] = canonicalLockPaths(canonicalPath);
  assert.equal(readJson(ownerPath).token, "replacement-token");
  fs.unlinkSync(ownerPath);
});

test("unreadable replacement metadata is non-reclaimable and never overwritten or reaped", () => {
  const { canonicalPath } = tempCanonical();
  const replacement = { pid: process.pid, token: "unreadable-replacement", createdAt: "2026-07-11T00:00:00.000Z", state: "active" };
  let discoveryFailed = false; let replaced = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "readdirSync") return (...args) => {
        if (!discoveryFailed) { discoveryFailed = true; throw new Error("injected discovery failure"); }
        return target.readdirSync(...args);
      };
      if (property === "unlinkSync") return (filePath) => {
        if (filePath.includes(`.owner.${process.pid}.`) && !replaced) {
          replaced = true;
          target.writeFileSync(filePath, JSON.stringify(replacement));
          throw new Error("injected ownership replacement");
        }
        return target.unlinkSync(filePath);
      };
      if (property === "readFileSync") return (filePath, ...args) => {
        if (replaced && typeof filePath === "string" && filePath.includes(`.owner.${process.pid}.`)) throw new Error("injected unreadable replacement metadata");
        return target.readFileSync(filePath, ...args);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let error;
  try { applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }); } catch (caught) { error = caught; }
  assert.equal(error?.reclaimable, false);
  const [ownerPath] = canonicalLockPaths(canonicalPath);
  assert.deepEqual(readJson(ownerPath), replacement);
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext() }), /lock.*busy/i);
  assert.deepEqual(readJson(ownerPath), replacement);
  fs.unlinkSync(ownerPath);
});

test("stale-generation reap failures clean the new owner and allow a same-process retry", () => {
  const { canonicalPath } = tempCanonical();
  const stalePath = `${canonicalLockPath(canonicalPath)}.owner.999999.stale`;
  fs.writeFileSync(stalePath, JSON.stringify({ pid: 999999, token: "stale", createdAt: "2026-07-11T00:00:00.000Z", state: "active" }));
  let failed = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "unlinkSync") return (filePath) => {
        if (filePath === stalePath && !failed) { failed = true; throw new Error("injected stale reap failure"); }
        return target.unlinkSync(filePath);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  assert.throws(() => applyFeedbackFile({
    canonicalPath,
    feedback: feedbackFor(readJson(canonicalPath)),
    context: fixtureContext(),
    fileSystem,
    processIsAlive: (pid) => pid === process.pid
  }), /reap|unlink|stale/i);
  assert.equal(canonicalLockPaths(canonicalPath).some((ownerPath) => ownerPath.includes(`.owner.${process.pid}.`)), false);
  assert.doesNotThrow(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), processIsAlive: (pid) => pid === process.pid }));
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
});

test("real overlapping processes enforce ownership, recover a crashed holder, and leave no residue", async () => {
  const { dir, canonicalPath } = tempCanonical();
  const feedbackPath = path.join(dir, "feedback.json");
  fs.writeFileSync(feedbackPath, JSON.stringify(feedbackFor(readJson(canonicalPath))));
  const first = spawnApplyChild({ canonicalPath, feedbackPath, holdMs: 10_000 });
  const lockPath = await waitForOwnedLock(canonicalPath);
  const metadata = readJson(lockPath);
  assert.equal(metadata.pid, first.child.pid);
  assert.match(metadata.token, /^[a-f0-9-]+$/i);
  assert.match(metadata.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(metadata.state, "active");
  const second = spawnApplyChild({ canonicalPath, feedbackPath });
  const busy = await second.completion;
  assert.equal(busy.code, 2);
  assert.match(busy.stderr, /lock.*busy/i);
  first.child.kill("SIGKILL");
  await first.completion;
  const third = spawnApplyChild({ canonicalPath, feedbackPath });
  const recovered = await third.completion;
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
  assert.deepEqual(tempFiles(dir), []);
});

test("committed lock cleanup errors surface and the committed owner state is safely reclaimable", () => {
  const { canonicalPath } = tempCanonical();
  const lockPrefix = canonicalLockPath(canonicalPath);
  let failed = false;
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "unlinkSync") return (filePath) => {
        if (path.basename(filePath).startsWith(path.basename(lockPrefix)) && !failed) { failed = true; throw new Error("injected lock cleanup failure"); }
        return target.unlinkSync(filePath);
      };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let cleanupError;
  try { applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext(), fileSystem }); } catch (error) { cleanupError = error; }
  assert.match(cleanupError?.message ?? "", /committed.*cleanup/i);
  assert.equal(cleanupError?.committed, true);
  const [lockPath] = canonicalLockPaths(canonicalPath);
  assert.equal(readJson(lockPath).state, "committed");
  assert.doesNotThrow(() => applyFeedbackFile({ canonicalPath, feedback: feedbackFor(readJson(canonicalPath)), context: fixtureContext() }));
  assert.deepEqual(canonicalLockPaths(canonicalPath), []);
});

test("atomic feedback catches a concurrent canonical change immediately before rename", () => {
  const { dir, canonicalPath } = tempCanonical();
  const canonical = readJson(canonicalPath);
  const feedback = feedbackFor(canonical);
  let concurrent;
  assert.throws(() => applyFeedbackFile({
    canonicalPath,
    feedback,
    context: fixtureContext(),
    beforeRename() {
      concurrent = clone(canonical);
      concurrent.spotResearch[0].editorialNotes = "Concurrent winner";
      fs.writeFileSync(canonicalPath, canonicalJson(concurrent));
    }
  }), /changed|digest|concurrent/i);
  assert.deepEqual(readJson(canonicalPath), concurrent);
  assert.deepEqual(tempFiles(dir), []);
});

test("write, fsync, close, and rename faults preserve canonical and clean temporary files", async (t) => {
  for (const method of ["writeFileSync", "fsyncSync", "closeSync", "renameSync"]) {
    await t.test(method, () => {
      const { dir, canonicalPath } = tempCanonical();
      const before = fs.readFileSync(canonicalPath, "utf8");
      assert.throws(() => applyFeedbackFile({
        canonicalPath,
        feedback: feedbackFor(JSON.parse(before)),
        context: fixtureContext(),
        fileSystem: failOnceFs(method)
      }), new RegExp(method));
      assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
      assert.deepEqual(tempFiles(dir), []);
    });
  }
});

test("successful atomic apply is exact and the compiler rebuilds the accepted canonical readback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-apply-success-"));
  fs.cpSync("data", path.join(root, "data"), { recursive: true });
  const canonicalPath = path.join(root, "data", "spot-advice.json");
  const canonical = readJson(canonicalPath);
  const feedback = feedbackFor(canonical);
  const result = applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() });
  assert.deepEqual(readJson(canonicalPath), feedback.document);
  assert.equal(result.baseDigest, feedback.baseDigest);
  const build = buildSpotAdviceFiles({ root });
  assert.equal(build.status, 0);
  assert.equal(
    fs.readFileSync(path.join(root, "data", "spot-advice-resolved.json"), "utf8"),
    canonicalJson(compileSpotAdvice(feedback.document, fixtureContext()))
  );
});
