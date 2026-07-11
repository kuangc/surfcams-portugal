import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  adviceConditionSnapshot,
  adviceSubjectIdFor,
  evaluateAdviceRule,
  findAdviceTideSnapshot,
  formatSpotPlaybook,
  normalizeSpotAdviceRuntime,
  resolveAdviceTideCameraId,
  selectLocalLens,
  tidePhase
} from "../src/spot-advice.js";
import { normalizeTideCache } from "../src/tide-data.js";

const NOW = Date.parse("2026-07-12T12:00:00Z");
const runtimePayload = JSON.parse(fs.readFileSync("data/spot-advice-resolved.json", "utf8"));
const advice = normalizeSpotAdviceRuntime(runtimePayload);

function spotData(overrides = {}) {
  return {
    advice,
    promotedById: new Map([
      ["surfline-sao-juliao", { id: "surfline-sao-juliao", linkedCamId: "sao-juliao" }],
      ["surfline-costa-da-caparica", { id: "surfline-costa-da-caparica", linkedCamId: "costa-da-caparica-cds" }]
    ]),
    ...overrides
  };
}

function freshSnapshot(values = {}) {
  return {
    sourceSpotId: "surfline-fixture",
    fetchedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    ageHours: 1,
    providerSpotSurfMinM: 0.6,
    providerSpotSurfMaxM: 3,
    primarySwellHeightM: 1.7,
    primarySwellPeriodS: 12,
    primarySwellDirectionDeg: 280,
    windKmh: 10,
    windDirectionDeg: 30,
    tide: null,
    ...values
  };
}

function minimumClaim(value = 2, rule = {}) {
  return {
    id: "minimum",
    topic: "size-translation",
    consensus: "settled",
    revalidateAfter: null,
    rule: {
      type: "minimum",
      input: "primary-swell-height-m",
      value,
      comparison: "greater-than-or-equal",
      effectBelow: "likely-flat",
      ...rule
    }
  };
}

function rawTideCache({ generatedAt = "2026-07-12T10:00:00Z", cameraId = "sao-juliao" } = {}) {
  return {
    generatedAt,
    source: { timeZone: "Europe/Lisbon" },
    cameraStations: {
      [cameraId]: { portId: "15", portName: "Cascais", gaugeLat: 38.69, gaugeLon: -9.42 }
    },
    eventsByPort: {
      15: [
        { type: "low", timeUtc: "2026-07-12T10:00:00Z", heightM: 0.5 },
        { type: "high", timeUtc: "2026-07-12T20:00:00Z", heightM: 3.1 }
      ]
    },
    daylightByPort: {
      15: {
        "2026-07-12": { firstLightUtc: "2026-07-12T05:00:00Z", lastLightUtc: "2026-07-12T20:30:00Z" }
      }
    }
  };
}

test("normalization makes copy-safe immutable maps and retains the identity report", () => {
  const payload = structuredClone(runtimePayload);
  const normalized = normalizeSpotAdviceRuntime(payload);
  const caxias = normalized.subjectsById.get("surfline-praia-de-caxias");

  payload.subjects["surfline-praia-de-caxias"].name = "changed";
  assert.equal(caxias.name, "Praia de Caxias");
  assert.equal(Object.isFrozen(caxias), true);
  assert.equal(normalized.identityByCameraId.get("praia-sesimbra"), "surfline-sesimbra");
  assert.equal(normalized.identityReport.selectedSurflineIds.length, 44);
  assert.equal(normalized.identityReport.adviceBearingCameraIds.length, 53);
  assert.equal(normalized.subjectsById.get("surfline-cave").guideOnly, true);
  assert.equal(normalized.subjectsById.get("surfline-praia-da-ursa").guideOnly, true);
  assert.throws(() => normalized.subjectsById.set("x", {}), /read-only/i);
});

test("subject identity accepts selected self and trusted conditions identity only", () => {
  assert.equal(adviceSubjectIdFor({ id: "surfline-sao-juliao", promoted: true }, spotData()), "surfline-sao-juliao");
  assert.equal(adviceSubjectIdFor({ id: "sao-juliao" }, spotData()), "surfline-sao-juliao");
  assert.equal(adviceSubjectIdFor({ id: "surfline-cave", guideOnly: true }, spotData()), "surfline-cave");
  assert.equal(adviceSubjectIdFor({ id: "ambiguous-stretch-cam" }, spotData()), null);
  assert.equal(adviceSubjectIdFor({ id: "made-up", promoted: true }, spotData()), null);
});

