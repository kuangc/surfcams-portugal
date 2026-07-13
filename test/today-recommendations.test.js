import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalFaceCurve,
  buildSurfWindows,
  evaluateTodayHour,
  recommendTodaySpots
} from "../src/today-recommendations.js";
import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";

const NOW = Date.parse("2026-07-13T09:15:00Z");

function hour(time, values = {}) {
  return {
    time,
    offshoreWaveM: 1,
    primarySwellHeightM: 2.1,
    primarySwellPeriodS: 10,
    primarySwellDirectionDeg: 280,
    windKmh: 8,
    windDirectionDeg: 90,
    ...values
  };
}

function forecast(hours = [
  hour("2026-07-13T09:00:00.000Z"),
  hour("2026-07-13T10:00:00.000Z", { offshoreWaveM: 1.2 }),
  hour("2026-07-13T11:00:00.000Z", { offshoreWaveM: 1.3 }),
  hour("2026-07-13T12:00:00.000Z", { offshoreWaveM: 1.1 })
], fetchedAt = "2026-07-13T09:00:00.000Z") {
  return { fetchedAt, hours };
}

function conditions(values = {}) {
  return {
    source: "surfline-fresh",
    fetchedAt: "2026-07-13T08:30:00.000Z",
    ageHours: 0.75,
    providerSpotSurfMinM: 0.6,
    providerSpotSurfMaxM: 1,
    rating: "FAIR",
    ratingObserved: false,
    ...values
  };
}

function camera(id = "spot", values = {}) {
  return {
    id,
    name: id,
    lat: 38.7,
    lon: -9.3,
    surfMetadata: { coastExposure: { bearing: 270, confidence: "spot" } },
    ...values
  };
}

function advice(claims = [], values = {}) {
  return { subjectId: "spot", claims, conflicts: [], researched: true, ...values };
}

function minimum(value, effectAtOrAbove = null) {
  return {
    id: `minimum-${value}`,
    topic: "size-translation",
    consensus: "settled",
    confidence: "medium",
    scope: { type: "spot", id: "spot" },
    rule: {
      type: "minimum",
      input: "primary-swell-height-m",
      value,
      effectBelow: "likely-flat",
      ...(effectAtOrAbove ? { effectAtOrAbove } : {})
    }
  };
}

function tidePreference(stage, scope = "spot") {
  return {
    id: `tide-${stage}`,
    topic: "tide",
    consensus: "settled",
    confidence: "medium",
    scope: { type: scope, id: scope === "stretch" ? "caparica" : "spot" },
    rule: { type: "tide-preference", stage }
  };
}

function tideSnapshot() {
  return {
    events: [
      { type: "low", timeUtc: "2026-07-13T06:00:00.000Z" },
      { type: "high", timeUtc: "2026-07-13T12:00:00.000Z" },
      { type: "low", timeUtc: "2026-07-13T18:00:00.000Z" }
    ],
    firstLight: { timeUtc: "2026-07-13T05:30:00.000Z" },
    lastLight: { timeUtc: "2026-07-13T20:30:00.000Z" }
  };
}

function candidate(id, values = {}) {
  return {
    camera: camera(id),
    forecast: forecast(),
    conditions: conditions(),
    advice: advice(),
    tide: tideSnapshot(),
    driveMinutes: 30,
    ...values
  };
}

test("local face curve follows hourly offshore shape while retaining a fresh Surfline anchor", () => {
  const curve = buildLocalFaceCurve({ forecast: forecast(), conditions: conditions(), now: NOW });

  assert.deepEqual(curve.map(({ time, localFaceMinM, localFaceMaxM, source, confidence }) => ({
    time, localFaceMinM, localFaceMaxM, source, confidence
  })), [
    { time: "2026-07-13T09:00:00.000Z", localFaceMinM: 0.6, localFaceMaxM: 1, source: "surfline-anchored-model", confidence: "medium" },
    { time: "2026-07-13T10:00:00.000Z", localFaceMinM: 0.72, localFaceMaxM: 1.2, source: "surfline-anchored-model", confidence: "medium" },
    { time: "2026-07-13T11:00:00.000Z", localFaceMinM: 0.78, localFaceMaxM: 1.3, source: "surfline-anchored-model", confidence: "medium" },
    { time: "2026-07-13T12:00:00.000Z", localFaceMinM: 0.66, localFaceMaxM: 1.1, source: "surfline-anchored-model", confidence: "medium" }
  ]);
});

