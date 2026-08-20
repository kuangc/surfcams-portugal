import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { mergeAdviceGuideSubjects, mergePromotedSpots } from "../src/camera-data.js";
import { resolveMeoPlaybackCameras } from "../src/feed-policy.js";
import { normalizeSpotAdviceRuntime } from "../src/spot-advice.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

function isProviderMeoStream(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "video-auth1.iol.pt"
      && !url.username
      && !url.password
      && !url.port;
  } catch {
    return false;
  }
}

function nativeCamera(overrides = {}) {
  return {
    id: "meo-alpha",
    name: "  Alpha   Beach  ",
    location: "  CASCAIS  ",
    region: "  lisboa  ",
    lat: 38.7,
    lon: -9.4,
    image: "  http://beachcam.meo.pt/media/alpha.jpg  ",
    poster: "https://camstills.cdn-surfline.com/alpha/latest_small.jpg",
    streamUrl: "  https://video-auth1.iol.pt/beachcam/alpha/playlist.m3u8  ",
    livecamId: " 42 ",
    hasStream: true,
    surfMetadata: { surflineSpotId: "surfline-alpha" },
    ...overrides
  };
}

function distinctNativeCamera(id, overrides = {}) {
  return nativeCamera({
    id,
    livecamId: `feed-${id}`,
    streamUrl: `https://video-auth1.iol.pt/beachcam/${id}/playlist.m3u8`,
    ...overrides
  });
}

test("MEO playback keeps provider-native identity and ignores every Surfline or override path", () => {
  const trusted = nativeCamera();
  const database = { cameras: [
    trusted,
    distinctNativeCamera("promoted", { promoted: true, linkedCamId: trusted.id }),
    distinctNativeCamera("guide", { adviceGuideOnly: true }),
    distinctNativeCamera("provider-surfline", { provider: "Surfline" }),
    distinctNativeCamera("promoted-provider", { provider: "surfline-promoted" }),
    distinctNativeCamera("top-level-override", {
      streamOverride: true,
      streamUrl: "https://hls.cdn-surfline.com/override/playlist.m3u8"
    }),
    distinctNativeCamera("reported-offline", { hasStream: false }),
    distinctNativeCamera("streamless", { streamUrl: "" }),
    distinctNativeCamera("insecure-stream", { streamUrl: "http://video-auth1.iol.pt/beachcam/insecure/playlist.m3u8" }),
    distinctNativeCamera("unlabeled-surfline-stream", { streamUrl: "https://hls.cdn-surfline.com/raw/playlist.m3u8" }),
    distinctNativeCamera("lookalike-meo-host", { streamUrl: "https://video-auth1.iol.pt.evil.test/live.m3u8" }),
    distinctNativeCamera("credentialed-meo-stream", { streamUrl: "https://user@video-auth1.iol.pt/live.m3u8" }),
    distinctNativeCamera("ported-meo-stream", { streamUrl: "https://video-auth1.iol.pt:444/live.m3u8" }),
    distinctNativeCamera("wrong-meo-path", { streamUrl: "https://video-auth1.iol.pt/not-a-provider-feed/playlist.m3u8" }),
    distinctNativeCamera("query-bearing-stream", { streamUrl: "https://video-auth1.iol.pt/beachcam/query/playlist.m3u8?token=secret" }),
    distinctNativeCamera("fragment-bearing-stream", { streamUrl: "https://video-auth1.iol.pt/beachcam/fragment/playlist.m3u8#camera" }),
    distinctNativeCamera("bad-id/segment"),
    distinctNativeCamera("blank-name", { name: "  " }),
    distinctNativeCamera("blank-location", { location: "  " }),
    distinctNativeCamera("blank-region", { region: "  " }),
    distinctNativeCamera("bad-lat", { lat: 91 }),
    distinctNativeCamera("bad-lon", { lon: -181 })
  ] };
  const before = structuredClone(database);
  const { poster: _untrustedPoster, ...trustedWithoutPoster } = trusted;

  // A legacy raw registry is deliberately passed as a second argument. The
  // MEO-only API must not inspect it or substitute any provider-owned fields.
  const resolved = resolveMeoPlaybackCameras(database, {
    "meo-alpha": "https://hls.cdn-surfline.com/top-level/playlist.m3u8",
    __rawSurflineFeeds: [{
      id: "pt-alpha",
      streamUrl: "https://hls.cdn-surfline.com/raw/playlist.m3u8"
    }]
  });

  assert.deepEqual(database, before);
  assert.deepEqual(resolved, [{
    ...trustedWithoutPoster,
    name: "Alpha Beach",
    location: "CASCAIS",
    region: "lisboa",
    image: "https://beachcam.meo.pt/media/alpha.jpg",
    streamUrl: "https://video-auth1.iol.pt/beachcam/alpha/playlist.m3u8",
    livecamId: "42",
    streamSource: "meo",
    feedCameraId: "42",
    hasStream: true
  }]);
  assert.equal(Object.hasOwn(resolved[0], "poster"), false);
});