test("trusted tide camera resolves direct, linked, and explicit stretch identities", () => {
  const direct = advice.subjectsById.get("surfline-sao-juliao");
  const linked = advice.subjectsById.get("surfline-sao-juliao");
  const stretch = advice.subjectsById.get("surfline-praia-da-rainha");
  const guide = advice.subjectsById.get("surfline-cave");

  assert.equal(resolveAdviceTideCameraId({ id: "sao-juliao" }, direct, spotData()), "sao-juliao");
  assert.equal(resolveAdviceTideCameraId({ id: "surfline-sao-juliao", promoted: true }, linked, spotData()), "sao-juliao");
  assert.equal(resolveAdviceTideCameraId({ id: "surfline-praia-da-rainha", promoted: true }, stretch, spotData({ promotedById: new Map() })), "costa-da-caparica-riviera");
  assert.equal(resolveAdviceTideCameraId({ id: "surfline-cave", guideOnly: true }, guide, spotData()), null);
  assert.equal(resolveAdviceTideCameraId({ id: "untrusted" }, direct, spotData()), null);
});

test("advice tide lookup happens only after trusted identity and rejects stale cache", () => {
  const trusted = findAdviceTideSnapshot({ id: "sao-juliao" }, spotData(), rawTideCache(), new Date(NOW));
  assert.equal(trusted.station.portName, "Cascais");
  assert.deepEqual(trusted.phase, { stage: "mid", direction: "rising", progress: 0.2 });

  assert.equal(findAdviceTideSnapshot({ id: "untrusted" }, spotData(), rawTideCache(), new Date(NOW)), null);
  assert.equal(findAdviceTideSnapshot(
    { id: "sao-juliao" },
    spotData(),
    rawTideCache({ generatedAt: "2026-07-10T11:59:59Z" }),
    new Date(NOW)
  ), null);
});

test("advice tide snapshots do not expose mutable aliases into normalized tide data", () => {
  const normalizedTideData = normalizeTideCache({
    ...rawTideCache(),
    cameraStations: {
      "sao-juliao": {
        portId: "15",
        portName: "Cascais",
        gaugeLat: 38.69,
        gaugeLon: -9.42,
        metadata: { aliases: ["Cascais gauge"], owner: { name: "IH" } }
      }
    }
  });
  const before = structuredClone(normalizedTideData);
  const snapshot = findAdviceTideSnapshot(
    { id: "sao-juliao" },
    spotData(),
    normalizedTideData,
    new Date(NOW)
  );

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.events), true);
  assert.equal(Object.isFrozen(snapshot.events[0]), true);
  assert.equal(Object.isFrozen(snapshot.station), true);
  assert.equal(Object.isFrozen(snapshot.station.metadata.aliases), true);
  assert.equal(Object.isFrozen(snapshot.station.metadata.owner), true);

  assert.throws(() => snapshot.events.push({ type: "high", timeUtc: "2026-07-12T22:00:00Z" }), TypeError);
  assert.throws(() => { snapshot.events[0].heightM = 9; }, TypeError);
  assert.throws(() => { snapshot.station.portName = "Mutated"; }, TypeError);
  assert.throws(() => snapshot.station.metadata.aliases.push("mutated"), TypeError);
  assert.throws(() => { snapshot.station.metadata.owner.name = "Mutated"; }, TypeError);

  assert.deepEqual(normalizedTideData, before);
});

