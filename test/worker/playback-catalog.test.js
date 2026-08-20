import assert from "node:assert/strict";
import test from "node:test";

import cameraDb from "../../data/beachcam-cameras.json" with { type: "json" };
import { resolveMeoPlaybackCameras } from "../../src/feed-policy.js";
import {
  createPlaybackCatalog,
  findPlaybackCamera,
  playbackCameraCount
} from "../../worker/playback-catalog.js";

test("playback catalog exactly follows the ordered accepted MEO camera source", () => {
  const expected = resolveMeoPlaybackCameras(cameraDb);
  const catalog = createPlaybackCatalog();

  assert.ok(expected.length > 0);
  assert.deepEqual([...catalog.keys()], expected.map(({ id }) => id));
  assert.deepEqual(
    [...catalog.values()],
    expected.map(({ id, streamUrl }) => ({ id, streamUrl }))
  );
  assert.equal(catalog.size, expected.length);
  assert.equal(playbackCameraCount(), expected.length);

  for (const camera of catalog.values()) {
    assert.deepEqual(Object.keys(camera), ["id", "streamUrl"]);
    assert.equal(Object.isFrozen(camera), true);
    assert.match(
      camera.streamUrl,
      /^https:\/\/video-auth1\.iol\.pt\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i
    );
  }
});

test("catalog copies cannot mutate the module-private catalog", () => {
  const first = createPlaybackCatalog();
  const expectedCount = playbackCameraCount();
  first.clear();

  assert.notEqual(createPlaybackCatalog(), first);
  assert.equal(createPlaybackCatalog().size, expectedCount);
});

test("camera lookup accepts only exact nonblank string IDs", () => {
  assert.deepEqual(findPlaybackCamera("costa-da-caparica-riviera"), {
    id: "costa-da-caparica-riviera",
    streamUrl: "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8"
  });
  assert.equal(findPlaybackCamera("surfline-castelo"), null);
  assert.equal(findPlaybackCamera("../costa-da-caparica-riviera"), null);
  assert.equal(findPlaybackCamera(""), null);
  assert.equal(findPlaybackCamera("   "), null);
  assert.equal(findPlaybackCamera(42), null);
});
