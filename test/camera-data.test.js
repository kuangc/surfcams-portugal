import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  availableCameras,
  loadCameraDb,
  mergePromotedSpots
} from "../src/camera-data.js";
import { DEFAULT_FAVORITE_IDS, INITIAL_BOUNDS_IDS } from "../src/config.js";

const db = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));

test("camera database contains the expected indexed live feeds", () => {
  const liveCameras = availableCameras(db);

  assert.equal(db.total, 190);
  assert.equal(db.withCoordinates, 190);
  assert.equal(db.withStreams, 147);
  assert.equal(liveCameras.length, db.withStreams);
  assert.equal(liveCameras.every((camera) => camera.hasStream), true);
});

test("loadCameraDb returns immutable provider data without consulting stream overrides", async () => {
  const documentRef = {
    querySelector(selector) {
      return selector === "#embeddedCameraDb" ? { textContent: JSON.stringify(db) } : null;
    }
  };
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        "surfline-castelo": "https://hls.cdn-surfline.com/castelo/playlist.m3u8",
        __rawSurflineFeeds: [{
          id: "pt-castelo",
          streamUrl: "https://hls.cdn-surfline.com/pt-castelo/playlist.m3u8"
        }]
      })
    };
  };

  const loadedDb = await loadCameraDb({ documentRef, fetcher });
  const castelo = loadedDb.cameras.find((camera) => camera.id === "surfline-castelo");

  assert.equal(fetchCalls, 0);
  assert.equal(castelo.streamUrl, "");
  assert.equal(castelo.hasStream, false);
  assert.equal(Object.hasOwn(loadedDb, "localStreamOverrides"), false);
  assert.deepEqual(loadedDb, db);
});

test("default favorites are all playable native MEO cameras", () => {
  for (const id of DEFAULT_FAVORITE_IDS) {
    const camera = db.cameras.find((item) => item.id === id);
    assert.ok(camera, `${id} exists in DB`);
    assert.notEqual(camera.provider, "surfline", `${id} is not a Surfline camera identity`);
    assert.equal(camera.hasStream, true, `${id} has an available feed`);
  }

  assert.equal(DEFAULT_FAVORITE_IDS.includes("surfline-castelo"), false);
  assert.ok(DEFAULT_FAVORITE_IDS.includes("costa-da-caparica-riviera"));

  const lagide = db.cameras.find((item) => item.id === "lagide-e-baia");
  assert.equal(lagide.name.trim(), "Peniche | Lagide | Cantinho da baía");
});

test("initial map bounds have the requested north and south anchors", () => {
  for (const id of INITIAL_BOUNDS_IDS) {
    const camera = db.cameras.find((item) => item.id === id);
    assert.ok(camera, `${id} exists in DB`);
    assert.equal(Number.isFinite(camera.lat), true, `${id} has latitude`);
    assert.equal(Number.isFinite(camera.lon), true, `${id} has longitude`);
  }

  assert.ok(INITIAL_BOUNDS_IDS.includes("peniche-baleal-panoramica"));
  assert.ok(INITIAL_BOUNDS_IDS.includes("praia-sesimbra"));
});

test("mergePromotedSpots appends and overrides on id collision", () => {
  const cameraDb = { cameras: [
    { id: "cam-1", name: "Cam 1" },
    { id: "surfline-castelo", name: "old embedded hack", hasStream: false }
  ]};
  const promotedDb = { promoted: [
    { id: "surfline-castelo", name: "Castelo", promoted: true, camCoverage: "spot" },
    { id: "surfline-coxos", name: "Coxos", promoted: true, camCoverage: "spot" }
  ]};
  const out = mergePromotedSpots(cameraDb, promotedDb);
  assert.equal(out.cameras.length, 3);
  assert.equal(out.cameras.find((c) => c.id === "surfline-castelo").promoted, true);
  assert.equal(out.cameras.find((c) => c.id === "surfline-castelo").name, "Castelo");
});

test("mergePromotedSpots tolerates missing promotedDb", () => {
  const cameraDb = { cameras: [{ id: "cam-1" }] };
  assert.equal(mergePromotedSpots(cameraDb, null).cameras.length, 1);
});

test("mergePromotedSpots cannot carry a legacy playback override into a promoted subject", () => {
  const cameraDb = { cameras: [
    { id: "surfline-castelo", name: "old embedded", hasStream: true, streamUrl: "https://hls.example/castelo.m3u8",
      image: "https://img.example/castelo.jpg", streamOverride: true, livecamId: "", videoId: "" }
  ]};
  const promotedDb = { promoted: [
    { id: "surfline-castelo", name: "Castelo", promoted: true, hasStream: false, camCoverage: "spot", linkedCamId: "riviera" }
  ]};
  const merged = mergePromotedSpots(cameraDb, promotedDb).cameras.find((c) => c.id === "surfline-castelo");
  assert.equal(merged.promoted, true);
  assert.equal(merged.name, "Castelo");
  assert.equal(merged.streamUrl ?? "", "");
  assert.equal(merged.hasStream, false);
  assert.equal(Object.hasOwn(merged, "streamOverride"), false);
});

test("mergePromotedSpots leaves unresolved promoted records streamless for feed policy", () => {
  const cameraDb = { cameras: [{ id: "cam-1", name: "Cam 1" }] };
  const promotedDb = { promoted: [{ id: "surfline-coxos", name: "Coxos", promoted: true, hasStream: false }] };
  const merged = mergePromotedSpots(cameraDb, promotedDb).cameras.find((c) => c.id === "surfline-coxos");
  assert.equal(merged.hasStream, false);
  assert.equal(merged.streamUrl ?? "", "");
});