test("condition snapshot separates provider surf and primary swell without mutating rating", () => {
  const resolved = {
    source: "surfline-fresh",
    sourceSpotId: "surfline-x",
    fetchedAt: "2026-07-12T11:00:00Z",
    ageHours: 1,
    providerSpotSurfMinM: 0.8,
    providerSpotSurfMaxM: 1.4,
    primarySwellHeightM: 2.1,
    primarySwellPeriodS: 13,
    primarySwellDirectionDeg: 285,
    windKmh: 9,
    windDirDeg: 45,
    rating: "GOOD"
  };
  const snapshot = adviceConditionSnapshot(resolved);

  assert.deepEqual(snapshot, {
    sourceSpotId: "surfline-x",
    fetchedAt: "2026-07-12T11:00:00Z",
    ageHours: 1,
    providerSpotSurfMinM: 0.8,
    providerSpotSurfMaxM: 1.4,
    primarySwellHeightM: 2.1,
    primarySwellPeriodS: 13,
    primarySwellDirectionDeg: 285,
    windKmh: 9,
    windDirectionDeg: 45,
    tide: null
  });
  assert.equal(resolved.rating, "GOOD");
  assert.equal("rating" in snapshot, false);
  assert.equal("windDirDeg" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("tide phase uses 20/60/20 bands, retains direction, and requires brackets", () => {
  const events = [
    { type: "low", timeUtc: "2026-07-12T00:00:00Z" },
    { type: "high", timeUtc: "2026-07-12T10:00:00Z" }
  ];

  assert.deepEqual(tidePhase(events, new Date("2026-07-12T00:30:00Z")), { stage: "low", direction: "rising", progress: 0.05 });
  assert.deepEqual(tidePhase(events, new Date("2026-07-12T05:00:00Z")), { stage: "mid", direction: "rising", progress: 0.5 });
  assert.deepEqual(tidePhase(events, new Date("2026-07-12T09:00:00Z")), { stage: "high", direction: "rising", progress: 0.9 });
  assert.equal(tidePhase(events.slice(0, 1), new Date("2026-07-12T05:00:00Z")), null);
  assert.equal(tidePhase(events, new Date("2026-07-11T23:00:00Z")), null);
});

test("minimum uses fresh primary swell height, inclusive threshold, and exact effects", () => {
  const belowOnly = minimumClaim(2);
  const both = minimumClaim(1.5, { effectAtOrAbove: "may-start-working" });

  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ primarySwellHeightM: 1.7, providerSpotSurfMaxM: 3 }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ primarySwellHeightM: 2 }), NOW), "not-triggered");
  assert.equal(evaluateAdviceRule(both, freshSnapshot({ primarySwellHeightM: 1.5 }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ primarySwellHeightM: null }), NOW), "unknown");
  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ ageHours: 36 }), NOW), "unknown");
  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ ageHours: -1 }), NOW), "unknown");
  assert.equal(evaluateAdviceRule(belowOnly, freshSnapshot({ fetchedAt: "2026-07-12T13:00:00Z", ageHours: 1 }), NOW), "unknown");
});

