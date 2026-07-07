import assert from "node:assert/strict";
import test from "node:test";

import { trustedConditionsSourceFor } from "../scripts/build-spot-metadata-enrichment.js";

const meoSpot = {
  id: "meo-a",
  name: "Praia A",
  lat: 38.7,
  lon: -9.3
};

test("trustedConditionsSourceFor chooses the nearest curated member", () => {
  const mapping = {
    reviewStatus: "curated",
    distancesKm: {
      "surfline-far": 2.1,
      "surfline-near": 0.8
    },
    surflineSpotIds: ["surfline-far", "surfline-near"]
  };

  assert.equal(trustedConditionsSourceFor(mapping, meoSpot), "surfline-near");
});

test("trustedConditionsSourceFor chooses a generated name-match member", () => {
  const mapping = {
    reviewStatus: "generated",
    distancesKm: {
      "surfline-praia-a": 2.9,
      "surfline-nearby": 0.4
    },
    surflineSpotIds: ["surfline-nearby", "surfline-praia-a"],
    matchEvidence: [
      { surflineSpotId: "surfline-praia-a", nameScore: 0.9 },
      { surflineSpotId: "surfline-nearby", nameScore: 0 }
    ]
  };

  assert.equal(trustedConditionsSourceFor(mapping, meoSpot), "surfline-praia-a");
});

test("trustedConditionsSourceFor rejects needs-review-only distances", () => {
  const mapping = {
    reviewStatus: "needs-review",
    distancesKm: {
      "surfline-nearby": 0.4,
      "surfline-distant": 1.1
    },
    surflineSpotIds: ["surfline-nearby", "surfline-distant"]
  };

  assert.equal(trustedConditionsSourceFor(mapping, meoSpot), null);
});
