import assert from "node:assert/strict";
import test from "node:test";

import * as mobileUx from "../src/mobile-ux.js";

const {
  groupMobileMapMarkers,
  shouldShowFavoriteResults
} = mobileUx;

test("aggregate marker labels include deduplicated geographic context", () => {
  const label = mobileUx.aggregateMapMarkerLabel?.([
    { location: "Ericeira", region: "Lisboa" },
    { location: " Ericeira ", region: "lisboa" },
    { location: "Ribeira d'Ilhas", region: "Lisboa" }
  ]);

  assert.equal(
    label,
    "3 surf cameras near Ericeira · Lisboa · Ribeira d'Ilhas. Activate to zoom in."
  );
});

test("aggregate marker labels have a sensible fallback without geographic data", () => {
  assert.equal(
    mobileUx.aggregateMapMarkerLabel?.([{}, {}]),
    "2 surf cameras in this area. Activate to zoom in."
  );
});

test("aggregate marker labels stay concise for dense coastal groups", () => {
  const label = mobileUx.aggregateMapMarkerLabel?.([
    { location: "Mafra", region: "Lisboa" },
    { location: "Sintra", region: "Lisboa" },
    { location: "Cascais", region: "Lisboa" },
    { location: "Oeiras", region: "Lisboa" }
  ]);

  assert.equal(
    label,
    "4 surf cameras near Mafra · Lisboa · Sintra + 2 more areas. Activate to zoom in."
  );
});

test("favorite camera results require intent from a useful query or filter", () => {
  assert.equal(shouldShowFavoriteResults({ query: "", region: "", provider: "" }), false);
  assert.equal(shouldShowFavoriteResults({ query: " s ", region: "", provider: "" }), false);
  assert.equal(shouldShowFavoriteResults({ query: "sá", region: "", provider: "" }), true);
  assert.equal(shouldShowFavoriteResults({ query: "", region: "lisboa", provider: "" }), true);
  assert.equal(shouldShowFavoriteResults({ query: "", region: "", provider: "surfline" }), true);
});

test("low zoom groups nearby cameras without mutating the camera collection", () => {
  const cameras = [
    { id: "a", lat: 38.700, lon: -9.420 },
    { id: "b", lat: 38.705, lon: -9.415 },
    { id: "c", lat: 41.150, lon: -8.680 },
    { id: "missing", lat: null, lon: -9 }
  ];

  const groups = groupMobileMapMarkers(cameras, { zoom: 7 });

  assert.deepEqual(groups.map((group) => group.cameras.map(({ id }) => id)), [["a", "b"], ["c"]]);
  assert.deepEqual(groups[0].center, [38.7025, -9.4175]);
  assert.deepEqual(cameras.map(({ id }) => id), ["a", "b", "c", "missing"]);
});

test("higher zoom returns one stable marker group per camera", () => {
  const cameras = [
    { id: "b", lat: 38.705, lon: -9.415 },
    { id: "a", lat: 38.700, lon: -9.420 }
  ];

  const groups = groupMobileMapMarkers(cameras, { zoom: 11 });

  assert.deepEqual(groups.map((group) => group.cameras.map(({ id }) => id)), [["b"], ["a"]]);
  assert.deepEqual(groups.map(({ center }) => center), [[38.705, -9.415], [38.7, -9.42]]);
});

test("grouping is deterministic at cell boundaries and supports a custom reveal zoom", () => {
  const cameras = [
    { id: "west", lat: 39.01, lon: -9.99 },
    { id: "east", lat: 39.01, lon: -8.01 }
  ];

  assert.equal(groupMobileMapMarkers(cameras, { zoom: 8 }).length, 2);
  assert.equal(groupMobileMapMarkers(cameras, { zoom: 8, maxIndividualZoom: 8 }).length, 2);
  assert.ok(groupMobileMapMarkers(cameras, { zoom: 7 }).every(({ key }) => typeof key === "string"));
});

test("the selected camera remains an individual marker inside a dense low-zoom group", () => {
  const cameras = [
    { id: "nearby", lat: 38.7, lon: -9.42 },
    { id: "selected", lat: 38.705, lon: -9.415 },
    { id: "neighbor", lat: 38.71, lon: -9.41 }
  ];

  const groups = groupMobileMapMarkers(cameras, {
    zoom: 7,
    priorityCameraId: "selected"
  });

  assert.deepEqual(groups.map((group) => group.cameras.map(({ id }) => id)), [
    ["nearby", "neighbor"],
    ["selected"]
  ]);
});
