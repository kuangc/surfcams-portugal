import assert from "node:assert/strict";
import test from "node:test";

import { inSuggestionFence, monitorFavoriteCameras } from "../src/monitor-cameras.js";

function playableCamera(id, overrides = {}) {
  return {
    id,
    hasStream: true,
    streamUrl: `https://example.com/${id}.m3u8`,
    ...overrides
  };
}

test("monitorFavoriteCameras returns more than seven favorites without padding or truncation", () => {
  const cameras = Array.from({ length: 9 }, (_, index) => playableCamera(`cam-${index + 1}`));
  const favoriteOrder = cameras.map(({ id }) => id).reverse();

  const favorites = monitorFavoriteCameras(cameras, new Set(favoriteOrder), favoriteOrder);

  assert.equal(favorites.length, 9);
  assert.deepEqual(favorites.map(({ id }) => id), favoriteOrder);
});

test("monitorFavoriteCameras stably sorts playable favorites by derived drive distance", () => {
  const cameras = ["a", "b", "c", "d"].map((id) => playableCamera(id));
  const distances = new Map([["a", 45], ["b", 20], ["c", 45]]);
  const favorites = monitorFavoriteCameras(
    cameras,
    new Set(["a", "b", "c", "d"]),
    ["a", "b", "c", "d"],
    { getDriveDistanceKm: (camera) => distances.get(camera.id) }
  );

  assert.deepEqual(favorites.map(({ id }) => id), ["b", "a", "c", "d"]);
});

test("monitorFavoriteCameras excludes guide-only, missing-stream, and missing-URL rows", () => {
  const cameras = [
    playableCamera("playable"),
    playableCamera("guide", { adviceGuideOnly: true }),
    playableCamera("missing-stream", { hasStream: false }),
    playableCamera("missing-url", { streamUrl: "" })
  ];
  const favoriteOrder = cameras.map(({ id }) => id);

  const favorites = monitorFavoriteCameras(cameras, new Set(favoriteOrder), favoriteOrder);

  assert.deepEqual(favorites.map(({ id }) => id), ["playable"]);
});

test("inSuggestionFence: lat band and west-of-lon guard", () => {
  assert.equal(inSuggestionFence({ lat: 39.65, lon: -9.09 }), true);
  assert.equal(inSuggestionFence({ lat: 38.40, lon: -9.10 }), true);
  assert.equal(inSuggestionFence({ lat: 39.66, lon: -9.09 }), false);
  assert.equal(inSuggestionFence({ lat: 38.47, lon: -8.99 }), false);
  assert.equal(inSuggestionFence({ lat: 38.60, lon: -9.04 }), false);
  assert.equal(inSuggestionFence({ lat: null, lon: -9.2 }), false);
});
