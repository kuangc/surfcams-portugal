import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import {
  canonicalJson,
  compileSpotAdvice,
  digestClaim,
  digestDocument,
  validateSpotAdvice
} from "../scripts/lib/spot-advice-build.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const clone = (value) => structuredClone(value);

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

function fixtureDocument() {
  return readJson("data/spot-advice.json");
}

function acceptedEvidence(supportedClaim = "Fixture claim") {
  return {
    kind: "user-observed",
    title: "Fixture observation",
    publisher: "Local knowledge",
    url: null,
    accessedAt: "2026-07-11",
    supportedClaim,
    quality: "first-hand",
    status: "accepted"
  };
}

function publishedClaim({
  id,
  scope,
  topic = "wind",
  overrideKey,
  summary = "Fixture advice.",
  rule = { type: "qualitative" },
  consensus = "settled",
  conflictGroupId,
  position
}) {
  return {
    id,
    scope,
    topic,
    overrideKey,
    summary,
    rule,
    evidence: [acceptedEvidence(summary)],
    confidence: "medium",
    publicationStatus: "published",
    consensus,
    calculationCandidate: false,
    reviewedAt: "2026-07-11T00:00:00.000Z",
    revalidateAfter: null,
    ...(conflictGroupId ? { conflictGroupId } : {}),
    ...(position ? { position } : {})
  };
}

function addApproval(document, spotId, claim) {
  const research = document.spotResearch.find((row) => row.spotId === spotId);
  research.inheritedApprovals ||= [];
  research.inheritedApprovals.push({ claimId: claim.id, claimDigest: digestClaim(claim) });
}

test("canonical JSON recursively sorts object keys, preserves arrays, and produces stable SHA-256 digests", () => {
  const left = { z: [{ b: 2, a: 1 }, "last"], a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, z: [{ a: 1, b: 2 }, "last"] };
  assert.equal(canonicalJson(left), `${JSON.stringify({ a: { c: 3, d: 4 }, z: [{ a: 1, b: 2 }, "last"] }, null, 2)}\n`);
  assert.equal(digestDocument(left), digestDocument(right));
  assert.notEqual(digestDocument(left), digestDocument({ ...right, z: [...right.z].reverse() }));
  assert.match(digestClaim(left), /^[a-f0-9]{64}$/);
});

test("spot scope overrides stretch then area by overrideKey while unrelated approved claims remain", () => {
  const document = fixtureDocument();
  const rainhaId = "surfline-praia-da-rainha";
  const area = { id: "caparica-area", name: "Caparica area", spotIds: [rainhaId] };
  document.areas.push(area);
  const areaTide = publishedClaim({
    id: "fixture-area-tide",
    scope: { type: "area", id: area.id },
    topic: "tide",
    overrideKey: "tide.preferred-stage",
    rule: { type: "tide-preference", stage: "low" }
  });
  const stretchWind = publishedClaim({
    id: "fixture-stretch-wind",
    scope: { type: "stretch", id: "caparica" },
    overrideKey: "wind.preferred-direction",
    rule: { type: "direction-preference", input: "wind-direction-deg", arcs: [{ start: 0, end: 90 }] }
  });
  document.advice.push(areaTide, stretchWind);
  addApproval(document, rainhaId, areaTide);
  addApproval(document, rainhaId, stretchWind);

  const subject = compileSpotAdvice(document, fixtureContext()).subjects[rainhaId];
  const tide = subject.claims.filter((claim) => claim.overrideKey === "tide.preferred-stage");
  assert.equal(tide.length, 1);
  assert.deepEqual(tide[0].scope, { type: "spot", id: rainhaId });
  assert.ok(subject.claims.some((claim) => claim.id === stretchWind.id));
  assert.ok(subject.overriddenClaimIds.includes("user-caparica-high-tide"));
  assert.ok(subject.overriddenClaimIds.includes(areaTide.id));
});

test("same-scope collisions fail unless they are one explicit unresolved conflict group", () => {
  const document = fixtureDocument();
  const existing = document.advice.find((claim) => claim.id === "research-praia-da-rainha-tide");
  const alternative = publishedClaim({
    id: "fixture-rainha-low-tide",
    scope: clone(existing.scope),
    topic: "tide",
    overrideKey: existing.overrideKey,
    rule: { type: "tide-preference", stage: "low" }
  });
  document.advice.push(alternative);
  assert.throws(() => validateSpotAdvice(document, fixtureContext()), /same-scope|collision/i);

  existing.consensus = "unresolved";
  existing.conflictGroupId = "rainha-tide-alternatives";
  existing.position = "mid-tide";
  alternative.consensus = "unresolved";
  alternative.conflictGroupId = existing.conflictGroupId;
  alternative.position = "low-tide";
  document.spotResearch.find((row) => row.spotId === existing.scope.id).directClaimIds.push(alternative.id);
  const subject = compileSpotAdvice(document, fixtureContext()).subjects[existing.scope.id];
  assert.equal(subject.conflicts.length, 1);
  assert.deepEqual(subject.conflicts[0].claims.map((claim) => claim.id).sort(), [alternative.id, existing.id].sort());
  assert.ok(subject.claims.some((claim) => claim.id === existing.id));
  assert.ok(subject.claims.some((claim) => claim.id === alternative.id));
  assert.ok(subject.decisiveClaims.every((claim) => claim.conflictGroupId == null));
});

