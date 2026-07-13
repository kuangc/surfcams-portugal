import assert from "node:assert/strict";
import test from "node:test";

import { inSuggestionFence, monitorCameraSlots } from "../src/monitor-cameras.js";

const cameras = ["a", "b", "c"].map((id) => ({ id }));

test("monitorCameraSlots shows favorites only and leaves empty slots", () => {
  const slots = monitorCameraSlots(cameras, new Set(["b"]), ["a", "b"], 3);

  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((slot) => slot.camera?.id || null), ["b", null, null]);
  assert.equal(slots[1].empty, true);
});

test("monitorCameraSlots caps favorites and sorts by drive distance", () => {
  const distances = new Map([["a", 45], ["b", 20], ["c", 85]]);
  const slots = monitorCameraSlots(
    cameras,
    new Set(["a", "b", "c"]),
    ["a", "b", "c"],
    2,
    { getDriveDistanceKm: (camera) => distances.get(camera.id) }
  );

  assert.deepEqual(slots.map((slot) => slot.camera?.id), ["b", "a"]);
});

test("persisted guide-only favorites never enter monitor slots", () => {
  const guide = { id: "guide", adviceGuideOnly: true };
  const slots = monitorCameraSlots([guide, cameras[0]], new Set(["guide", "a"]), ["guide", "a"], 2);

  assert.deepEqual(slots.map((slot) => slot.camera?.id || null), ["a", null]);
});

test("inSuggestionFence: lat band and west-of-lon guard", () => {
  assert.equal(inSuggestionFence({ lat: 39.65, lon: -9.09 }), true);
  assert.equal(inSuggestionFence({ lat: 38.40, lon: -9.10 }), true);
  assert.equal(inSuggestionFence({ lat: 39.66, lon: -9.09 }), false);
  assert.equal(inSuggestionFence({ lat: 38.47, lon: -8.99 }), false);
  assert.equal(inSuggestionFence({ lat: 38.60, lon: -9.04 }), false);
  assert.equal(inSuggestionFence({ lat: null, lon: -9.2 }), false);
});
