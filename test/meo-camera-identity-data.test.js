import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

const identityCases = [
  {
    legacyId: "espinho-silvade",
    id: "espinho-silvalde",
    name: "Espinho | Silvalde",
    pageUrl: "http://beachcam.meo.pt/livecams/espinho-silvalde/",
    hasTideStation: true
  },
  {
    legacyId: "espinhosilvadeestatica",
    id: "espinhosilvaldeestatica",
    name: "Espinho | Silvalde | Estática",
    pageUrl: "http://beachcam.meo.pt/livecams/espinhosilvaldeestatica/",
    hasTideStation: false
  }
];

function assertCatalogIdentities(cameras, urlKey) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  for (const identity of identityCases) {
    assert.equal(byId.has(identity.legacyId), false);
    assert.equal(byId.get(identity.id)?.name, identity.name);
    assert.equal(byId.get(identity.id)?.[urlKey], identity.pageUrl);
  }
}

test("accepted and embedded camera catalogs use MEO's corrected Espinho identities", () => {
  const cameraDb = readJson("data/beachcam-cameras.json");
  assertCatalogIdentities(cameraDb.cameras, "pageUrl");

  const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const embeddedJson = indexHtml.match(
    /<script id="embeddedCameraDb" type="application\/json">([\s\S]*?)<\/script>/
  )?.[1];
  assert.ok(embeddedJson, "embedded camera database is present");
  assertCatalogIdentities(JSON.parse(embeddedJson).cameras, "pageUrl");
});

test("derived MEO metadata keeps the corrected Espinho identity keys", () => {
  assertCatalogIdentities(readJson("data/meo-spots.json").spots, "url");

  const exposureById = new Map(
    readJson("data/coast-exposures.json").exposures.map((entry) => [entry.id, entry])
  );
  const driveIds = new Set(
    readJson("data/lisbon-drive-estimates.json").estimates.map((entry) => entry.meoSpotId)
  );
  for (const identity of identityCases) {
    assert.equal(exposureById.has(identity.legacyId), false);
    assert.equal(exposureById.get(identity.id)?.name, identity.name);
    assert.equal(driveIds.has(identity.legacyId), false);
    assert.equal(driveIds.has(identity.id), true);
  }
});

test("tide metadata follows the corrected live-camera identity", () => {
  const tideDb = readJson("data/portugal-tides.json");
  const liveIdentity = identityCases.find((identity) => identity.hasTideStation);

  assert.equal(Object.hasOwn(tideDb.cameraStations, liveIdentity.legacyId), false);
  assert.equal(tideDb.cameraStations[liveIdentity.id]?.cameraId, liveIdentity.id);
  assert.equal(tideDb.cameraStations[liveIdentity.id]?.cameraName, liveIdentity.name);
  assert.equal(
    Object.values(tideDb.stations).some((station) => station.cameraIds.includes(liveIdentity.legacyId)),
    false
  );
  assert.equal(
    Object.values(tideDb.stations).some((station) => station.cameraIds.includes(liveIdentity.id)),
    true
  );
});
