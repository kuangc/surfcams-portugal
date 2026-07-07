import test from "node:test";
import assert from "node:assert/strict";
import { resolveConditions, newestConditionsAgeHours } from "../src/forecast-sources.js";

const NOW = Date.parse("2026-07-06T12:00:00Z");
const spotData = {
  conditionsById: new Map([
    ["surfline-fresh-spot", { rating: "GOOD", ratingValue: 5, surfMinM: 0.9, surfMaxM: 1.5,
      windKmh: 11, windDirDeg: 20, swells: [{ hM: 1.2, periodS: 12, dirDeg: 225 }],
      fetchedAt: "2026-07-06T06:00:00Z" }],
    ["surfline-stale-spot", { rating: "FAIR", surfMinM: 0.6, surfMaxM: 0.9, fetchedAt: "2026-06-11T12:00:00Z" }]
  ]),
  spotMetadataById: new Map([
    ["cam-matched", { surfMetadata: { sourceSpotId: "surfline-fresh-spot", conditionsSourceSpotId: "surfline-fresh-spot", reviewStatus: "generated" } }],
    ["cam-loose", { surfMetadata: { sourceSpotId: "surfline-fresh-spot", conditionsSourceSpotId: "surfline-fresh-spot", reviewStatus: "needs-review" } }],
    ["cam-rich-no-trusted", { surfMetadata: { sourceSpotId: "surfline-fresh-spot", conditionsSourceSpotId: null, reviewStatus: "generated" } }]
  ])
};

test("promoted spot with fresh conditions -> surfline-fresh", () => {
  const resolved = resolveConditions({ id: "surfline-fresh-spot", promoted: true }, spotData, { now: NOW });
  assert.equal(resolved.source, "surfline-fresh");
  assert.equal(resolved.waveMinM, 0.9);
  assert.equal(resolved.waveMaxM, 1.5);
  assert.equal(resolved.rating, "GOOD");
  assert.equal(resolved.periodS, 12);
  assert.equal(resolved.swellDirDeg, 225);
  assert.equal(Math.round(resolved.ageHours), 6);
});

test("matched meo cam resolves via enrichment conditionsSourceSpotId", () => {
  const resolved = resolveConditions({ id: "cam-matched" }, spotData, { now: NOW });
  assert.equal(resolved.source, "surfline-fresh");
  assert.equal(resolved.windKmh, 11);
});

test("needs-review enrichment never yields surfline-fresh", () => {
  const resolved = resolveConditions({ id: "cam-loose", forecast: { wave: "1.0 m" } }, spotData, { now: NOW });
  assert.equal(resolved.source, "meo-static");
});

test("metadata sourceSpotId alone never yields surfline-fresh for non-promoted cams", () => {
  const resolved = resolveConditions({ id: "cam-rich-no-trusted", forecast: { wave: "1.0 m" } }, spotData, { now: NOW });
  assert.equal(resolved.source, "meo-static");
});

test("stale surfline entry falls through to live cache when present", () => {
  const liveCache = new Map([["surfline-stale-spot", {
    fetchedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    waveMinM: 1.1, waveMaxM: 1.1, windKmh: 22, windDirDeg: 340, periodS: 9, swellDirDeg: 300
  }]]);
  const resolved = resolveConditions({ id: "surfline-stale-spot", promoted: true }, spotData, { now: NOW, liveCache });
  assert.equal(resolved.source, "live-model");
  assert.equal(resolved.windKmh, 22);
  assert.equal(resolved.rating, null);
});

test("live cache keyed by camera id also resolves", () => {
  const liveCache = new Map([["cam-plain", {
    fetchedAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
    waveMinM: 0.8, waveMaxM: 0.8, windKmh: 15, windDirDeg: 200, periodS: 8, swellDirDeg: 280
  }]]);
  const resolved = resolveConditions({ id: "cam-plain" }, spotData, { now: NOW, liveCache });
  assert.equal(resolved.source, "live-model");
});

test("expired live cache falls through to meo-static", () => {
  const liveCache = new Map([["cam-plain", {
    fetchedAt: new Date(NOW - 3 * 3600 * 1000).toISOString(),
    waveMinM: 0.8, waveMaxM: 0.8, windKmh: 15, windDirDeg: 200, periodS: 8, swellDirDeg: 280
  }]]);
  const camera = { id: "cam-plain", forecast: { wave: "1.4 m", wind: "16.6Km/h" },
    detailMetrics: { "Período das ondas": "6.5s" } };
  const resolved = resolveConditions(camera, spotData, { now: NOW, liveCache });
  assert.equal(resolved.source, "meo-static");
  assert.equal(resolved.waveMinM, 1.4);
  assert.equal(resolved.waveMaxM, 1.4);
  assert.equal(resolved.windKmh, 16.6);
  assert.equal(resolved.periodS, 6.5);
  assert.equal(resolved.ageHours, null);
});

test("newestConditionsAgeHours reports freshest entry age", () => {
  assert.equal(Math.round(newestConditionsAgeHours(spotData, NOW)), 6);
});

test("newestConditionsAgeHours null when no conditions", () => {
  assert.equal(newestConditionsAgeHours({ conditionsById: new Map() }, Date.now()), null);
});
