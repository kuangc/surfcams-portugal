import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import {
  estimateDrivingMinutes,
  findDriveEstimate,
  findSurflineMatches,
  haversineKm,
  normalizeSpotData
} from "../src/spot-data.js";

const surflineDb = JSON.parse(fs.readFileSync("data/surfline-spots.json", "utf8"));
const meoDb = JSON.parse(fs.readFileSync("data/meo-spots.json", "utf8"));
const mappingDb = JSON.parse(fs.readFileSync("data/meo-surfline-matches.json", "utf8"));
const driveDb = JSON.parse(fs.readFileSync("data/lisbon-drive-estimates.json", "utf8"));
const normalized = normalizeSpotData({ surflineDb, meoDb, mappingDb, driveDb });

test("surfline database stores static metadata plus refresh concepts", () => {
  const saoPedro = surflineDb.spots.find((spot) => spot.id === "surfline-sao-pedro-do-estoril");

  assert.ok(saoPedro);
  assert.equal(saoPedro.provider, "surfline");
  assert.match(saoPedro.url, /surfline\.com\/surf-report\/s-o-pedro-do-estoril/);
  assert.equal(Number.isFinite(saoPedro.lat), true);
  assert.equal(Number.isFinite(saoPedro.lon), true);
  assert.ok(saoPedro.staticMetadata.breadcrumb.includes("Cascais Municipality"));
  assert.ok(saoPedro.refreshConcepts.daily.includes("tideExtremes"));
  assert.ok(saoPedro.refreshConcepts.daily.includes("sunriseSunset"));
  assert.ok(saoPedro.refreshConcepts.hourly.includes("conditionRating"));
  assert.ok(saoPedro.refreshConcepts.hourly.includes("swellComponents"));
});

test("normalized meo database mirrors the current camera index", () => {
  assert.equal(meoDb.provider, "meo-beachcam");
  assert.equal(meoDb.spots.length, 189);

  const favoriteIds = new Set(meoDb.spots.map((spot) => spot.id));
  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(favoriteIds.has(id), `${id} exists in normalized MEO spots`);
  }

  const sesimbra = meoDb.spots.find((spot) => spot.id === "praia-sesimbra");
  assert.equal(sesimbra.dynamicConcepts.hourly.includes("waveHeight"), true);
  assert.equal(sesimbra.staticMetadata.providerPageType, "beachcam-livecam");
});

test("mapping links default favorites to one or more surfline spots", () => {
  const mappedMeoIds = new Set(mappingDb.matches.map((match) => match.meoSpotId));

  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(mappedMeoIds.has(id), `${id} has Surfline mappings`);
  }

  const caparica = mappingDb.matches.find((match) => match.meoSpotId === "costa-da-caparica-riviera");
  assert.ok(caparica.surflineSpotIds.includes("surfline-costa-da-caparica"));
  assert.ok(caparica.surflineSpotIds.includes("surfline-fonte-da-telha"));
  assert.equal(caparica.proposedCloseRule, "exact-or-nearby-surfline-spots-for-same-outing");
});

test("spot-data helpers resolve matches and Lisbon drive estimates", () => {
  const camera = { id: "sao-pedro-do-estoril" };
  const matches = findSurflineMatches(camera, normalized);
  const drive = findDriveEstimate(camera, normalized);

  assert.deepEqual(matches.map((match) => match.id).slice(0, 2), [
    "surfline-sao-pedro-do-estoril",
    "surfline-carcavelos"
  ]);
  assert.equal(drive.label, "~45m");
  assert.equal(drive.distanceLabel, "~25km");
  assert.equal(drive.origin.label, "Central Lisbon");
});

test("driving heuristic is deterministic for central Lisbon distances", () => {
  const cascaisDistance = haversineKm(
    { lat: 38.7223, lon: -9.1393 },
    { lat: 38.693546, lon: -9.368644 }
  );

  assert.equal(Math.round(cascaisDistance), 20);
  assert.equal(estimateDrivingMinutes(cascaisDistance, "urban-coast"), 45);
});