test("local face curve rejects stale, missing, and extreme anchors", () => {
  assert.deepEqual(buildLocalFaceCurve({ forecast: forecast([], "2026-07-13T05:00:00Z"), conditions: conditions(), now: NOW }), []);
  assert.deepEqual(buildLocalFaceCurve({ forecast: forecast(), conditions: conditions({ providerSpotSurfMinM: null }), now: NOW }), []);

  const curve = buildLocalFaceCurve({
    forecast: forecast([
      hour("2026-07-13T09:00:00.000Z", { offshoreWaveM: 1 }),
      hour("2026-07-13T10:00:00.000Z", { offshoreWaveM: 4 }),
      hour("2026-07-13T11:00:00.000Z", { offshoreWaveM: 0.1 })
    ]),
    conditions: conditions(),
    now: NOW
  });
  assert.deepEqual(curve.map((point) => point.localFaceMaxM), [1, 2, 0.5]);
});

test("reviewed minimum swell is a hard hourly gate for Sesimbra, Caxias, and Torre", () => {
  const base = {
    camera: camera(),
    hour: hour("2026-07-13T10:00:00.000Z", { primarySwellHeightM: 1.7 }),
    localFace: { localFaceMinM: 0.6, localFaceMaxM: 1, source: "surfline-anchored-model", confidence: "medium" },
    preferences: DEFAULT_SURF_PREFERENCES,
    tide: { stage: "mid", direction: "rising" },
    daylight: true,
    conditions: conditions(),
    now: NOW
  };

  for (const id of ["sesimbra", "caxias"]) {
    const result = evaluateTodayHour({ ...base, camera: camera(id), advice: advice([minimum(2)]) });
    assert.equal(result.eligibility, "ineligible");
    assert.match(result.primaryReason, /needs 2 m primary swell/i);
  }

  const torreBelow = evaluateTodayHour({ ...base, camera: camera("torre"), advice: advice([minimum(1.5, "may-start-working")]), hour: { ...base.hour, primarySwellHeightM: 1.4 } });
  const torreWorking = evaluateTodayHour({ ...base, camera: camera("torre"), advice: advice([minimum(1.5, "may-start-working")]), hour: { ...base.hour, primarySwellHeightM: 1.5 } });
  assert.equal(torreBelow.eligibility, "ineligible");
  assert.equal(torreWorking.eligibility, "eligible");
});

test("Caparica high tide and São Julião mid tide change hourly quality rather than face size", () => {
  const common = {
    camera: camera(),
    hour: hour("2026-07-13T10:00:00.000Z"),
    localFace: { localFaceMinM: 0.6, localFaceMaxM: 1, source: "surfline-anchored-model", confidence: "medium" },
    preferences: DEFAULT_SURF_PREFERENCES,
    daylight: true,
    conditions: conditions(),
    now: NOW
  };
  const caparicaMid = evaluateTodayHour({ ...common, advice: advice([tidePreference("high", "stretch")]), tide: { stage: "mid", direction: "rising" } });
  const caparicaHigh = evaluateTodayHour({ ...common, advice: advice([tidePreference("high", "stretch")]), tide: { stage: "high", direction: "rising" } });
  const juliaoMid = evaluateTodayHour({ ...common, advice: advice([tidePreference("mid")]), tide: { stage: "mid", direction: "rising" } });

  assert.equal(caparicaMid.quality, "possible");
  assert.equal(caparicaHigh.quality, "good");
  assert.equal(juliaoMid.quality, "good");
  assert.deepEqual(caparicaHigh.localFace, caparicaMid.localFace);
});

test("quality and confidence stay independent for missing research and conflicts", () => {
  const common = {
    camera: camera(),
    hour: hour("2026-07-13T10:00:00.000Z"),
    localFace: { localFaceMinM: 0.6, localFaceMaxM: 1, source: "surfline-anchored-model", confidence: "medium" },
    preferences: DEFAULT_SURF_PREFERENCES,
    tide: { stage: "mid", direction: "rising" },
    daylight: true,
    conditions: conditions(),
    now: NOW
  };
  const missing = evaluateTodayHour({ ...common, advice: { subjectId: null, claims: [], conflicts: [], researched: false } });
  const conflicted = evaluateTodayHour({ ...common, advice: advice([], { conflicts: [{ id: "swell-conflict" }] }) });

  assert.equal(missing.quality, "good");
  assert.equal(missing.confidence, "low");
  assert.equal(conflicted.quality, "good");
  assert.equal(conflicted.confidence, "low");
});

