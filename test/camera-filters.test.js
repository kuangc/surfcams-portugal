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

const scoredCameras = [
  {
    id: "good-clean",
    name: "Good Clean",
    location: "CASCAIS",
    region: "cascais",
    forecast: { wave: "1.0 m", wind: "6Km/h", windDirection: "north" },
    detailMetrics: { "Período das ondas": "10s" }
  },
  {
    id: "too-big",
    name: "Too Big",
    location: "CASCAIS",
    region: "cascais",
    forecast: { wave: "2.2 m", wind: "26Km/h", windDirection: "south" },
    detailMetrics: { "Período das ondas": "4s" }
  },
  {
    id: "also-good",
    name: "Also Good",
    location: "PENICHE",
    region: "peniche",
    forecast: { wave: "1.2 m", wind: "9Km/h", windDirection: "east" },
    detailMetrics: { "Período das ondas": "8s" }
  }
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

test("filterCameras can show only recommended surf and sort best first", () => {
  const result = filterCameras(scoredCameras, {
    surfFitOnly: true,
    sortBySurfFit: true
  });

  assert.deepEqual(result.map((camera) => camera.id), ["good-clean", "also-good"]);
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
