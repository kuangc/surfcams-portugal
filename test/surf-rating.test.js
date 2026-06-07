import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSurfFit,
  describeCoastExposure,
  getConditionVectors,
  parseMetricNumber,
  rateSurfSpot
} from "../src/surf-rating.js";

const cleanSmallSurf = {
  id: "clean-small-surf",
  name: "Clean Small Surf",
  region: "cascais",
  forecast: {
    wave: "1.0 m",
    wind: "6Km/h",
    windDirection: "north"
  },
  detailMetrics: {
    "Período das ondas": "10s",
    "Direção das ondas": "Noroeste"
  }
};

const oversizedOnshoreSurf = {
  id: "oversized-onshore-surf",
  name: "Oversized Onshore Surf",
  region: "cascais",
  forecast: {
    wave: "2.4 m",
    wind: "28Km/h",
    windDirection: "south"
  },
  detailMetrics: {
    "Período das ondas": "4s"
  }
};

test("parseMetricNumber reads metric forecast strings", () => {
  assert.equal(parseMetricNumber("1.4 m"), 1.4);
  assert.equal(parseMetricNumber("16.6Km/h"), 16.6);
  assert.equal(parseMetricNumber("N/A"), null);
  assert.equal(parseMetricNumber(""), null);
});

test("rateSurfSpot returns Surfline-style model labels without false precision", () => {
  const cleanRating = rateSurfSpot(cleanSmallSurf);
  const roughRating = rateSurfSpot(oversizedOnshoreSurf);

  assert.equal(cleanRating.label, "Fair to Good");
  assert.equal(cleanRating.key, "fair-to-good");
  assert.equal(cleanRating.barCount, 5);
  assert.equal(cleanRating.isRecommended, true);
  assert.equal(cleanRating.wave.inRange, true);
  assert.equal(cleanRating.wind.alignment, "offshore");
  assert.ok(cleanRating.reasons.some((reason) => reason.includes("0.3-1.5m")));
  assert.ok(cleanRating.sortScore > roughRating.sortScore);
  assert.equal("score" in cleanRating, false);

  assert.equal(roughRating.isRecommended, false);
  assert.equal(roughRating.label, "Very Poor");
  assert.equal(roughRating.wave.inRange, false);
  assert.equal(roughRating.wind.alignment, "onshore");
});

test("rateSurfSpot does not call very short-period surf a go condition", () => {
  const shortPeriodRating = rateSurfSpot({
    ...cleanSmallSurf,
    detailMetrics: {
      "Período das ondas": "3.3s"
    }
  });

  assert.equal(shortPeriodRating.label, "Poor to Fair");
  assert.equal(shortPeriodRating.barCount, 3);
  assert.equal(shortPeriodRating.isRecommended, false);
});

test("rateSurfSpot discounts sheltered Sesimbra bay surf from exposed swell readings", () => {
  const sesimbraRating = rateSurfSpot({
    id: "praia-sesimbra",
    name: "Praia Sesimbra",
    region: "sesimbra",
    forecast: {
      wave: "1.8 m",
      wind: "17.6Km/h",
      windDirection: "northwest"
    },
    detailMetrics: {
      "Período das ondas": "6.2s",
      "Direção das ondas": "Noroeste"
    }
  });

  assert.equal(sesimbraRating.wind.alignment, "offshore");
  assert.equal(sesimbraRating.label, "Poor");
  assert.equal(sesimbraRating.isRecommended, false);
  assert.equal(sesimbraRating.wave.rawHeightM, 1.8);
  assert.equal(sesimbraRating.wave.heightM, 0.5);
  assert.equal(sesimbraRating.wave.estimated, true);
  assert.ok(sesimbraRating.reasons.some((reason) => /protected bay/i.test(reason)));
});

test("rateSurfSpot uses broad Portuguese coast exposure heuristics", () => {
  const penicheOffshore = rateSurfSpot({
    ...cleanSmallSurf,
    region: "peniche",
    forecast: {
      ...cleanSmallSurf.forecast,
      windDirection: "east"
    }
  });
  const penicheOnshore = rateSurfSpot({
    ...cleanSmallSurf,
    region: "peniche",
    forecast: {
      ...cleanSmallSurf.forecast,
      windDirection: "west"
    }
  });

  assert.equal(penicheOffshore.wind.alignment, "offshore");
  assert.equal(penicheOnshore.wind.alignment, "onshore");
});

test("rateSurfSpot avoids offshore guesses where coast exposure is too broad", () => {
  const islandRating = rateSurfSpot({
    ...cleanSmallSurf,
    region: "ilhas",
    forecast: {
      ...cleanSmallSurf.forecast,
      windDirection: "south"
    }
  });

  assert.equal(islandRating.wind.alignment, "unknown");
  assert.ok(islandRating.sortScore < 75);
  assert.equal(islandRating.isRecommended, false);
});

test("describeCoastExposure returns readable broad exposure labels", () => {
  assert.deepEqual(describeCoastExposure(cleanSmallSurf), {
    key: "south-facing",
    label: "South-facing coast",
    shortLabel: "S-facing",
    bearing: 180,
    confidence: "regional"
  });

  assert.deepEqual(describeCoastExposure({ ...cleanSmallSurf, region: "peniche" }), {
    key: "west-facing",
    label: "West-facing Atlantic coast",
    shortLabel: "W-facing",
    bearing: 270,
    confidence: "regional"
  });

  assert.deepEqual(describeCoastExposure({ ...cleanSmallSurf, region: "ilhas" }), {
    key: "unknown",
    label: "Unknown coast exposure",
    shortLabel: "Exposure unknown",
    bearing: null,
    confidence: "unknown"
  });
});

test("getConditionVectors exposes coast, wind, and swell directions for visualization", () => {
  const vectors = getConditionVectors(cleanSmallSurf);

  assert.deepEqual(vectors.coast, {
    label: "South-facing coast",
    shortLabel: "S-facing",
    bearing: 180,
    confidence: "regional"
  });
  assert.deepEqual(vectors.wind, {
    label: "Wind from N",
    bearing: 0,
    arrowBearing: 180,
    alignment: "offshore"
  });
  assert.deepEqual(vectors.swell, {
    label: "Swell from NW",
    bearing: 315,
    arrowBearing: 135
  });
});

test("compareSurfFit sorts the best surf candidate first", () => {
  const sorted = [oversizedOnshoreSurf, cleanSmallSurf].sort(compareSurfFit);

  assert.deepEqual(sorted.map((camera) => camera.id), ["clean-small-surf", "oversized-onshore-surf"]);
});