test("modeled POOR is a penalty while an observed POOR only vetoes the current hour", () => {
  const common = {
    camera: camera(),
    localFace: { localFaceMinM: 0.6, localFaceMaxM: 1, source: "surfline-anchored-model", confidence: "medium" },
    preferences: DEFAULT_SURF_PREFERENCES,
    tide: { stage: "mid", direction: "rising" },
    daylight: true,
    advice: advice(),
    now: NOW
  };
  const modeled = evaluateTodayHour({ ...common, hour: hour("2026-07-13T09:00:00.000Z"), conditions: conditions({ rating: "POOR", ratingObserved: false }) });
  const observedNow = evaluateTodayHour({ ...common, hour: hour("2026-07-13T09:00:00.000Z"), conditions: conditions({ rating: "POOR", ratingObserved: true }) });
  const observedFuture = evaluateTodayHour({ ...common, hour: hour("2026-07-13T10:00:00.000Z"), conditions: conditions({ rating: "POOR", ratingObserved: true }) });

  assert.equal(modeled.eligibility, "eligible");
  assert.equal(modeled.quality, "possible");
  assert.equal(observedNow.eligibility, "ineligible");
  assert.equal(observedFuture.eligibility, "eligible");
});

test("window construction requires stable adjacent good hours and clamps to now and last light", () => {
  const evaluations = [
    { time: "2026-07-13T09:00:00.000Z", quality: "good", confidence: "medium", reasons: ["A"] },
    { time: "2026-07-13T10:00:00.000Z", quality: "good", confidence: "medium", reasons: ["A"] },
    { time: "2026-07-13T11:00:00.000Z", quality: "possible", confidence: "medium", reasons: ["B"] },
    { time: "2026-07-13T12:00:00.000Z", quality: "good", confidence: "medium", reasons: ["C"] }
  ];
  const windows = buildSurfWindows(evaluations, { now: NOW, lastLight: Date.parse("2026-07-13T12:20:00Z") });

  assert.equal(windows.length, 1);
  assert.equal(windows[0].start, "2026-07-13T09:15:00.000Z");
  assert.equal(windows[0].end, "2026-07-13T10:30:00.000Z");
  assert.equal(windows[0].confidence, "medium");
});

test("recommendations keep low-confidence and marginal cases in Worth checking and rank quality before distance", () => {
  const farGood = candidate("far-good", { driveMinutes: 55 });
  const nearGood = candidate("near-good", { driveMinutes: 15, conditions: conditions({ rating: "GOOD" }) });
  const unresearched = candidate("unresearched", { advice: { subjectId: null, claims: [], conflicts: [], researched: false }, driveMinutes: 5 });
  const missingFace = candidate("missing-face", { conditions: conditions({ providerSpotSurfMinM: null }) });
  const result = recommendTodaySpots([farGood, nearGood, unresearched, missingFace], DEFAULT_SURF_PREFERENCES, { now: NOW });

  assert.deepEqual(result.bestBets.map((entry) => entry.camera.id), ["near-good", "far-good"]);
  assert.deepEqual(result.worthChecking.map((entry) => entry.camera.id).sort(), ["missing-face", "unresearched"]);
  assert.match(result.worthChecking.find((entry) => entry.camera.id === "missing-face").primaryReason, /local face/i);
  assert.ok(result.bestBets.every((entry) => entry.quality === "good" && ["high", "medium"].includes(entry.confidence)));
  assert.ok(result.bestBets.every((entry) => entry.reasons.length <= 3));
});

test("stale forecast, darkness, oversized surf, and area-only evidence never enter Best bets", () => {
  const stale = candidate("stale", { forecast: forecast(undefined, "2026-07-13T05:00:00.000Z") });
  const dark = candidate("dark", {
    forecast: forecast([
      hour("2026-07-13T21:00:00.000Z"),
      hour("2026-07-13T22:00:00.000Z")
    ])
  });
  const oversized = candidate("oversized", { conditions: conditions({ providerSpotSurfMinM: 1.8, providerSpotSurfMaxM: 2.4 }) });
  const areaOnly = candidate("area-only", {
    advice: advice([{ ...tidePreference("mid"), scope: { type: "area", id: "lisbon" } }])
  });
  const result = recommendTodaySpots([stale, dark, oversized, areaOnly], DEFAULT_SURF_PREFERENCES, { now: NOW });

  assert.deepEqual(result.bestBets, []);
  assert.deepEqual(result.worthChecking.map((entry) => entry.camera.id).sort(), ["area-only", "dark", "oversized", "stale"]);
});
