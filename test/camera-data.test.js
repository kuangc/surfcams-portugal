import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { availableCameras } from "../src/camera-data.js";
import { DEFAULT_FAVORITE_IDS, INITIAL_BOUNDS_IDS } from "../src/config.js";

const db = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));

test("camera database contains the expected indexed live feeds", () => {
  const liveCameras = availableCameras(db);

  assert.equal(db.total, 189);
  assert.equal(db.withCoordinates, 189);
  assert.equal(db.withStreams, 147);
  assert.equal(liveCameras.length, db.withStreams);
  assert.equal(liveCameras.every((camera) => camera.hasStream), true);
});

test("default favorites exist and have available streams", () => {
  for (const id of DEFAULT_FAVORITE_IDS) {
    const camera = db.cameras.find((item) => item.id === id);
    assert.ok(camera, `${id} exists in DB`);
    assert.equal(camera.hasStream, true, `${id} has an available feed`);
  }

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