test("runtime excludes drafts, rejected claims and evidence, and editorial research fields", () => {
  const document = fixtureDocument();
  document.spotResearch[0].researchQueries = ["PRIVATE EDITORIAL QUERY"];
  document.spotResearch[0].editorialNotes = "PRIVATE EDITORIAL NOTE";
  const published = document.advice[0];
  published.evidence.push({ ...acceptedEvidence("REJECTED EVIDENCE SECRET"), status: "rejected", rejectionReason: "editorial" });
  const draft = { ...publishedClaim({ id: "fixture-draft", scope: { type: "spot", id: "surfline-nazare" }, overrideKey: "wind.draft" }), publicationStatus: "draft", reviewedAt: null };
  const rejected = { ...publishedClaim({ id: "fixture-rejected", scope: { type: "spot", id: "surfline-nazare" }, overrideKey: "wind.rejected" }), publicationStatus: "rejected" };
  document.advice.push(draft, rejected);

  const output = canonicalJson(compileSpotAdvice(document, fixtureContext()));
  for (const secret of ["PRIVATE EDITORIAL QUERY", "PRIVATE EDITORIAL NOTE", "REJECTED EVIDENCE SECRET", "fixture-draft", "fixture-rejected", "rejectionReason", "calculationCandidate", "publicationStatus", "checkedSources"]) {
    assert.ok(!output.includes(secret), `runtime leaked ${secret}`);
  }
});

test("schema v1 rejects incomplete research, calculation-enabled claims, and stale inherited approval digests", () => {
  const incomplete = fixtureDocument();
  incomplete.spotResearch[0].status = "pending";
  assert.throws(() => validateSpotAdvice(incomplete, fixtureContext()), /research.*complete/i);

  const calculation = fixtureDocument();
  calculation.advice[0].calculationCandidate = true;
  assert.throws(() => validateSpotAdvice(calculation, fixtureContext()), /calculation/i);

  const stale = fixtureDocument();
  const inherited = stale.spotResearch.find((row) => row.inheritedApprovals?.length);
  inherited.inheritedApprovals[0].claimDigest = "0".repeat(64);
  assert.throws(() => validateSpotAdvice(stale, fixtureContext()), /approval digest/i);
});

test("decision coverage is checked after a higher-precedence override is resolved", () => {
  const document = fixtureDocument();
  const spotId = "surfline-praia-da-laje";
  const research = document.spotResearch.find((row) => row.spotId === spotId);
  const inherited = document.advice.find((claim) => claim.id === "linha-stretch-sheltered-size-translation");
  const nonDecisionOverride = publishedClaim({
    id: "fixture-laje-season-override",
    scope: { type: "spot", id: spotId },
    topic: "season",
    overrideKey: inherited.overrideKey,
    summary: "A seasonal note cannot satisfy decision coverage."
  });
  document.advice.push(nonDecisionOverride);
  research.status = "complete";
  research.directEvidenceOutcome = "found";
  research.directClaimIds.push(nonDecisionOverride.id);
  assert.throws(() => validateSpotAdvice(document, fixtureContext()), /decision-effective coverage/i);
});

test("validation rejects unknown ids, enums, units, memberships, and duplicates", async (t) => {
  const cases = [
    ["unknown scope spot", (d) => { d.advice[0].scope.id = "surfline-not-selected"; }, /unknown.*spot/i],
    ["unknown topic", (d) => { d.advice[0].topic = "moon-phase"; }, /topic/i],
    ["unknown rule input/unit", (d) => { d.advice[0].rule = { type: "minimum", input: "primary-swell-height-ft", value: 2, comparison: "greater-than-or-equal", effectBelow: "likely-flat" }; }, /rule.*input|unit/i],
    ["unknown rule type", (d) => { d.advice[0].rule = { type: "formula" }; }, /rule.*type/i],
    ["duplicate advice id", (d) => { d.advice.push(clone(d.advice[0])); }, /duplicate advice/i],
    ["duplicate research id", (d) => { d.spotResearch[1].spotId = d.spotResearch[0].spotId; }, /research.*identity|duplicate research/i],
    ["multiple area memberships", (d) => { d.areas[1].spotIds.push(d.areas[0].spotIds[0]); }, /multiple area/i],
    ["unknown area member", (d) => { d.areas[0].spotIds.push("surfline-not-selected"); }, /area.*unknown/i]
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const document = fixtureDocument();
      mutate(document);
      assert.throws(() => validateSpotAdvice(document, fixtureContext()), pattern);
    });
  }
  await t.test("multiple stretch memberships", () => {
    const context = fixtureContext();
    context.stretches.stretches[1].surflineSpotIds.push(context.stretches.stretches[0].surflineSpotIds[0]);
    assert.throws(() => validateSpotAdvice(fixtureDocument(), context), /multiple stretch/i);
  });
});

