import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import {
  monitorCameraSlots,
  mightBeGoodCameras
} from "../src/monitor-cameras.js";

const cameras = [
  { id: "a", name: "A", region: "cascais", forecast: { wave: "0.8 m", wind: "4Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } },
  { id: "b", name: "B", region: "cascais", forecast: { wave: "1.0 m", wind: "5Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } },
  { id: "c", name: "C", region: "cascais", forecast: { wave: "2.4 m", wind: "5Km/h", windDirection: "north" }, detailMetrics: { "Período das ondas": "8s", "Direção das ondas": "Noroeste" } }
];

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
  const result = mightBeGoodCameras(cameras, new Set(["a"]), DEFAULT_SURF_PREFERENCES, 6);

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
    { getDriveDistanceKm: (camera) => distances.get(camera.id) }
  );

  assert.deepEqual(result.map((camera) => camera.id), ["b", "a"]);
});
