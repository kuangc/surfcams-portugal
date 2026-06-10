import assert from "node:assert/strict";
import test from "node:test";

import {
  camerasForInitialBounds,
  camerasInBounds,
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

test("camerasInBounds returns only cameras visible inside map bounds", () => {
  const result = camerasInBounds([
    { id: "visible", lat: 38.7, lon: -9.35 },
    { id: "outside", lat: 41.1, lon: -8.7 },
    { id: "missing-lat", lon: -9.3 },
    { id: "missing-lon", lat: 38.7 }
  ], {
    contains([lat, lon]) {
      return lat >= 38.5 && lat <= 39 && lon >= -9.5 && lon <= -9;
    }
  });

  assert.deepEqual(result.map((camera) => camera.id), ["visible"]);
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

test("filterCameras can narrow manage spots by saved status and stream availability", () => {
  const result = filterCameras([
    { id: "carcavelos", name: "Carcavelos", location: "CASCAIS", region: "cascais", hasStream: true },
    { id: "guincho", name: "Guincho", location: "CASCAIS", region: "cascais", hasStream: false },
    { id: "matosinhos", name: "Matosinhos", location: "PORTO", region: "norte", hasStream: true }
  ], {
    query: "cascais",
    region: "cascais",
    favoriteIds: new Set(["guincho"]),
    favoriteStatus: "not-favorites",
    streamStatus: "live"
  });

  assert.deepEqual(result.map((camera) => camera.id), ["carcavelos"]);
});

test("filterCameras supports manage spot sort orders", () => {
  const sortableCameras = [
    {
      id: "praia-da-barra",
      name: "Praia da Barra",
      location: "AVEIRO",
      region: "centro",
      clicks: 80,
      forecast: { wave: "2.0 m" },
      rating: { key: "caution" }
    },
    {
      id: "carcavelos",
      name: "Carcavelos",
      location: "CASCAIS",
      region: "cascais",
      clicks: 225,
      forecast: { wave: "1.4 m" },
      rating: { key: "good" }
    },
    {
      id: "matosinhos",
      name: "Matosinhos",
      location: "PORTO",
      region: "norte",
      clicks: 160,
      forecast: { wave: "2.1 m" },
      rating: { key: "poor" }
    }
  ];

  const favoriteIds = new Set(["matosinhos"]);
  const idsForSort = (sort) => filterCameras(sortableCameras, {
    favoriteIds,
    sort,
    getConditionRank(camera) {
      return camera.rating.key;
    }
  }).map((camera) => camera.id);

  assert.deepEqual(idsForSort("favorites"), ["matosinhos", "carcavelos", "praia-da-barra"]);
  assert.deepEqual(idsForSort("popular"), ["carcavelos", "matosinhos", "praia-da-barra"]);
  assert.deepEqual(idsForSort("wave"), ["matosinhos", "praia-da-barra", "carcavelos"]);
  assert.deepEqual(idsForSort("fit"), ["carcavelos", "praia-da-barra", "matosinhos"]);
  assert.deepEqual(idsForSort("region"), ["carcavelos", "praia-da-barra", "matosinhos"]);
});

test("filterCameras supports nearest-distance sorting and max-distance filtering", () => {
  const sortableCameras = [
    { id: "peniche", name: "Peniche", location: "PENICHE", region: "peniche" },
    { id: "carcavelos", name: "Carcavelos", location: "CASCAIS", region: "cascais" },
    { id: "sesimbra", name: "Sesimbra", location: "SESIMBRA", region: "sesimbra" },
    { id: "unknown", name: "Unknown", location: "UNKNOWN", region: "unknown" }
  ];
  const distances = new Map([
    ["peniche", 85],
    ["carcavelos", 24],
    ["sesimbra", 42]
  ]);
  const getDriveDistanceKm = (camera) => distances.get(camera.id);

  const nearest = filterCameras(sortableCameras, {
    sort: "distance",
    getDriveDistanceKm
  });
  const within50 = filterCameras(sortableCameras, {
    maxDistanceKm: 50,
    sort: "distance",
    getDriveDistanceKm
  });

  assert.deepEqual(nearest.map((camera) => camera.id), ["carcavelos", "sesimbra", "peniche", "unknown"]);
  assert.deepEqual(within50.map((camera) => camera.id), ["carcavelos", "sesimbra"]);
});