test("direction rules support inclusive wrap arcs and tide direction preferences", () => {
  const wrap = {
    id: "wrap", consensus: "settled", revalidateAfter: null,
    rule: { type: "direction-preference", input: "wind-direction-deg", arcs: [{ start: 315, end: 45 }] }
  };
  const tide = {
    id: "tide", consensus: "settled", revalidateAfter: null,
    rule: { type: "tide-preference", stage: "mid", direction: "falling" }
  };

  assert.equal(evaluateAdviceRule(wrap, freshSnapshot({ windDirectionDeg: 315 }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(wrap, freshSnapshot({ windDirectionDeg: 0 }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(wrap, freshSnapshot({ windDirectionDeg: 45 }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(wrap, freshSnapshot({ windDirectionDeg: 180 }), NOW), "not-triggered");
  assert.equal(evaluateAdviceRule(tide, freshSnapshot({ tide: { stage: "mid", direction: "falling" } }), NOW), "triggered");
  assert.equal(evaluateAdviceRule(tide, freshSnapshot({ tide: { stage: "mid", direction: "rising" } }), NOW), "not-triggered");
});

test("expired and unresolved claims never evaluate decisively", () => {
  assert.equal(evaluateAdviceRule({ ...minimumClaim(), revalidateAfter: "2026-07-11" }, freshSnapshot(), NOW), "unknown");
  assert.equal(evaluateAdviceRule({ ...minimumClaim(), consensus: "unresolved", conflictGroupId: "x" }, freshSnapshot(), NOW), "unknown");
});

test("Local lens preserves the five seeded behaviors and suppresses Supertubos conflict", () => {
  const sd = spotData();
  const lowSwell = freshSnapshot({ primarySwellHeightM: 1.7 });
  const torreWorking = freshSnapshot({ primarySwellHeightM: 1.5 });
  const currentHigh = { phase: { stage: "high", direction: "rising", progress: 0.9 }, events: [] };
  const currentMid = { phase: { stage: "mid", direction: "rising", progress: 0.5 }, events: [] };

  assert.match(selectLocalLens({ id: "praia-sesimbra" }, sd, lowSwell, null, NOW).text, /likely flat/i);
  assert.match(selectLocalLens({ id: "surfline-praia-de-caxias", promoted: true }, sd, lowSwell, null, NOW).text, /likely flat/i);
  assert.match(selectLocalLens({ id: "praia-da-torre" }, sd, torreWorking, null, NOW).text, /may start working/i);
  assert.match(selectLocalLens({ id: "surfline-costa-da-caparica", promoted: true }, sd, freshSnapshot(), currentHigh, NOW).text, /high tide/i);
  assert.match(selectLocalLens({ id: "sao-juliao" }, sd, freshSnapshot(), currentMid, NOW).text, /mid tide/i);
  assert.equal(selectLocalLens({ id: "surfline-supertubos", promoted: true }, sd, freshSnapshot(), null, NOW), null);
});

test("Local lens ranking is deterministic by topic, scope, confidence, review time, and id", () => {
  const subject = {
    id: "surfline-ranked",
    claims: [
      { id: "z", topic: "mechanics", scope: { type: "spot", id: "surfline-ranked" }, confidence: "high", reviewedAt: "2026-07-12T00:00:00Z", consensus: "settled", summary: "Spot mechanic.", rule: { type: "qualitative" } },
      { id: "b", topic: "swell", scope: { type: "spot", id: "surfline-ranked" }, confidence: "medium", reviewedAt: "2026-07-11T00:00:00Z", consensus: "settled", summary: "Second.", rule: { type: "direction-preference", input: "primary-swell-direction-deg", arcs: [{ start: 270, end: 300 }] } },
      { id: "a", topic: "swell", scope: { type: "spot", id: "surfline-ranked" }, confidence: "medium", reviewedAt: "2026-07-11T00:00:00Z", consensus: "settled", summary: "First.", rule: { type: "direction-preference", input: "primary-swell-direction-deg", arcs: [{ start: 270, end: 300 }] } }
    ],
    decisiveClaims: []
  };
  subject.decisiveClaims = subject.claims;
  const customAdvice = normalizeSpotAdviceRuntime({
    schemaVersion: 1,
    sourceDigest: "fixture",
    subjects: { [subject.id]: subject },
    identityReport: { selectedSurflineIds: [subject.id], defaultFavoriteIds: [], adviceBearingCameraIds: [], byCameraId: { [subject.id]: subject.id } }
  });
  const lens = selectLocalLens({ id: subject.id, promoted: true }, spotData({ advice: customAdvice }), freshSnapshot({ primarySwellDirectionDeg: 280 }), null, NOW);

  assert.equal(lens.claimId, "a");
  assert.equal(lens.text, "First.");
});

test("tide lens suppresses targets beyond six hours and formats Lisbon DST plus after-dark", () => {
  const tideSubject = {
    id: "surfline-tide",
    claims: [{
      id: "mid", topic: "tide", scope: { type: "spot", id: "surfline-tide" }, confidence: "high",
      reviewedAt: "2026-07-11T00:00:00Z", consensus: "settled", summary: "Mid tide sweet spot.",
      rule: { type: "tide-preference", stage: "mid" }
    }]
  };
  tideSubject.decisiveClaims = tideSubject.claims;
  const customAdvice = normalizeSpotAdviceRuntime({
    schemaVersion: 1, sourceDigest: "fixture", subjects: { [tideSubject.id]: tideSubject },
    identityReport: { selectedSurflineIds: [tideSubject.id], defaultFavoriteIds: [], adviceBearingCameraIds: [], byCameraId: { [tideSubject.id]: tideSubject.id } }
  });
  const sd = spotData({ advice: customAdvice });
  const camera = { id: tideSubject.id, promoted: true };
  const winter = {
    phase: { stage: "low", direction: "rising", progress: 0.05 },
    events: [
      { type: "low", timeUtc: "2026-01-15T08:00:00Z" },
      { type: "high", timeUtc: "2026-01-15T12:00:00Z" }
    ],
    firstLight: { timeUtc: "2026-01-15T07:30:00Z" },
    lastLight: { timeUtc: "2026-01-15T17:45:00Z" }
  };
  const summer = {
    phase: { stage: "low", direction: "rising", progress: 0.05 },
    events: [
      { type: "low", timeUtc: "2026-07-15T17:00:00Z" },
      { type: "high", timeUtc: "2026-07-15T21:00:00Z" }
    ],
    firstLight: { timeUtc: "2026-07-15T05:00:00Z" },
    lastLight: { timeUtc: "2026-07-15T20:00:00Z" }
  };

  const winterLens = selectLocalLens(camera, sd, freshSnapshot(), winter, Date.parse("2026-01-15T08:30:00Z"));
  assert.equal(winterLens.targetTimeLabel, "10:00am");
  assert.equal(winterLens.afterDark, false);
  const summerLens = selectLocalLens(camera, sd, freshSnapshot(), summer, Date.parse("2026-07-15T17:30:00Z"));
  assert.equal(summerLens.targetTimeLabel, "8:00pm");
  assert.equal(summerLens.afterDark, false);

  const afterDark = selectLocalLens(camera, sd, freshSnapshot(), { ...summer, lastLight: { timeUtc: "2026-07-15T18:30:00Z" } }, Date.parse("2026-07-15T17:30:00Z"));
  assert.equal(afterDark.afterDark, true);
  assert.match(afterDark.text, /after dark/i);

  assert.equal(selectLocalLens(camera, sd, freshSnapshot(), winter, Date.parse("2026-01-15T01:00:00Z")), null);
});

test("future high-tide target honors a rising-direction preference", () => {
  const subject = {
    id: "surfline-high-rising",
    claims: [{
      id: "high-rising", topic: "tide", scope: { type: "spot", id: "surfline-high-rising" },
      confidence: "medium", reviewedAt: "2026-07-11T00:00:00Z", consensus: "settled",
      summary: "High and rising tide suits this spot.",
      rule: { type: "tide-preference", stage: "high", direction: "rising" }
    }]
  };
  subject.decisiveClaims = subject.claims;
  const customAdvice = normalizeSpotAdviceRuntime({
    schemaVersion: 1, sourceDigest: "fixture", subjects: { [subject.id]: subject },
    identityReport: { selectedSurflineIds: [subject.id], defaultFavoriteIds: [], adviceBearingCameraIds: [], byCameraId: { [subject.id]: subject.id } }
  });
  const tide = {
    phase: { stage: "low", direction: "rising", progress: 0.1 },
    events: [
      { type: "low", timeUtc: "2026-07-12T10:00:00Z" },
      { type: "high", timeUtc: "2026-07-12T14:00:00Z" }
    ]
  };
  const lens = selectLocalLens(
    { id: subject.id, promoted: true },
    spotData({ advice: customAdvice }),
    freshSnapshot(),
    tide,
    Date.parse("2026-07-12T11:00:00Z")
  );

  assert.equal(lens.targetTimeLabel, "3:00pm");
});

test("playbook groups every claim including published alternatives and sanitizes source links", () => {
  const supertubos = formatSpotPlaybook({ id: "surfline-supertubos", promoted: true }, spotData());
  const why = supertubos.sections.find((section) => section.id === "why-we-say-this");

  assert.equal(supertubos.conflicts.length, 1);
  assert.deepEqual(supertubos.sections.find((section) => section.id === "best-window").claims.map((claim) => claim.id).sort(), [
    "research-supertubos-southwest-swell",
    "research-supertubos-swell"
  ]);
  assert.ok(why.sources.every((source) => source.url === null || /^https?:\/\//.test(source.url)));
  assert.ok(why.sources.every((source) => source.scopeLabel && source.confidence));

  const unsafeSubject = {
    id: "surfline-unsafe",
    claims: [{
      id: "unsafe", topic: "mechanics", scope: { type: "spot", id: "surfline-unsafe" }, confidence: "low",
      reviewedAt: "2026-07-11T00:00:00Z", revalidateAfter: "2020-01-01", consensus: "settled",
      summary: "Unsafe source example.", rule: { type: "qualitative" },
      evidence: [{ title: "unsafe", publisher: "fixture", url: "javascript:alert(1)" }]
    }]
  };
  unsafeSubject.decisiveClaims = unsafeSubject.claims;
  const unsafeAdvice = normalizeSpotAdviceRuntime({
    schemaVersion: 1, sourceDigest: "fixture", subjects: { [unsafeSubject.id]: unsafeSubject },
    identityReport: { selectedSurflineIds: [unsafeSubject.id], defaultFavoriteIds: [], adviceBearingCameraIds: [], byCameraId: { [unsafeSubject.id]: unsafeSubject.id } }
  });
  const unsafe = formatSpotPlaybook({ id: unsafeSubject.id, promoted: true }, spotData({ advice: unsafeAdvice }));
  const source = unsafe.sections.find((section) => section.id === "why-we-say-this").sources[0];

  assert.equal(source.url, null);
  assert.equal(unsafe.sections.find((section) => section.id === "how-it-breaks").claims[0].needsRevalidation, true);
});
