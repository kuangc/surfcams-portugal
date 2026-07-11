import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import * as spotAdviceCli from "../scripts/build-spot-advice.js";
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

test("a checked-source URL cannot be both accepted and rejected for one research row", () => {
  const document = fixtureDocument();
  const source = document.spotResearch[0].checkedSources[0];
  document.spotResearch[0].checkedSources.push({
    ...clone(source),
    decision: source.decision === "accepted" ? "rejected" : "accepted",
    rationale: "Contradictory fixture decision."
  });
  assert.throws(() => validateSpotAdvice(document, fixtureContext()), /checked source URL.*conflicting decisions/i);

  const consistent = fixtureDocument();
  consistent.spotResearch[0].checkedSources.push({
    ...clone(consistent.spotResearch[0].checkedSources[0]),
    rationale: "A consistent duplicate audit entry."
  });
  assert.doesNotThrow(() => validateSpotAdvice(consistent, fixtureContext()));
});

test("selected Surfline DTO metadata rejects missing, nonfinite, out-of-bounds, and unsafe values", async (t) => {
  const cases = [
    ["missing name", "surfline-cave", (spot) => { spot.name = ""; }, /catalog.*name/i],
    ["nonfinite latitude", "surfline-cave", (spot) => { spot.lat = Number.NaN; }, /catalog.*latitude/i],
    ["latitude above 90", "surfline-cave", (spot) => { spot.lat = 90.01; }, /catalog.*latitude/i],
    ["nonfinite longitude", "surfline-praia-da-ursa", (spot) => { spot.lon = Number.POSITIVE_INFINITY; }, /catalog.*longitude/i],
    ["longitude below -180", "surfline-praia-da-ursa", (spot) => { spot.lon = -180.01; }, /catalog.*longitude/i],
    ["javascript URL", "surfline-cave", (spot) => { spot.url = "javascript:alert(1)"; }, /catalog.*safe.*URL/i],
    ["malformed URL", "surfline-praia-da-ursa", (spot) => { spot.url = "not a URL"; }, /catalog.*safe.*URL/i]
  ];
  for (const [name, id, mutate, pattern] of cases) {
    await t.test(name, () => {
      const context = fixtureContext();
      mutate(context.surflineSpots.spots.find((spot) => spot.id === id));
      assert.throws(() => validateSpotAdvice(fixtureDocument(), context), pattern);
    });
  }
});

