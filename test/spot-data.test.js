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
const mappingReview = JSON.parse(fs.readFileSync("data/surfline-mapping-review.json", "utf8"));
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
  assert.equal(meoDb.spots.length, 190);

  const favoriteIds = new Set(meoDb.spots.map((spot) => spot.id));
  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(favoriteIds.has(id), `${id} exists in normalized MEO spots`);
  }

  const sesimbra = meoDb.spots.find((spot) => spot.id === "praia-sesimbra");
  assert.equal(sesimbra.dynamicConcepts.hourly.includes("waveHeight"), true);
  assert.equal(sesimbra.staticMetadata.providerPageType, "beachcam-livecam");

  const castelo = meoDb.spots.find((spot) => spot.id === "surfline-castelo");
  assert.equal(castelo.provider, "surfline");
  assert.equal(castelo.staticMetadata.providerPageType, "surfline-report");
});

test("mapping links default favorites to one or more surfline spots", () => {
  const mappedMeoIds = new Set(mappingDb.matches.map((match) => match.meoSpotId));

  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(mappedMeoIds.has(id), `${id} has Surfline mappings`);
  }

  const caparica = mappingDb.matches.find((match) => match.meoSpotId === "costa-da-caparica-riviera");
  assert.ok(caparica.surflineSpotIds.includes("surfline-costa-da-caparica"));
  assert.ok(caparica.surflineSpotIds.includes("surfline-praia-da-rainha"));
  assert.ok(caparica.surflineSpotIds.includes("surfline-fonte-da-telha"));
  assert.equal(caparica.proposedCloseRule, "exact-or-nearby-surfline-spots-for-same-outing");
});

test("Caparica Surfline data includes reviewed Costa and Praia da Rainha pages", () => {
  const caparica = surflineDb.spots.find((spot) => spot.id === "surfline-costa-da-caparica");
  const rainha = surflineDb.spots.find((spot) => spot.id === "surfline-praia-da-rainha");

  assert.equal(
    caparica.url,
    "https://www.surfline.com/surf-report/costa-da-caparica/5842041f4e65fad6a7708e65?camId=60956af96fe5bbe4ad8557fc"
  );
  assert.ok(rainha);
  assert.equal(rainha.url, "https://www.surfline.com/surf-report/praia-da-rainha/602d65b2c30216a5fdf26598");
  assert.ok(rainha.staticMetadata.breadcrumb.includes("Costa de Caparica"));

  const riviera = mappingDb.matches.find((match) => match.meoSpotId === "costa-da-caparica-riviera");
  assert.deepEqual(riviera.surflineSpotIds.slice(0, 3), [
    "surfline-praia-da-rainha",
    "surfline-castelo",
    "surfline-praia-do-barbas"
  ]);

  const caparicaCds = mappingDb.matches.find((match) => match.meoSpotId === "costa-da-caparica");
  assert.equal(caparicaCds.surflineSpotIds[0], "surfline-costa-da-caparica");
  assert.ok(caparicaCds.surflineSpotIds.includes("surfline-praia-da-rainha"));
});

test("Caparica Surfline data includes the Castelo Irmao page metadata", () => {
  const castelo = surflineDb.spots.find((spot) => spot.id === "surfline-castelo");

  assert.ok(castelo);
  assert.equal(castelo.name, "Costa da Caparica | Costelo (Irmao)");
  assert.equal(castelo.url, "https://www.surfline.com/surf-report/castelo/584204204e65fad6a77099d8");
  assert.equal(castelo.lat, 38.6131034);
  assert.equal(castelo.lon, -9.2161894);
  assert.equal(castelo.region, "Almada");
  assert.deepEqual(castelo.staticMetadata.breadcrumb, [
    "Portugal",
    "Setúbal",
    "Almada Municipality",
    "Costa de Caparica",
    "Castelo"
  ]);
  assert.match(castelo.staticMetadata.guideSummary, /sandy.*bay/i);
  assert.ok(castelo.staticMetadata.nearbySpotNames.includes("Praia da Rainha"));
  assert.ok(castelo.staticMetadata.nearbySpotNames.includes("Fonte da Telha"));
  assert.ok(castelo.refreshConcepts.hourly.includes("conditionRating"));

  const riviera = mappingDb.matches.find((match) => match.meoSpotId === "costa-da-caparica-riviera");
  assert.deepEqual(riviera.surflineSpotIds.slice(0, 3), [
    "surfline-praia-da-rainha",
    "surfline-castelo",
    "surfline-praia-do-barbas"
  ]);
});

test("Surfline mapping review artifact exposes cached page titles", () => {
  const pageById = new Map(mappingReview.pages.map((page) => [page.id, page]));
  const mappingByMeoId = new Map(mappingReview.mappings.map((mapping) => [mapping.meoSpotId, mapping]));
  const caparica = pageById.get("surfline-costa-da-caparica");
  const rainha = pageById.get("surfline-praia-da-rainha");
  const riviera = mappingByMeoId.get("costa-da-caparica-riviera");

  assert.equal(mappingReview.schemaVersion, 1);
  assert.match(caparica.extractedTitle, /Costa da Caparica/);
  assert.equal(caparica.titleSource, "h1");
  assert.ok(caparica.cachePath.endsWith(".cache/surfline/pages/surfline-costa-da-caparica.html"));
  assert.match(rainha.extractedTitle, /Praia da Rainha/);
  assert.equal(rainha.titleSource, "h1");
  assert.deepEqual(riviera.surflineMatches.map((match) => match.id).slice(0, 2), [
    "surfline-praia-da-rainha",
    "surfline-praia-do-barbas"
  ]);
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