test("validation checks source and evidence fields, URL safety, source quality, and time-sensitive expiry", async (t) => {
  const cases = [
    ["missing checked-source field", (d) => { delete d.spotResearch[0].checkedSources[0].rationale; }, /checked source.*rationale/i],
    ["unsafe checked-source URL", (d) => { d.spotResearch[0].checkedSources[0].url = "javascript:alert(1)"; }, /safe.*url/i],
    ["unsafe evidence URL", (d) => { d.advice[0].evidence[0].url = "file:\/\/private"; }, /safe.*url/i],
    ["weak source alone", (d) => { d.advice[0].evidence[0].quality = "general-beach-directory"; }, /source quality/i],
    ["missing time-sensitive expiry", (d) => { const claim = d.advice.find((row) => /shifting (peaks|banks)|sandbanks/i.test(row.summary)); claim.revalidateAfter = null; }, /revalidateAfter|expiry/i],
    ["expired time-sensitive claim", (d) => { const claim = d.advice.find((row) => row.revalidateAfter); claim.revalidateAfter = "2026-01-01"; }, /expired|revalidateAfter/i]
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const document = fixtureDocument();
      mutate(document);
      assert.throws(() => validateSpotAdvice(document, fixtureContext()), pattern);
    });
  }
});

test("source digest and compiled bytes are deterministic and sensitive to canonical source changes", () => {
  const document = fixtureDocument();
  const first = compileSpotAdvice(document, fixtureContext());
  const second = compileSpotAdvice(clone(document), fixtureContext());
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.sourceDigest, digestDocument(document));
  const changed = clone(document);
  changed.advice[0].summary += " Material change.";
  assert.notEqual(compileSpotAdvice(changed, fixtureContext()).sourceDigest, first.sourceDigest);
  assert.ok(!Object.hasOwn(first, "generatedAt"));
});

test("identity report covers exactly 44 selected ids, defaults, trusted advice cameras, and deferred guide-only spots", () => {
  const context = fixtureContext();
  const compiled = compileSpotAdvice(fixtureDocument(), context);
  const selected = context.promotions.promoted.map((row) => row.surflineSpotId);
  const expectedCameras = context.enrichmentDb.entries
    .filter((entry) => !["needs-review", "rejected"].includes(entry.surfMetadata?.reviewStatus))
    .filter((entry) => selected.includes(entry.surfMetadata?.conditionsSourceSpotId))
    .map((entry) => entry.id)
    .sort();
  assert.equal(compiled.identityReport.selectedSurflineIds.length, 44);
  assert.deepEqual(compiled.identityReport.selectedSurflineIds, selected);
  assert.deepEqual(compiled.identityReport.defaultFavoriteIds, DEFAULT_FAVORITE_IDS);
  assert.deepEqual(compiled.identityReport.adviceBearingCameraIds, expectedCameras);
  assert.ok(DEFAULT_FAVORITE_IDS.every((id) => compiled.identityReport.byCameraId[id]));
  assert.equal(compiled.subjects["surfline-cave"].guideOnly, true);
  assert.equal(compiled.subjects["surfline-praia-da-ursa"].guideOnly, true);
  assert.equal(compiled.subjects["surfline-nazare"].guideOnly, false);
});

test("identity validation rejects mismatched and untrusted conditions attachments", () => {
  const mismatch = fixtureContext();
  const favorite = mismatch.enrichmentDb.entries.find((entry) => entry.id === "sao-pedro-do-estoril");
  favorite.surfMetadata.conditionsSourceSpotId = "surfline-not-a-real-spot";
  assert.throws(() => compileSpotAdvice(fixtureDocument(), mismatch), /identity.*conditionsSourceSpotId/i);

  const untrusted = fixtureContext();
  const untrustedFavorite = untrusted.enrichmentDb.entries.find((entry) => entry.id === "sao-pedro-do-estoril");
  untrustedFavorite.surfMetadata.reviewStatus = "needs-review";
  assert.throws(() => compileSpotAdvice(fixtureDocument(), untrusted), /default favorite.*trusted advice identity/i);
});

test("file CLI is wired to deterministic build and freshness package commands", () => {
  const packageJson = readJson("package.json");
  assert.equal(packageJson.scripts["build-spot-advice"], "node scripts/build-spot-advice.js");
  assert.equal(packageJson.scripts["check-spot-advice"], "node scripts/build-spot-advice.js --check");
  const result = spawnSync(process.execPath, ["scripts/build-spot-advice.js", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
