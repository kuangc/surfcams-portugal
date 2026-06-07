import assert from "node:assert/strict";
import test from "node:test";

import {
  abilityFit,
  buildGroupSummary,
  monitorTileData,
  surfDecision,
  waveCountSlang
} from "../src/surf-decision.js";

const baseCamera = {
  id: "clean-small-surf",
  name: "Clean Small Surf",
  location: "CASCAIS",
  region: "cascais",
  streamUrl: "https://example.com/clean.m3u8",
  image: "https://example.com/clean.jpg",
  forecast: {
    wave: "1.0 m",
    tide: "1.4m",
    tideState: "Baixa-mar",
    wind: "6Km/h",
    windDirection: "north"
  },
  detailMetrics: {
    "Período das ondas": "10s",
    "Direção das ondas": "Noroeste"
  }
};

test("surfDecision returns Best Today card fields from rating inputs", () => {
  const decision = surfDecision(baseCamera, 0);

  assert.equal(decision.rank, 1);
  assert.equal(decision.verdict, "Best bet");
  assert.equal(decision.abilityFit, "mixed");
  assert.equal(decision.confidence.label, "Medium");
  assert.equal(decision.tide, "Low tide 1.4m");
  assert.equal(decision.wind, "6 km/h N");
  assert.equal(decision.swell, "NW");
  assert.equal(decision.period, "10s");
  assert.equal(decision.waveCount.length > 0, true);
  assert.ok(decision.reason.includes("1m"));
});

test("surfDecision marks marginal sessions as caution", () => {
  const decision = surfDecision({
    ...baseCamera,
    forecast: {
      ...baseCamera.forecast,
      wave: "1.4 m",
      wind: "17Km/h"
    },
    detailMetrics: {
      ...baseCamera.detailMetrics,
      "Período das ondas": "6.4s"
    }
  }, 0);

  assert.equal(decision.verdict, "Caution");
  assert.equal(decision.abilityFit, "experienced");
  assert.match(decision.reason, /near max|short period|breezy/i);
});

test("abilityFit calls bigger or breezy sessions experienced", () => {
  assert.equal(abilityFit({ wave: { heightM: 1.45 }, wind: { speedKmh: 17 }, period: { seconds: 11 } }), "experienced");
  assert.equal(abilityFit({ wave: { heightM: 0.7 }, wind: { speedKmh: 8 }, period: { seconds: 7 } }), "mellow");
  assert.equal(abilityFit({ wave: { heightM: 1.0 }, wind: { speedKmh: 13 }, period: { seconds: 8 } }), "mixed");
});

test("waveCountSlang is deterministic surf slang, not a number", () => {
  const slang = waveCountSlang(baseCamera);

  assert.equal(typeof slang, "string");
  assert.doesNotMatch(slang, /^\d+$/);
  assert.equal(slang, waveCountSlang(baseCamera));
});

test("monitorTileData keeps a strict metric budget", () => {
  const tile = monitorTileData(baseCamera, 0);

  assert.deepEqual(Object.keys(tile), [
    "id",
    "rank",
    "name",
    "location",
    "streamUrl",
    "poster",
    "verdict",
    "wave",
    "wind",
    "tide",
    "period",
    "confidence",
    "waveCount"
  ]);
});

test("buildGroupSummary copies ranked monitor picks", () => {
  const summary = buildGroupSummary([baseCamera]);

  assert.match(summary, /Surf monitor shortlist/);
  assert.match(summary, /#1 Clean Small Surf/);
  assert.match(summary, /Best bet/);
  assert.match(summary, /Wave count/);
});
