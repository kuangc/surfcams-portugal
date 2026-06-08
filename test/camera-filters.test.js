import assert from "node:assert/strict";
import test from "node:test";

import {
  camerasForInitialBounds,
  filterCameras,
  firstCameraById,
  uniqueSortedRegions
} from "../src/camera-filters.js";

const cameras = [
  { id: "lagide-e-baia", name: "Peniche | Lagide | Cantinho da baía", location: "PENICHE", region: "peniche" },
  { id: "praia-sesimbra", name: "Praia Sesimbra", location: "SESIMBRA", region: "sesimbra" },
  { id: "fonte-da-telha", name: "Fonte da Telha | Norte", location: "ALMADA", region: "almada" }
];

test("filterCameras combines search, region, and favorites", () => {
  const result = filterCameras(cameras, {
    query: "lagide",
    region: "peniche",
    favoriteOnly: true,
    favoriteIds: new Set(["lagide-e-baia", "praia-sesimbra"])
  });

  assert.deepEqual(result.map((camera) => camera.id), ["lagide-e-baia"]);
});

test("uniqueSortedRegions returns stable region options", () => {
  assert.deepEqual(uniqueSortedRegions(cameras), ["almada", "peniche", "sesimbra"]);
});

test("camerasForInitialBounds preserves configured camera order", () => {
  const result = camerasForInitialBounds(
    cameras,
    ["fonte-da-telha", "missing"],
    ["lagide-e-baia", "praia-sesimbra"]
  );

  assert.deepEqual(result.map((camera) => camera.id), ["fonte-da-telha", "lagide-e-baia", "praia-sesimbra"]);
});

test("firstCameraById returns the first available configured camera", () => {
  assert.equal(firstCameraById(cameras, ["missing", "praia-sesimbra"]).id, "praia-sesimbra");
  assert.equal(firstCameraById(cameras, ["missing"]), null);
});

test("filterCameras can show only tentative might-be-good cameras", () => {
  const result = filterCameras([
    { id: "good", name: "Good", region: "cascais", rating: { isRecommended: true } },
    { id: "poor", name: "Poor", region: "cascais", rating: { isRecommended: false } }
  ], {
    mightBeGoodOnly: true,
    isMightBeGood(camera) {
      return camera.rating.isRecommended;
    }
  });

  assert.deepEqual(result.map((camera) => camera.id), ["good"]);
});
