import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import {
  getConditionVectors,
  parseMetricNumber,
  rateSurfSpot
} from "../src/surf-rating.js";

const baseCamera = {
  id: "praia-de-carcavelos",
  name: "Carcavelos",
  region: "cascais",
  forecast: {
    wave: "0.8 m",
    tide: "1.2m",
    tideState: "Baixa-mar",
    wind: "6Km/h",
    windDirection: "north"
  },
  detailMetrics: {
    "Período das ondas": "8.0s",
    "Direção das ondas": "Noroeste",
    "Direção do vento": "Norte"
  }
};

test("parseMetricNumber reads metric strings", () => {
  assert.equal(parseMetricNumber("1.4 m"), 1.4);
  assert.equal(parseMetricNumber("16.6Km/h"), 16.6);
  assert.equal(parseMetricNumber("6.5s"), 6.5);
  assert.equal(parseMetricNumber("unknown"), null);
});

test("rateSurfSpot returns practical model labels without numeric scores", () => {
  const rating = rateSurfSpot(baseCamera, DEFAULT_SURF_PREFERENCES);

  assert.equal(rating.key, "good");
  assert.equal(rating.label, "Good for us");
  assert.equal(rating.wave.label, "~0.8m");
  assert.equal(rating.wind.speedKmh, 6);
  assert.equal(rating.period.seconds, 8);
  assert.equal(rating.isRecommended, true);
  assert.doesNotMatch(rating.label, /\/100|score/i);
});

test("rateSurfSpot keeps oversized surf secondary instead of good", () => {
  const rating = rateSurfSpot({
    ...baseCamera,
    forecast: { ...baseCamera.forecast, wave: "2.2 m" }
  }, DEFAULT_SURF_PREFERENCES);

  assert.equal(rating.key, "poor");
  assert.equal(rating.isRecommended, false);
  assert.match(rating.reason, /outside/i);
});

test("rateSurfSpot marks weak exposure assumptions as tentative", () => {
  const rating = rateSurfSpot({
    ...baseCamera,
    id: "unknown-spot",
    region: "unknown"
  }, DEFAULT_SURF_PREFERENCES);

  assert.equal(rating.confidence.key, "unknown");
  assert.equal(rating.wind.alignment, "unknown");
});

test("getConditionVectors points wind arrow where wind is blowing", () => {
  const vectors = getConditionVectors(baseCamera);

  assert.equal(vectors.wind.compass, "N");
  assert.equal(vectors.wind.arrowBearing, 180);
  assert.equal(vectors.swell.compass, "NW");
});
