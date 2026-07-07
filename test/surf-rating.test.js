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
  assert.equal(vectors.wind.alignment, "offshore");
  assert.equal(vectors.swell.compass, "NW");
});

test("getConditionVectors treats wind from an exposed coast as onshore", () => {
  const vectors = getConditionVectors({
    ...baseCamera,
    id: "costa-da-caparica",
    region: "almada",
    forecast: {
      ...baseCamera.forecast,
      windDirection: "northwest"
    },
    detailMetrics: {
      ...baseCamera.detailMetrics,
      "Direção do vento": "Noroeste"
    }
  });

  assert.equal(vectors.coast.bearing, 270);
  assert.equal(vectors.wind.arrowBearing, 135);
  assert.equal(vectors.wind.alignment, "onshore");
});

test("getConditionVectors prefers camera exposure metadata over static fallbacks", () => {
  const vectors = getConditionVectors({
    ...baseCamera,
    id: "sao-juliao",
    region: "mafra",
    forecast: {
      ...baseCamera.forecast,
      windDirection: "east"
    },
    detailMetrics: {
      ...baseCamera.detailMetrics,
      "Direção do vento": "Este"
    },
    surfMetadata: {
      coastExposure: {
        bearing: 289,
        label: "Surfline-derived west-facing exposure",
        confidence: "spot",
        source: "surfline-metadata"
      }
    }
  });

  assert.equal(vectors.coast.bearing, 289);
  assert.equal(vectors.coast.compass, "W");
  assert.equal(vectors.coast.label, "Surfline-derived west-facing exposure");
  assert.equal(vectors.coast.source, "surfline-metadata");
  assert.equal(vectors.wind.alignment, "offshore");
});

const resolvedPrefs = {
  minSurfHeightM: 0.3,
  maxSurfHeightM: 1.5,
  maxWindSpeedKmh: 18,
  minPeriodSeconds: 5,
  preferOffshore: true,
  allowLightWind: true,
  surfSizeScale: 1
};

test("surfline-fresh: wave range overlap and rating carried", () => {
  const resolved = {
    source: "surfline-fresh",
    waveMinM: 0.9,
    waveMaxM: 1.8,
    windKmh: 10,
    windDirDeg: 20,
    periodS: 12,
    swellDirDeg: 225,
    rating: "GOOD",
    ageHours: 5,
    fetchedAt: "x"
  };
  const camera = { id: "surfline-supertubos", surfMetadata: { coastExposure: { bearing: 270 } } };
  const rating = rateSurfSpot(camera, resolvedPrefs, resolved);
  assert.equal(rating.isRecommended, true); // [0.9,1.8] overlaps [0.3,1.5]; wind 10<=18 light; period 12>=5
  assert.equal(rating.provenance.source, "surfline-fresh");
  assert.equal(rating.wave.label, "0.9–1.8m");
});

test("POOR hard-vetoes even when numbers pass", () => {
  const resolved = {
    source: "surfline-fresh",
    waveMinM: 0.9,
    waveMaxM: 1.2,
    windKmh: 8,
    windDirDeg: 20,
    periodS: 10,
    swellDirDeg: 225,
    rating: "POOR",
    ageHours: 5,
    fetchedAt: "x"
  };
  const rating = rateSurfSpot(
    { id: "x", surfMetadata: { coastExposure: { bearing: 270 } } },
    resolvedPrefs,
    resolved
  );
  assert.equal(rating.isRecommended, false);
  assert.notEqual(rating.key, "good");
});

test("VERY_POOR also hard-vetoes", () => {
  const resolved = {
    source: "surfline-fresh",
    waveMinM: 0.9,
    waveMaxM: 1.2,
    windKmh: 8,
    windDirDeg: 20,
    periodS: 10,
    swellDirDeg: 225,
    rating: "VERY_POOR",
    ageHours: 5,
    fetchedAt: "x"
  };
  const rating = rateSurfSpot(
    { id: "x", surfMetadata: { coastExposure: { bearing: 270 } } },
    resolvedPrefs,
    resolved
  );
  assert.equal(rating.isRecommended, false);
  assert.notEqual(rating.key, "good");
});

test("surfSizeScale only applies to meo-static", () => {
  const scaled = { ...resolvedPrefs, surfSizeScale: 0.5 };
  const meoCam = {
    id: "c",
    region: "cascais",
    forecast: { wave: "2.0 m", wind: "10Km/h", windDirection: "north" },
    detailMetrics: { "Período das ondas": "8s" }
  };
  const meoRating = rateSurfSpot(meoCam, scaled); // legacy 2-arg path: 2.0*0.5=1.0 in range
  assert.equal(meoRating.wave.meters, 1);
  const resolved = {
    source: "surfline-fresh",
    waveMinM: 2.0,
    waveMaxM: 2.0,
    windKmh: 10,
    windDirDeg: 20,
    periodS: 8,
    swellDirDeg: null,
    rating: "FAIR",
    ageHours: 1,
    fetchedAt: "x"
  };
  const slRating = rateSurfSpot(meoCam, scaled, resolved);
  assert.equal(slRating.isRecommended, false); // 2.0m unscaled, outside [0.3,1.5]
});

test("two-arg legacy path reports meo-static provenance", () => {
  const meoCam = {
    id: "c",
    region: "cascais",
    forecast: { wave: "1.0 m", wind: "10Km/h", windDirection: "north" },
    detailMetrics: { "Período das ondas": "8s" }
  };
  const rating = rateSurfSpot(meoCam, resolvedPrefs);
  assert.equal(rating.provenance.source, "meo-static");
  assert.equal(rating.provenance.ageHours, null);
});
