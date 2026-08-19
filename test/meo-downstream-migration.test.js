import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCuratedExposureEntries } from "../scripts/build-coast-exposures.js";
import { canonicalizePreservedMatches } from "../scripts/build-meo-surfline-matches.js";
import {
  manualStationForCamera,
  previousStationForCamera,
  stationFromLocationResponse
} from "../scripts/fetch-tides.js";

test("preserved MEO-to-Surfline rows move only the MEO identity namespace", () => {
  const nestedEvidence = [{ surflineSpotId: "surfline-castelo", note: "keep this Surfline subject" }];
  const matches = canonicalizePreservedMatches([
    {
      meoSpotId: "espinho-silvade",
      surflineSpotIds: ["surfline-castelo"],
      distancesKm: { "surfline-castelo": 1.2 },
      matchEvidence: nestedEvidence,
      source: "curated"
    },
    {
      meoSpotId: "surfline-castelo",
      surflineSpotIds: ["surfline-castelo"],
      source: "curated"
    },
    {
      meoSpotId: "almograve",
      surflineSpotIds: ["surfline-almograve"],
      reviewStatus: "rejected"
    }
  ]);

  assert.deepEqual(matches.map((match) => match.meoSpotId), ["espinho-silvalde", "almograve"]);
  assert.deepEqual(matches[0].surflineSpotIds, ["surfline-castelo"]);
  assert.deepEqual(matches[0].distancesKm, { "surfline-castelo": 1.2 });
  assert.strictEqual(matches[0].matchEvidence, nestedEvidence);
  assert.equal(matches[1].reviewStatus, "rejected", "the unrelated rejected Almograve decision survives");
});

test("a preserved row already using the canonical MEO ID wins an alias collision", () => {
  const canonical = {
    meoSpotId: "espinho-silvalde",
    surflineSpotIds: ["surfline-canonical-choice"],
    source: "curated"
  };
  const predecessor = {
    meoSpotId: "espinho-silvade",
    surflineSpotIds: ["surfline-predecessor-choice"],
    source: "curated"
  };

  assert.deepEqual(canonicalizePreservedMatches([canonical, predecessor]), [canonical]);
  assert.deepEqual(canonicalizePreservedMatches([predecessor, canonical]), [canonical]);
  assert.equal(canonicalizePreservedMatches([predecessor, { ...predecessor }]).length, 1);
});

test("curated coast exposures rekey MEO IDs without rewriting Surfline evidence", () => {
  const coastExposure = {
    bearing: 260,
    source: "manual",
    sourceSpotId: "surfline-castelo",
    evidence: ["Surfline metadata surfline-castelo remains intelligence"]
  };
  const canonicalExposure = {
    bearing: 270,
    source: "manual",
    sourceSpotId: "surfline-espinho",
    evidence: ["canonical row wins"]
  };
  const exposures = canonicalizeCuratedExposureEntries([
    { id: "espinho-silvade", coastExposure },
    { id: "surfline-castelo", coastExposure: { ...coastExposure } },
    { id: "espinho-silvalde", coastExposure: canonicalExposure }
  ]);

  assert.deepEqual(exposures, [{ id: "espinho-silvalde", coastExposure: canonicalExposure }]);

  const migratedOnly = canonicalizeCuratedExposureEntries([
    { id: "espinho-silvade", coastExposure }
  ]);
  assert.equal(migratedOnly[0].id, "espinho-silvalde");
  assert.strictEqual(migratedOnly[0].coastExposure, coastExposure);
  assert.equal(migratedOnly[0].coastExposure.sourceSpotId, "surfline-castelo");
});

test("tide station reuse prefers the current camera ID and refreshes camera metadata", () => {
  const camera = {
    id: "espinho-silvalde",
    name: "Espinho | Silvalde",
    region: "norte",
    lat: 41.012,
    lon: -8.65
  };
  const previous = previousStationForCamera(camera, {
    "espinho-silvalde": { cameraId: "espinho-silvalde", portId: "13", portName: "Current" },
    "espinho-silvade": { cameraId: "espinho-silvade", portId: "12", portName: "Predecessor" }
  });

  assert.equal(previous.portId, "13");
  assert.equal(previous.portName, "Current");
  assert.deepEqual(
    {
      cameraId: previous.cameraId,
      cameraName: previous.cameraName,
      cameraRegion: previous.cameraRegion,
      cameraLat: previous.cameraLat,
      cameraLon: previous.cameraLon
    },
    {
      cameraId: "espinho-silvalde",
      cameraName: "Espinho | Silvalde",
      cameraRegion: "norte",
      cameraLat: 41.012,
      cameraLon: -8.65
    }
  );
});

test("tide station reuse falls back to a predecessor ID and rekeys the station", () => {
  const camera = {
    id: "espinho-silvalde",
    name: "Espinho | Silvalde",
    region: "norte",
    lat: 41.012,
    lon: -8.65
  };
  const previous = previousStationForCamera(camera, {
    "espinho-silvade": {
      cameraId: "espinho-silvade",
      cameraName: "old name",
      portId: "12",
      portName: "Leixoes"
    }
  });

  assert.equal(previous.cameraId, "espinho-silvalde");
  assert.equal(previous.cameraName, "Espinho | Silvalde");
  assert.equal(previous.portId, "12");
});

test("manual tide fallbacks cover island regions without reviving retired camera overrides", () => {
  const monteVerdeCamera = {
    id: "acores-ribeira-grande-praia-do-monte-verde",
    name: "Praia do Monte Verde",
    region: "açores",
    lat: 37.82,
    lon: -25.52
  };
  const monteVerde = manualStationForCamera(monteVerdeCamera);
  const madeira = manualStationForCamera({ id: "madeira-cam", region: "madeira", lat: 32.7, lon: -16.9 });
  const legacyIlhas = manualStationForCamera({ id: "ilhas-cam", region: "ilhas", lat: 32.7, lon: -16.9 });
  const retired = manualStationForCamera({ id: "surfline-castelo", region: "centro", lat: 38.6, lon: -9.2 });

  assert.equal(monteVerde.portId, "211");
  assert.match(monteVerde.portName, /Ponta Delgada/);
  assert.equal(
    stationFromLocationResponse(monteVerdeCamera, null).portId,
    "211",
    "an empty live-station response still applies the island fallback"
  );
  assert.equal(madeira.portId, "112");
  assert.equal(legacyIlhas.portId, "112");
  assert.equal(retired, null);
});