test("MEO playback emits one row per logical id and physical feed id or URL", () => {
  const first = nativeCamera({ id: "first", livecamId: "101" });
  const resolved = resolveMeoPlaybackCameras({ cameras: [
    first,
    nativeCamera({ id: "duplicate-id", livecamId: "101", streamUrl: "https://video-auth1.iol.pt/beachcam/other/playlist.m3u8" }),
    nativeCamera({ id: "duplicate-url", livecamId: "102", streamUrl: first.streamUrl }),
    nativeCamera({
      id: "canonical-duplicate-url",
      livecamId: "104",
      streamUrl: first.streamUrl.replace("video-auth1.iol.pt", "VIDEO-AUTH1.IOL.PT")
    }),
    nativeCamera({ id: "first", livecamId: "103", streamUrl: "https://video-auth1.iol.pt/beachcam/id-duplicate/playlist.m3u8" }),
    nativeCamera({ id: "fallback-feed-id", livecamId: "", streamUrl: "https://video-auth1.iol.pt/beachcam/unique/playlist.m3u8" })
  ] });

  assert.deepEqual(resolved.map(({ id, feedCameraId }) => ({ id, feedCameraId })), [
    { id: "first", feedCameraId: "101" },
    { id: "fallback-feed-id", feedCameraId: "fallback-feed-id" }
  ]);
  assert.equal(new Set(resolved.map((camera) => camera.id)).size, resolved.length);
  assert.equal(new Set(resolved.map((camera) => camera.feedCameraId)).size, resolved.length);
  assert.equal(new Set(resolved.map((camera) => camera.streamUrl)).size, resolved.length);
});

test("the real playback roster is exactly the unique provider-native playable set", () => {
  const cameraDb = readJson("data/beachcam-cameras.json");
  const promotedDb = readJson("data/promoted-spots.json");
  const resolved = resolveMeoPlaybackCameras(cameraDb);
  const expectedNative = cameraDb.cameras.filter((camera) => (
    camera.hasStream === true
    && isProviderMeoStream(camera.streamUrl)
    && !camera.promoted
    && !camera.adviceGuideOnly
    && !camera.streamOverride
    && !String(camera.provider || "").toLowerCase().startsWith("surfline")
  ));

  assert.deepEqual(
    new Set(resolved.map((camera) => camera.id)),
    new Set(expectedNative.map((camera) => camera.id))
  );
  assert.equal(resolved.length, expectedNative.length);
  assert.equal(new Set(resolved.map((camera) => camera.feedCameraId)).size, resolved.length);
  assert.equal(new Set(resolved.map((camera) => camera.streamUrl)).size, resolved.length);
  assert.equal(resolved.every((camera) => camera.streamSource === "meo"), true);

  const expectedById = new Map(cameraDb.cameras.map((camera) => [camera.id, camera]));
  const resolvedById = new Map(resolved.map((camera) => [camera.id, camera]));
  for (const id of [
    "costa-da-caparica-riviera",
    "santo-amaro",
    "praia-da-nazare",
    "lagide-e-baia",
    "costa-da-caparica-cds"
  ]) {
    const source = expectedById.get(id);
    const playback = resolvedById.get(id);
    assert.ok(playback, `${id} remains playable`);
    assert.deepEqual({
      id: playback.id,
      name: playback.name,
      location: playback.location,
      lat: playback.lat,
      lon: playback.lon,
      image: playback.image,
      streamUrl: playback.streamUrl,
      feedCameraId: playback.feedCameraId
    }, {
      id: source.id,
      name: source.name.trim().replace(/\s+/g, " "),
      location: source.location.trim().replace(/\s+/g, " "),
      lat: source.lat,
      lon: source.lon,
      image: source.image.trim().replace(/^http:/, "https:"),
      streamUrl: source.streamUrl.trim(),
      feedCameraId: source.livecamId.trim()
    });
  }

  const representativeNativeIds = new Set([
    "costa-da-caparica-riviera",
    "santo-amaro",
    "praia-da-nazare",
    "lagide-e-baia",
    "costa-da-caparica-cds"
  ]);
  const aliases = promotedDb.promoted.filter((row) => representativeNativeIds.has(row.linkedCamId));
  assert.ok(aliases.length > 0, "fixture still exercises promoted Surfline aliases");
  assert.deepEqual(
    aliases.map((row) => row.id).filter((id) => resolvedById.has(id)),
    []
  );
  assert.equal(resolvedById.get("costa-da-caparica-riviera").name, "Costa de Caparica | Riviera");
  assert.equal(resolvedById.get("santo-amaro").name, "Santo Amaro");
  assert.equal(resolvedById.get("praia-da-nazare").name, "Nazaré | Praia da Vila");
  assert.equal(resolvedById.get("lagide-e-baia").name, "Peniche | Lagide | Cantinho da baía");
  assert.equal(resolvedById.get("costa-da-caparica-cds").name, "Costa de Caparica | CDS SUL");
});

test("Surfline advice subjects remain canonical but cannot become playback identities", () => {
  const cameraDb = readJson("data/beachcam-cameras.json");
  const promotedDb = readJson("data/promoted-spots.json");
  const advice = normalizeSpotAdviceRuntime(readJson("data/spot-advice-resolved.json"));
  const canonicalDb = mergeAdviceGuideSubjects(
    mergePromotedSpots(cameraDb, promotedDb),
    advice
  );
  const canonicalIds = new Set(canonicalDb.cameras.map((camera) => camera.id));
  const playbackIds = new Set(resolveMeoPlaybackCameras(cameraDb).map((camera) => camera.id));

  for (const id of advice.identityReport.selectedSurflineIds) {
    assert.equal(canonicalIds.has(id), true, `${id} remains available to Surfline intelligence`);
  }
  assert.equal([...playbackIds].some((id) => id.startsWith("surfline-")), false);
  assert.equal(playbackIds.has("surfline-cave"), false);
  assert.equal(playbackIds.has("surfline-praia-da-ursa"), false);
});
