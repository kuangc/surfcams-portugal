import assert from "node:assert/strict";
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
  digestDocument
} from "../scripts/lib/spot-advice-build.js";
import {
  addClaim,
  addEvidence,
  deleteClaim,
  deleteEvidence,
  exportFeedback,
  filterReviewSpots,
  importFeedback,
  initializeWorkingState,
  isSafeExternalUrl,
  mergeClaims,
  pendingCount,
  createReviewRuntime,
  recoverAutosave,
  resetWorkingState,
  rescopeClaim,
  resolveSpotAdvicePreview,
  serializeAutosave,
  setEditorDraft,
  splitClaim,
  updateClaim,
  updateEvidence,
  updateResearchRow
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

test("nonmaterial edits preserve publication state while explicit review can publish a draft", () => {
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
  assert.equal(published.document.advice.find((item) => item.id === claim.id).publicationStatus, "published");
  assert.equal(published.document.advice.find((item) => item.id === claim.id).reviewedAt, reviewedAt);
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
  assert.match(html, /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i);
  assert.match(html, /data-spot-id="surfline-nazare"[\s\S]*?research complete[\s\S]*?direct found/i);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
  const executable = scripts.find((match) => !match[0].includes('type="application/json"'))?.[1];
  assert.ok(executable);
  assert.doesNotThrow(() => new Function(executable.replace(/^\s*import[\s\S]*?;\s*/, "")));
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
  feedback.document.advice[0].reviewedAt = "2026-07-12T10:00:00.000Z";
  const explicitlyRepublished = prepareFeedbackCandidate(canonical, feedback);
  assert.equal(explicitlyRepublished.advice[0].publicationStatus, "draft");
  assert.equal(explicitlyRepublished.advice[0].reviewedAt, null);
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

test("atomic feedback rejects stale digest without writing", () => {
  const { canonicalPath } = tempCanonical();
  const before = fs.readFileSync(canonicalPath, "utf8");
  const feedback = feedbackFor(JSON.parse(before));
  feedback.baseDigest = "0".repeat(64);
  assert.throws(() => applyFeedbackFile({ canonicalPath, feedback, context: fixtureContext() }), /stale|digest/i);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
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
