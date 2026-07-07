import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import {
  monitorCameraSlots,
  mightBeGoodCameras,
  inSuggestionFence
} from "../src/monitor-cameras.js";

const cameras = [
  { id: "a", name: "A", region: "cascais", lat: 38.7, lon: -9.3, forecast: { wave: "0.8 m", wind: "4Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } },
  { id: "b", name: "B", region: "cascais", lat: 38.7, lon: -9.3, forecast: { wave: "1.0 m", wind: "5Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } },
  { id: "c", name: "C", region: "cascais", lat: 38.7, lon: -9.3, forecast: { wave: "2.4 m", wind: "5Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } }
];

// Fresh-provenance conditions consistent with each camera's original forecast fixture above,
// so the pre-existing might-be-good assertions keep testing the same intent under the new gate.
const freshConditionsById = {
  a: { source: "surfline-fresh", waveMinM: 0.8, waveMaxM: 0.8, windKmh: 4, windDirDeg: 0, periodS: 8, swellDirDeg: 315, rating: "FAIR", ageHours: 2, fetchedAt: "x" },
  b: { source: "surfline-fresh", waveMinM: 1.0, waveMaxM: 1.0, windKmh: 5, windDirDeg: 0, periodS: 8, swellDirDeg: 315, rating: "FAIR", ageHours: 2, fetchedAt: "x" },
  c: { source: "surfline-fresh", waveMinM: 2.4, waveMaxM: 2.4, windKmh: 5, windDirDeg: 0, periodS: 8, swellDirDeg: 315, rating: "FAIR", ageHours: 2, fetchedAt: "x" }
};
const getFreshConditions = (camera) => freshConditionsById[camera.id];

test("monitorCameraSlots shows favorites only and leaves empty slots", () => {
  const slots = monitorCameraSlots(cameras, new Set(["b"]), ["a", "b"], 3);

  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((slot) => slot.camera?.id || null), ["b", null, null]);
  assert.equal(slots[1].empty, true);
});

test("monitorCameraSlots caps favorites at the configured limit", () => {
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));
  const slots = monitorCameraSlots(many, new Set(many.map((camera) => camera.id)), many.map((camera) => camera.id), 7);

  assert.deepEqual(slots.map((slot) => slot.camera?.id), ["a", "b", "c", "d", "e", "f", "g"]);
});

test("monitorCameraSlots sorts favorite monitor tiles by nearest drive distance", () => {
  const distances = new Map([
    ["a", 45],
    ["b", 20],
    ["c", 85]
  ]);
  const slots = monitorCameraSlots(
    cameras,
    new Set(["a", "b", "c"]),
    ["a", "b", "c"],
    3,
    { getDriveDistanceKm: (camera) => distances.get(camera.id) }
  );

  assert.deepEqual(slots.map((slot) => slot.camera?.id), ["b", "a", "c"]);
});

test("mightBeGoodCameras is explicit and excludes favorites", () => {
  const result = mightBeGoodCameras(cameras, new Set(["a"]), DEFAULT_SURF_PREFERENCES, 6, { getConditions: getFreshConditions });

  assert.deepEqual(result.map((camera) => camera.id), ["b"]);
});

test("mightBeGoodCameras sorts monitor candidates by nearest drive distance before limiting", () => {
  const distances = new Map([
    ["a", 45],
    ["b", 20]
  ]);
  const result = mightBeGoodCameras(
    cameras,
    new Set(),
    DEFAULT_SURF_PREFERENCES,
    2,
    { getDriveDistanceKm: (camera) => distances.get(camera.id), getConditions: getFreshConditions }
  );

  assert.deepEqual(result.map((camera) => camera.id), ["b", "a"]);
});

test("inSuggestionFence: lat band and west-of-lon guard", () => {
  assert.equal(inSuggestionFence({ lat: 39.65, lon: -9.09 }), true);   // Nazaré
  assert.equal(inSuggestionFence({ lat: 38.40, lon: -9.10 }), true);   // Sesimbra edge
  assert.equal(inSuggestionFence({ lat: 39.66, lon: -9.09 }), false);  // north of fence
  assert.equal(inSuggestionFence({ lat: 38.47, lon: -8.99 }), false);  // Arrábida pocket
  assert.equal(inSuggestionFence({ lat: 38.60, lon: -9.04 }), false);  // east of guard
  assert.equal(inSuggestionFence({ lat: null, lon: -9.2 }), false);    // missing coords
});

test("mightBeGoodCameras only proposes fenced spots with fresh provenance", () => {
  const mk = (id, lat, lon) => ({ id, lat, lon, surfMetadata: { coastExposure: { bearing: 270 } } });
  const cameras = [mk("in-fresh", 38.7, -9.3), mk("in-stale", 38.7, -9.3), mk("out-fresh", 37.9, -8.8)];
  const conditions = {
    "in-fresh": { source: "surfline-fresh", waveMinM: 0.9, waveMaxM: 1.2, windKmh: 10, windDirDeg: 20, periodS: 10, swellDirDeg: 280, rating: "GOOD", ageHours: 2, fetchedAt: "x" },
    "in-stale": { source: "meo-static", waveMinM: 1.0, waveMaxM: 1.0, windKmh: 10, windDirDeg: null, periodS: 10, swellDirDeg: null, rating: null, ageHours: null, fetchedAt: null },
    "out-fresh": { source: "surfline-fresh", waveMinM: 0.9, waveMaxM: 1.2, windKmh: 10, windDirDeg: 20, periodS: 10, swellDirDeg: 280, rating: "GOOD", ageHours: 2, fetchedAt: "x" }
  };
  const prefs = { minSurfHeightM: 0.3, maxSurfHeightM: 1.5, maxWindSpeedKmh: 18, minPeriodSeconds: 5, allowLightWind: true, preferOffshore: true, surfSizeScale: 1 };
  const result = mightBeGoodCameras(cameras, new Set(), prefs, 7, { getConditions: (cam) => conditions[cam.id] });
  assert.deepEqual(result.map((c) => c.id), ["in-fresh"]);
});

test("mightBeGoodCameras without getConditions proposes nothing", () => {
  const cameras = [{ id: "in", lat: 38.7, lon: -9.3, forecast: { wave: "1.0 m", wind: "10Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s" } }];
  const prefs = { minSurfHeightM: 0.3, maxSurfHeightM: 1.5, maxWindSpeedKmh: 18, minPeriodSeconds: 5, allowLightWind: true, preferOffshore: true, surfSizeScale: 1 };
  assert.deepEqual(mightBeGoodCameras(cameras, new Set(), prefs, 7, {}), []);
});
