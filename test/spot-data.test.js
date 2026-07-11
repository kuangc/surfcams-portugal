import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS, SPOT_ADVICE_URL } from "../src/config.js";
import {
  CENTRAL_LISBON,
  applyCoastExposuresToCameraDb,
  applySpotMetadataToCameraDb,
  estimateDrivingMinutes,
  findDriveEstimate,
  findSurflineMatches,
  haversineKm,
  loadSpotData,
  normalizeSpotData
} from "../src/spot-data.js";

const surflineDb = JSON.parse(fs.readFileSync("data/surfline-spots.json", "utf8"));
const meoDb = JSON.parse(fs.readFileSync("data/meo-spots.json", "utf8"));
const mappingDb = JSON.parse(fs.readFileSync("data/meo-surfline-matches.json", "utf8"));
const driveDb = JSON.parse(fs.readFileSync("data/lisbon-drive-estimates.json", "utf8"));
const coastExposureDb = JSON.parse(fs.readFileSync("data/coast-exposures.json", "utf8"));
const spotMetadataDb = fs.existsSync("data/spot-metadata-enrichment.json")
  ? JSON.parse(fs.readFileSync("data/spot-metadata-enrichment.json", "utf8"))
  : null;
const needsReviewHtml = fs.existsSync("docs/surfline-needs-review.html")
  ? fs.readFileSync("docs/surfline-needs-review.html", "utf8")
  : "";
const mappingReview = JSON.parse(fs.readFileSync("data/surfline-mapping-review.json", "utf8"));
const normalized = normalizeSpotData({ surflineDb, meoDb, mappingDb, driveDb, coastExposureDb, spotMetadataDb });

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

test("surfline database covers provider spots within 100km of Lisbon", () => {
  assert.deepEqual(surflineDb.coverage.origin, {
    label: "Central Lisbon",
    lat: 38.7223,
    lon: -9.1393
  });
  assert.equal(surflineDb.coverage.radiusKm, 100);
  assert.ok(surflineDb.spots.length >= 70);
  assert.equal(
    surflineDb.spots.every((spot) => spot.distanceFromLisbonKm <= 100),
    true
  );

  for (const id of [
    "surfline-praia-da-cruz-quebrada",
    "surfline-sao-joao-da-caparica",
    "surfline-nazare",
    "surfline-sao-torpes"
  ]) {
    assert.ok(surflineDb.spots.some((spot) => spot.id === id), `${id} is covered`);
  }
});

