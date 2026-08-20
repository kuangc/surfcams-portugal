import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cameraDb = readJson("data/beachcam-cameras.json");
const meoDb = readJson("data/meo-spots.json");
const drives = readJson("data/lisbon-drive-estimates.json");
const mappings = readJson("data/meo-surfline-matches.json");
const mappingReview = readJson("data/surfline-mapping-review.json");
const exposures = readJson("data/coast-exposures.json");
const enrichment = readJson("data/spot-metadata-enrichment.json");
const tides = readJson("data/portugal-tides.json");
const surflineSpots = readJson("data/surfline-spots.json");
const surflineConditions = readJson("data/surfline-conditions.json");
const promoted = readJson("data/promoted-spots.json");

const canonicalName = (value) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .split("|")
  .map((segment) => segment.trim())
  .filter(Boolean)
  .join(" | ");

const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b, "en"));
const ids = (rows, field = "id") => sorted(rows.map((row) => row[field]));

test("accepted provider catalog has canonical MEO identities and one unique feed per playable camera", () => {
  assert.equal(cameraDb.total, 190);
  assert.equal(cameraDb.withStreams, 154);
  assert.equal(cameraDb.cameras.filter((camera) => camera.isMulti).length, 73);
  assert.equal(cameraDb.cameras.every((camera) => camera.name === canonicalName(camera.name)), true);
  assert.equal(cameraDb.cameras.every((camera) => camera.location === String(camera.location).trim()), true);
  assert.equal(cameraDb.cameras.every((camera) => camera.region === String(camera.region).trim()), true);
  assert.equal(cameraDb.cameras.some((camera) => /surfline/i.test(String(camera.provider || ""))), false);

  const playable = cameraDb.cameras.filter((camera) => camera.hasStream);
  assert.equal(playable.length, 154);
  assert.equal(new Set(playable.map((camera) => camera.livecamId)).size, playable.length);
  assert.equal(new Set(playable.map((camera) => camera.streamUrl)).size, playable.length);
  for (const camera of playable) {
    const url = new URL(camera.streamUrl);
    assert.equal(url.protocol, "https:", camera.id);
    assert.equal(url.hostname, "video-auth1.iol.pt", camera.id);
    assert.equal(url.username || url.password || url.port || url.search || url.hash, "", camera.id);
    assert.match(url.pathname, /^\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i, camera.id);
  }
});

test("corrected provider identities replace only the legacy MEO camera keys", () => {
  const cameraIds = new Set(cameraDb.cameras.map((camera) => camera.id));
  assert.equal(cameraIds.has("espinho-silvade"), false);
  assert.equal(cameraIds.has("espinhosilvadeestatica"), false);
  assert.equal(cameraIds.has("surfline-castelo"), false);
  assert.equal(cameraIds.has("espinho-silvalde"), true);
  assert.equal(cameraIds.has("espinhosilvaldeestatica"), true);
  assert.equal(cameraIds.has("acores-ribeira-grande-praia-do-monte-verde"), true);

  const monteVerde = cameraDb.cameras.find((camera) => camera.id === "acores-ribeira-grande-praia-do-monte-verde");
  assert.deepEqual({
    name: monteVerde.name,
    location: monteVerde.location,
    region: monteVerde.region,
    livecamId: monteVerde.livecamId
  }, {
    name: "Praia do Monte Verde",
    location: "RIBEIRA GRANDE",
    region: "acores",
    livecamId: "34828"
  });
});

test("every MEO-keyed derivative references the accepted provider catalog", () => {
  const cameraIds = new Set(cameraDb.cameras.map((camera) => camera.id));
  assert.deepEqual(ids(meoDb.spots), sorted(cameraIds));
  assert.deepEqual(ids(drives.estimates, "meoSpotId"), sorted(cameraIds));
  assert.deepEqual(ids(exposures.exposures), sorted(cameraIds));
  assert.equal(mappings.matches.every((row) => cameraIds.has(row.meoSpotId)), true);
  assert.equal(enrichment.entries.every((row) => cameraIds.has(row.id)), true);
  assert.equal(Object.keys(tides.cameraStations).every((id) => cameraIds.has(id)), true);
  assert.equal(
    Object.values(tides.stations).flatMap((station) => station.cameraIds).every((id) => cameraIds.has(id)),
    true
  );

  assert.deepEqual(
    ids(mappingReview.mappings, "meoSpotId"),
    ids(mappings.matches, "meoSpotId"),
    "operator review data follows the current MEO mapping keys"
  );
});

test("Surfline Castelo remains wave intelligence but cannot re-enter the camera catalog", () => {
  assert.ok(surflineSpots.spots.some((spot) => spot.id === "surfline-castelo"));
  assert.ok(Object.hasOwn(surflineConditions.conditions, "surfline-castelo"));
  const castelo = promoted.promoted.find((spot) => spot.id === "surfline-castelo");
  assert.equal(castelo.linkedCamId, "costa-da-caparica-riviera");
  assert.equal(castelo.hasStream, false);
  assert.equal(Object.hasOwn(castelo, "streamUrl"), false);
});

test("every default favorite remains a playable native MEO camera", () => {
  const playableIds = new Set(cameraDb.cameras.filter((camera) => camera.hasStream).map((camera) => camera.id));
  assert.equal(DEFAULT_FAVORITE_IDS.every((id) => playableIds.has(id)), true);
});