test("calendar dates and reviewed timestamps require strict valid UTC round trips", async (t) => {
  const cases = [
    ["February 30 document date", (document) => { document.updatedAt = "2026-02-30"; }, /updatedAt.*YYYY-MM-DD/i],
    ["February 30 evidence date", (document) => { document.advice[0].evidence[0].accessedAt = "2026-02-30"; }, /accessedAt.*YYYY-MM-DD/i],
    ["date-only reviewed timestamp", (document) => { document.advice[0].reviewedAt = "2026-07-11"; }, /reviewedAt.*UTC/i],
    ["offset reviewed timestamp", (document) => { document.advice[0].reviewedAt = "2026-07-11T00:00:00+00:00"; }, /reviewedAt.*UTC/i],
    ["February 30 reviewed timestamp", (document) => { document.advice[0].reviewedAt = "2026-02-30T00:00:00.000Z"; }, /reviewedAt.*UTC/i],
    ["research timestamp without milliseconds", (document) => { document.spotResearch[0].reviewedAt = "2026-07-11T00:00:00Z"; }, /research.*reviewedAt.*UTC/i]
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

test("deferred Cave and Ursa subjects copy exact normalized Surfline guide metadata", () => {
  const compiled = compileSpotAdvice(fixtureDocument(), fixtureContext());
  assert.deepEqual(
    {
      name: compiled.subjects["surfline-cave"].name,
      lat: compiled.subjects["surfline-cave"].lat,
      lon: compiled.subjects["surfline-cave"].lon,
      region: compiled.subjects["surfline-cave"].region,
      surfline: compiled.subjects["surfline-cave"].surfline
    },
    {
      name: "Cave",
      lat: 38.99663,
      lon: -9.42693,
      region: "Ericeira",
      surfline: { pageUrl: "https://www.surfline.com/surf-report/cave/5d702a08b8be350001890108" }
    }
  );
  assert.deepEqual(
    {
      name: compiled.subjects["surfline-praia-da-ursa"].name,
      lat: compiled.subjects["surfline-praia-da-ursa"].lat,
      lon: compiled.subjects["surfline-praia-da-ursa"].lon,
      region: compiled.subjects["surfline-praia-da-ursa"].region,
      surfline: compiled.subjects["surfline-praia-da-ursa"].surfline
    },
    {
      name: "Praia da Ursa",
      lat: 38.79081,
      lon: -9.49342,
      region: "Cape Roca",
      surfline: { pageUrl: "https://www.surfline.com/surf-report/praia-da-ursa/640b9d174519050958e08490" }
    }
  );
});

test("promoted runtime ids form one exact, catalog-backed partition of the selected roster", async (t) => {
  const cases = [
    ["unknown promoted id", (context) => { context.promotedDb.promoted[0].id = "surfline-unknown"; }, /promotedDb.*unknown.*catalog/i],
    ["unknown deferred id", (context) => { context.promotedDb.deferred[0].surflineSpotId = "surfline-unknown"; }, /promotedDb.*unknown.*catalog/i],
    ["duplicate promoted id", (context) => { context.promotedDb.promoted[1].id = context.promotedDb.promoted[0].id; }, /duplicate promotedDb promoted/i],
    ["duplicate deferred id", (context) => { context.promotedDb.deferred.push(clone(context.promotedDb.deferred[0])); }, /duplicate promotedDb deferred/i],
    ["promoted/deferred overlap", (context) => { context.promotedDb.deferred.push({ surflineSpotId: context.promotedDb.promoted[0].id, reason: "fixture" }); }, /promotedDb.*overlap/i],
    ["missing Cave", (context) => { context.promotedDb.deferred = context.promotedDb.deferred.filter((row) => row.surflineSpotId !== "surfline-cave"); }, /partition.*surfline-cave/i],
    ["missing Ursa", (context) => { context.promotedDb.deferred = context.promotedDb.deferred.filter((row) => row.surflineSpotId !== "surfline-praia-da-ursa"); }, /partition.*surfline-praia-da-ursa/i],
    ["wrong total", (context) => { context.promotedDb.total -= 1; }, /promotedDb total/i]
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const context = fixtureContext();
      mutate(context);
      assert.throws(() => validateSpotAdvice(fixtureDocument(), context), pattern);
    });
  }
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

test("stale check leaves existing artifact bytes unchanged and exits nonzero", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-check-"));
  const outputPath = path.join(directory, "spot-advice-resolved.json");
  const stale = "{\"stale\":true}\n";
  fs.writeFileSync(outputPath, stale);
  let writeCount = 0;
  const fileSystem = {
    ...fs,
    writeFileSync(...args) {
      writeCount += 1;
      return fs.writeFileSync(...args);
    }
  };
  try {
    const result = spotAdviceCli.syncCompiledArtifact({ outputPath, expected: "{\"fresh\":true}\n", check: true, fileSystem });
    assert.deepEqual(result, { status: 1, changed: false });
    assert.equal(writeCount, 0);
    assert.equal(fs.readFileSync(outputPath, "utf8"), stale);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unchanged normal build avoids rewriting artifact bytes or mtime", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-build-"));
  const outputPath = path.join(directory, "spot-advice-resolved.json");
  const expected = "{\"fresh\":true}\n";
  fs.writeFileSync(outputPath, expected);
  const before = fs.statSync(outputPath).mtimeMs;
  let writeCount = 0;
  const fileSystem = {
    ...fs,
    writeFileSync(...args) {
      writeCount += 1;
      return fs.writeFileSync(...args);
    }
  };
  try {
    const result = spotAdviceCli.syncCompiledArtifact({ outputPath, expected, check: false, fileSystem });
    assert.deepEqual(result, { status: 0, changed: false });
    assert.equal(writeCount, 0);
    assert.equal(fs.readFileSync(outputPath, "utf8"), expected);
    assert.equal(fs.statSync(outputPath).mtimeMs, before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("changed normal build fsyncs a same-directory temp file before atomic rename", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-atomic-"));
  const outputPath = path.join(directory, "spot-advice-resolved.json");
  const temporaryPath = path.join(directory, ".spot-advice-resolved.fixture.tmp");
  fs.writeFileSync(outputPath, "stale\n");
  const calls = [];
  const fileSystem = {
    ...fs,
    openSync(...args) { calls.push(["open", ...args]); return fs.openSync(...args); },
    writeFileSync(...args) { calls.push(["write", args[0]]); return fs.writeFileSync(...args); },
    fsyncSync(...args) { calls.push(["fsync", ...args]); return fs.fsyncSync(...args); },
    closeSync(...args) { calls.push(["close", ...args]); return fs.closeSync(...args); },
    renameSync(...args) { calls.push(["rename", ...args]); return fs.renameSync(...args); }
  };
  try {
    const result = spotAdviceCli.syncCompiledArtifact({
      outputPath,
      expected: "fresh\n",
      fileSystem,
      temporaryPathFactory: () => temporaryPath
    });
    assert.deepEqual(result, { status: 0, changed: true });
    assert.equal(fs.readFileSync(outputPath, "utf8"), "fresh\n");
    assert.ok(!fs.existsSync(temporaryPath));
    assert.deepEqual(calls.map(([operation]) => operation), ["open", "write", "fsync", "close", "rename"]);
    assert.equal(calls[0][1], temporaryPath);
    assert.deepEqual(calls.at(-1).slice(1), [temporaryPath, outputPath]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic build failure preserves the old artifact and removes the temp file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spot-advice-atomic-failure-"));
  const outputPath = path.join(directory, "spot-advice-resolved.json");
  const temporaryPath = path.join(directory, ".spot-advice-resolved.fixture.tmp");
  fs.writeFileSync(outputPath, "old\n");
  const fileSystem = {
    ...fs,
    renameSync() { throw new Error("simulated rename failure"); }
  };
  try {
    assert.throws(() => spotAdviceCli.syncCompiledArtifact({
      outputPath,
      expected: "new\n",
      fileSystem,
      temporaryPathFactory: () => temporaryPath
    }), /simulated rename failure/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "old\n");
    assert.ok(!fs.existsSync(temporaryPath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