test("surfline database preserves native provider metadata for surf decisions", () => {
  const carcavelos = surflineDb.spots.find((spot) => spot.id === "surfline-carcavelos");
  const lagide = surflineDb.spots.find((spot) => spot.id === "surfline-lagide");

  assert.ok(carcavelos.staticMetadata.travelDetails.best.windDirection.value.includes("N"));
  assert.ok(carcavelos.staticMetadata.travelDetails.best.swellDirection.value.includes("W"));
  assert.deepEqual(carcavelos.staticMetadata.travelDetails.bottom.value, ["Sand"]);
  assert.ok(carcavelos.staticMetadata.breakType.includes("Beach_Break"));
  assert.ok(["Offshore", "Onshore", "Cross-shore"].includes(carcavelos.currentSnapshot.wind.directionType));
  assert.equal(carcavelos.staticMetadata.coastExposure.bearing, 188);

  assert.equal(lagide.staticMetadata.coastExposure.bearing, 345);
  assert.ok(lagide.staticMetadata.travelDetails.breakType.includes("Lefts"));
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

test("mapping remaps cached Surfline spots onto nearby MEO spots broadly and conservatively", () => {
  assert.ok(mappingDb.matches.length >= 85);

  const mappingByMeoId = new Map(mappingDb.matches.map((match) => [match.meoSpotId, match]));
  const guincho = mappingByMeoId.get("praia-do-guincho");
  const paredesDaVitoria = mappingByMeoId.get("paredes-da-vitoria");

  assert.equal(guincho.surflineSpotIds[0], "surfline-praia-do-guincho");
  assert.ok(guincho.distancesKm["surfline-praia-do-guincho"] <= 1);
  assert.equal(guincho.reviewStatus, "generated");
  assert.equal(paredesDaVitoria, undefined);
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
  assert.ok(Math.abs(castelo.lat - 38.6131) < 0.001);
  assert.ok(Math.abs(castelo.lon - -9.2175) < 0.001);
  assert.equal(castelo.region, "Lisboa Portugal");
  assert.deepEqual(castelo.staticMetadata.breadcrumb, [
    "Portugal",
    "Setúbal",
    "Almada Municipality",
    "Costa de Caparica"
  ]);
  assert.match(castelo.staticMetadata.guideSummary, /sandy.*bay/i);
  assert.deepEqual(castelo.staticMetadata.travelDetails.bottom.value, ["Sand"]);
  assert.ok(castelo.staticMetadata.breakType.includes("Beach_Break"));
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
  const castelo = pageById.get("surfline-castelo");
  const rainha = pageById.get("surfline-praia-da-rainha");
  const riviera = mappingByMeoId.get("costa-da-caparica-riviera");

  assert.equal(mappingReview.schemaVersion, 1);
  assert.match(caparica.extractedTitle, /Costa da Caparica/);
  assert.equal(caparica.titleSource, "h1");
  assert.ok(caparica.cachePath.endsWith(".cache/surfline/pages/surfline-costa-da-caparica.html"));
  assert.equal(castelo.cacheStatus, "browser-fetched");
  assert.ok(castelo.cachePath.endsWith(".cache/surfline/pages/surfline-castelo.html"));
  assert.match(rainha.extractedTitle, /Praia da Rainha/);
  assert.equal(rainha.titleSource, "h1");
  assert.deepEqual(riviera.surflineMatches.map((match) => match.id).slice(0, 2), [
    "surfline-praia-da-rainha",
    "surfline-castelo"
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
  assert.equal(drive.label, "~25m");
  assert.equal(drive.distanceLabel, "~25km");
  assert.equal(drive.origin.label, "Central Lisbon");
});

test("coast exposure layer is hand-curatable and covers default favorites", () => {
  assert.equal(coastExposureDb.schemaVersion, 1);
  assert.equal(coastExposureDb.provider, "surfcams-portugal");
  assert.ok(coastExposureDb.method.includes("aggressive"));

  const exposureById = new Map(coastExposureDb.exposures.map((exposure) => [exposure.id, exposure]));
  for (const id of DEFAULT_FAVORITE_IDS) {
    const exposure = exposureById.get(id);
    assert.ok(exposure, `${id} has a coast exposure entry`);
    assert.equal(Number.isFinite(exposure.coastExposure.bearing), true, `${id} has a bearing`);
    assert.ok(exposure.coastExposure.evidence.length > 0, `${id} keeps evidence for hand curation`);
  }

  const saoJuliao = exposureById.get("sao-juliao");
  assert.equal(saoJuliao.coastExposure.source, "surfline-metadata");
  assert.equal(saoJuliao.coastExposure.confidence, "spot");

  const coordinateOnly = exposureById.get("almograve");
  assert.notEqual(coordinateOnly.coastExposure.source, "surfline-metadata");
  assert.equal(coordinateOnly.coastExposure.source, "region-heuristic");
  assert.equal(coordinateOnly.coastExposure.reviewStatus, "generated");
  assert.equal(coordinateOnly.coastExposure.confidence, "heuristic");
});

test("spot metadata enrichment carries Surfline surf mechanics onto MEO-keyed entries", () => {
  assert.ok(spotMetadataDb);
  assert.equal(spotMetadataDb.schemaVersion, 1);
  assert.ok(spotMetadataDb.entries.length >= 25);

  const enrichmentById = new Map(spotMetadataDb.entries.map((entry) => [entry.id, entry]));
  const carcavelos = enrichmentById.get("praia-de-carcavelos");

  assert.equal(carcavelos.surfMetadata.sourceSpotId, "surfline-carcavelos");
  assert.ok(carcavelos.surfMetadata.breakType.includes("Beach_Break"));
  assert.deepEqual(carcavelos.surfMetadata.bottom, ["Sand"]);
  assert.ok(carcavelos.surfMetadata.abilityLevels.includes("BEGINNER"));
  assert.match(carcavelos.surfMetadata.guideSummary, /Lisbon-area beachbreak/i);
  assert.equal(carcavelos.surfMetadata.coastExposure.bearing, 188);

  assert.equal(enrichmentById.has("almograve"), false);

  const caparicaCds = enrichmentById.get("costa-da-caparica");
  assert.equal(caparicaCds.surfMetadata.sourceSpotId, "surfline-costa-da-caparica");
  assert.ok(caparicaCds.surfMetadata.breakType.includes("Jetty"));
});

test("applySpotMetadataToCameraDb enriches cameras with Surfline metadata and coast exposure", () => {
  const cameraDb = {
    cameras: [
      { id: "praia-de-carcavelos", name: "Carcavelos", region: "cascais" },
      { id: "unmatched", name: "Unmatched", region: "unknown" }
    ]
  };

  const enriched = applySpotMetadataToCameraDb(cameraDb, normalized);
  const carcavelos = enriched.cameras.find((camera) => camera.id === "praia-de-carcavelos");
  const unmatched = enriched.cameras.find((camera) => camera.id === "unmatched");

  assert.notEqual(enriched, cameraDb);
  assert.equal(cameraDb.cameras[0].surfMetadata, undefined);
  assert.equal(carcavelos.surfMetadata.sourceSpotId, "surfline-carcavelos");
  assert.ok(carcavelos.surfMetadata.breakType.includes("Beach_Break"));
  assert.equal(carcavelos.surfMetadata.coastExposure.bearing, 188);
  assert.equal(unmatched.surfMetadata, undefined);
});

test("surfline breakType values do not contain board-type enums", () => {
  const boardTypeValues = new Set(["SHORTBOARD", "FUNBOARD", "LONGBOARD", "FISH", "BODYBOARD"]);
  const polluted = surflineDb.spots
    .filter((spot) => spot.staticMetadata.breakType.some((value) => boardTypeValues.has(value)))
    .map((spot) => spot.id);

  assert.deepEqual(polluted, []);
});

test("needs-review mappings are collected into a local feedback HTML interface", () => {
  assert.match(needsReviewHtml, /id="needsReviewApp"/);
  assert.match(needsReviewHtml, /data-review-id="costa-da-caparica-tarquinio"/);
  assert.match(needsReviewHtml, /surfline-costa-da-caparica/);
  assert.match(needsReviewHtml, /Match score/);
  assert.match(needsReviewHtml, /data-match-score="/);
  assert.match(needsReviewHtml, /<textarea/);
  assert.match(needsReviewHtml, /Export feedback/);
  assert.match(needsReviewHtml, /id="exportPanel"/);
  assert.match(needsReviewHtml, /id="exportJson"/);
  assert.match(needsReviewHtml, /Copy JSON/);
  assert.match(needsReviewHtml, /localStorage/);
  assert.doesNotMatch(needsReviewHtml, /Needs manual mapping/);
  assert.doesNotMatch(needsReviewHtml, /Correct Surfline id or URL/);
  assert.doesNotMatch(needsReviewHtml, /manualValue/);
  assert.doesNotMatch(needsReviewHtml, /URL\.createObjectURL/);

  const tarquinioCard = needsReviewHtml.match(/data-review-id="costa-da-caparica-tarquinio"[\s\S]*?<\/article>/)?.[0] || "";
  const caparicaIndex = tarquinioCard.indexOf('value="surfline-costa-da-caparica" checked');
  const barbasIndex = tarquinioCard.indexOf('value="surfline-praia-do-barbas"');
  assert.ok(caparicaIndex >= 0, "Costa da Caparica should be the default selected Surfline candidate");
  assert.ok(barbasIndex >= 0, "Praia do Barbas should still be shown as a candidate");
  assert.ok(caparicaIndex < barbasIndex, "candidate list should be sorted by weighted match score");
});

test("applyCoastExposuresToCameraDb enriches cameras without mutating the source database", () => {
  const cameraDb = {
    cameras: [
      { id: "sao-juliao", name: "São Julião", region: "mafra" },
      { id: "unmatched", name: "Unmatched", region: "unknown" }
    ]
  };

  const enriched = applyCoastExposuresToCameraDb(cameraDb, normalized);
  const saoJuliao = enriched.cameras.find((camera) => camera.id === "sao-juliao");
  const unmatched = enriched.cameras.find((camera) => camera.id === "unmatched");

  assert.notEqual(enriched, cameraDb);
  assert.equal(cameraDb.cameras[0].surfMetadata, undefined);
  assert.equal(saoJuliao.surfMetadata.coastExposure.source, "surfline-metadata");
  assert.equal(Number.isFinite(saoJuliao.surfMetadata.coastExposure.bearing), true);
  assert.equal(unmatched.surfMetadata, undefined);
});

test("findDriveEstimate prefers routed distance and duration when directions data is available", () => {
  const routed = normalizeSpotData({
    driveDb: {
      origin: {
        label: "Central Lisbon",
        lat: 38.7223,
        lon: -9.1393
      },
      estimates: [
        {
          meoSpotId: "routed-spot",
          distanceKm: 12,
          routeDistanceMeters: 42100,
          durationSeconds: 2920,
          source: "osrm-table"
        }
      ]
    }
  });

  const drive = findDriveEstimate({ id: "routed-spot" }, routed);

  assert.equal(drive.routeDistanceKm, 42.1);
  assert.equal(drive.estimatedMinutes, 50);
  assert.equal(drive.distanceLabel, "~40km");
  assert.equal(drive.label, "~50m");
  assert.equal(drive.source, "osrm-table");
});

test("needs-review Surfline mappings are excluded from runtime match lookup", () => {
  assert.equal(
    mappingDb.matches.some((match) => (
      match.meoSpotId === "costa-da-caparica-tarquinio" && match.reviewStatus === "needs-review"
    )),
    true
  );
  assert.deepEqual(findSurflineMatches({ id: "costa-da-caparica-tarquinio" }, normalized), []);
});

test("rejected Surfline mappings are excluded from runtime match lookup", () => {
  assert.equal(
    mappingDb.matches.some((match) => (
      match.meoSpotId === "almograve" && match.reviewStatus === "rejected"
    )),
    true
  );
  assert.deepEqual(findSurflineMatches({ id: "almograve" }, normalized), []);
});

test("findDriveEstimate rejects impossible routed distances and falls back to the heuristic", () => {
  const routed = normalizeSpotData({
    driveDb: {
      origin: {
        label: "Central Lisbon",
        lat: 38.7223,
        lon: -9.1393
      },
      estimates: [
        {
          meoSpotId: "island-spot",
          distanceKm: 957.9,
          routeDistanceKm: 333.5,
          routeDistanceMeters: 333451,
          durationSeconds: 13822,
          profile: "regional",
          label: "~3h 50m",
          distanceLabel: "~335km",
          source: "osrm-table"
        }
      ]
    }
  });

  const drive = findDriveEstimate({ id: "island-spot" }, routed);

  assert.equal(drive.routeDistanceKm, 1130.322);
  assert.equal(drive.estimatedMinutes, 955);
  assert.equal(drive.distanceLabel, "~1130km");
  assert.equal(drive.label, "~15h 55m");
});

test("driving heuristic is deterministic for central Lisbon distances", () => {
  const cascaisDistance = haversineKm(
    { lat: 38.7223, lon: -9.1393 },
    { lat: 38.693546, lon: -9.368644 }
  );

  assert.equal(Math.round(cascaisDistance), 20);
  assert.equal(estimateDrivingMinutes(cascaisDistance, "urban-coast"), 45);
});

test("normalizeSpotData exposes conditionsById and stretchBySpotId", () => {
  const normalized = normalizeSpotData({
    conditionsDb: { conditions: { "surfline-x": { rating: "GOOD", fetchedAt: "2026-07-06T05:00:00Z" } } },
    stretchesDb: { stretches: [{ id: "caparica", name: "Caparica stretch", surflineSpotIds: ["surfline-x"], meoCamIds: ["cam-1"] }] }
  });
  assert.equal(normalized.conditionsById.get("surfline-x").rating, "GOOD");
  assert.equal(normalized.stretchBySpotId.get("surfline-x").id, "caparica");
  assert.equal(normalized.stretchBySpotId.get("cam-1").id, "caparica");
});

test("normalizeSpotData tolerates absent conditions and stretches", () => {
  const normalized = normalizeSpotData({});
  assert.equal(normalized.conditionsById.size, 0);
  assert.equal(normalized.stretchBySpotId.size, 0);
  assert.equal(normalized.advice.subjectsById.size, 0);
});

test("normalizeSpotData loads the 44-subject advice artifact and promotion lookup", () => {
  const adviceDb = JSON.parse(fs.readFileSync("data/spot-advice-resolved.json", "utf8"));
  const normalized = normalizeSpotData({
    adviceDb,
    promotedDb: { promoted: [{ id: "surfline-sao-juliao", linkedCamId: "sao-juliao" }], deferred: [] }
  });

  assert.equal(normalized.advice.subjectsById.size, 44);
  assert.equal(normalized.advice.identityByCameraId.get("praia-sesimbra"), "surfline-sesimbra");
  assert.equal(normalized.promotedById.get("surfline-sao-juliao").linkedCamId, "sao-juliao");
  assert.equal(SPOT_ADVICE_URL, "./data/spot-advice-resolved.json");
});

test("failed optional advice fetch degrades to empty advice without losing other spot data", async () => {
  const required = new Map([
    ["./data/surfline-spots.json", { spots: [{ id: "surfline-required" }] }],
    ["./data/meo-spots.json", { spots: [{ id: "meo-required" }] }],
    ["./data/meo-surfline-matches.json", { matches: [] }],
    ["./data/lisbon-drive-estimates.json", { origin: CENTRAL_LISBON, estimates: [] }]
  ]);
  const fetcher = async (url) => {
    if (url === SPOT_ADVICE_URL) return { ok: false, status: 503, json: async () => ({}) };
    const body = required.get(url) || {};
    return { ok: true, status: 200, json: async () => body };
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let loaded;
  try {
    loaded = await loadSpotData({ fetcher });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(loaded.surflineById.has("surfline-required"), true);
  assert.equal(loaded.meoById.has("meo-required"), true);
  assert.equal(loaded.advice.subjectsById.size, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /spot advice.*503/i);
});
