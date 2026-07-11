import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  availableCameras,
  firstClassCameras,
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

test("first class cameras include live feeds and explicit Surfline-only spots", () => {
  const cameras = firstClassCameras(db);
  const castelo = cameras.find((item) => item.id === "surfline-castelo");

  assert.equal(cameras.length, db.withStreams + 1);
  assert.ok(castelo, "Surfline Castelo is visible as a first-class spot");
  assert.equal(castelo.hasStream, false);
  assert.equal(castelo.firstClass, true);
  assert.equal(castelo.provider, "surfline");
  assert.equal(castelo.name, "Costa da Caparica | Costelo (Irmao)");
});

test("first class cameras include promoted streamless spots", () => {
  const cameras = firstClassCameras({ cameras: [
    { id: "live-cam", hasStream: true },
    { id: "promoted-only", hasStream: false, promoted: true }
  ]});

  assert.deepEqual(cameras.map((camera) => camera.id), ["live-cam", "promoted-only"]);
});

test("first class cameras exclude plain streamless spots", () => {
  const cameras = firstClassCameras({ cameras: [
    { id: "plain-streamless", hasStream: false, promoted: false, firstClass: false },
    { id: "explicit-first-class", hasStream: false, firstClass: true }
  ]});

  assert.deepEqual(cameras.map((camera) => camera.id), ["explicit-first-class"]);
});

test("first class cameras include guide-only advice subjects without treating other streamless rows as spots", () => {
  const cameras = firstClassCameras({ cameras: [
    { id: "plain-streamless", hasStream: false },
    { id: "guide-only", adviceGuideOnly: true }
  ]});

  assert.deepEqual(cameras.map((camera) => camera.id), ["guide-only"]);
});

test("loadCameraDb merges private stream overrides into embedded cameras", async () => {
  const streamUrl = "https://cams.surfline.example/castelo/playlist.m3u8";
  const documentRef = {
    querySelector(selector) {
      return selector === "#embeddedCameraDb" ? { textContent: JSON.stringify(db) } : null;
    }
  };
  const fetcher = async (url) => {
    assert.equal(url, "./data/local-stream-overrides.json");
    return {
      ok: true,
      json: async () => ({
        "surfline-castelo": streamUrl
      })
    };
  };

  const loadedDb = await loadCameraDb({ documentRef, fetcher });
  const castelo = loadedDb.cameras.find((camera) => camera.id === "surfline-castelo");

  assert.equal(castelo.streamUrl, streamUrl);
  assert.equal(castelo.hasStream, true);
  assert.equal(availableCameras(loadedDb).some((camera) => camera.id === "surfline-castelo"), true);
});

test("loadCameraDb treats missing private stream overrides as optional", async () => {
  const documentRef = {
    querySelector(selector) {
      return selector === "#embeddedCameraDb" ? { textContent: JSON.stringify(db) } : null;
    }
  };
  const fetcher = async () => ({
    ok: false,
    status: 404,
    json: async () => {
      throw new Error("not found");
    }
  });

  const loadedDb = await loadCameraDb({ documentRef, fetcher });
  const castelo = loadedDb.cameras.find((camera) => camera.id === "surfline-castelo");

  assert.equal(castelo.streamUrl, "");
  assert.equal(castelo.hasStream, false);
});

test("default favorites exist and only live-source favorites require streams", () => {
  for (const id of DEFAULT_FAVORITE_IDS) {
    const camera = db.cameras.find((item) => item.id === id);
    assert.ok(camera, `${id} exists in DB`);
    if (camera.provider !== "surfline") {
      assert.equal(camera.hasStream, true, `${id} has an available feed`);
    }
  }

  assert.ok(DEFAULT_FAVORITE_IDS.includes("surfline-castelo"));

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

test("mergePromotedSpots carries forward stream override fields on collision", () => {
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
  assert.equal(merged.streamUrl, "https://hls.example/castelo.m3u8");
  assert.equal(merged.hasStream, true);
  assert.equal(merged.image, "https://img.example/castelo.jpg");
  assert.equal(merged.streamOverride, true);
});

test("mergePromotedSpots leaves stream-less promoted records report-only", () => {
  const cameraDb = { cameras: [{ id: "cam-1", name: "Cam 1" }] };
  const promotedDb = { promoted: [{ id: "surfline-coxos", name: "Coxos", promoted: true, hasStream: false }] };
  const merged = mergePromotedSpots(cameraDb, promotedDb).cameras.find((c) => c.id === "surfline-coxos");
  assert.equal(merged.hasStream, false);
  assert.equal(merged.streamUrl ?? "", "");
});
