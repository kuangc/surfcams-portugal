import assert from "node:assert/strict";
import test from "node:test";

import {
  MEO_CAMERA_ID_RENAMES,
  RETIRED_MEO_CAMERA_IDS,
  canonicalMeoCameraId,
  predecessorMeoCameraIds
} from "../src/meo-camera-identities.js";
import {
  buildPreservedDriveEstimates,
  deterministicDriveEstimate
} from "../scripts/build-spot-data.js";

test("MEO camera identity migration is exact, trimmed, and one hop", () => {
  assert.deepEqual(MEO_CAMERA_ID_RENAMES, {
    "espinho-silvade": "espinho-silvalde",
    espinhosilvadeestatica: "espinhosilvaldeestatica"
  });
  assert.deepEqual(RETIRED_MEO_CAMERA_IDS, ["surfline-castelo"]);

  assert.equal(canonicalMeoCameraId(" espinho-silvade "), "espinho-silvalde");
  assert.equal(canonicalMeoCameraId("espinhosilvadeestatica"), "espinhosilvaldeestatica");
  assert.equal(canonicalMeoCameraId("espinho-silvalde"), "espinho-silvalde");
  assert.equal(canonicalMeoCameraId(" surfline-castelo "), null);
  assert.equal(canonicalMeoCameraId(" unchanged-camera "), "unchanged-camera");
  assert.equal(canonicalMeoCameraId(""), null);
  assert.equal(canonicalMeoCameraId(null), null);

  assert.deepEqual(predecessorMeoCameraIds("espinho-silvalde"), ["espinho-silvade"]);
  assert.deepEqual(predecessorMeoCameraIds("espinhosilvaldeestatica"), ["espinhosilvadeestatica"]);
  assert.deepEqual(predecessorMeoCameraIds("espinho-silvade"), []);
  assert.deepEqual(predecessorMeoCameraIds("surfline-castelo"), []);
});

function osrmEstimate(camera, overrides = {}) {
  const baseline = deterministicDriveEstimate(camera);
  const routeDistanceKm = Number((baseline.distanceKm * 1.3).toFixed(1));
  const durationSeconds = 12_345;
  return {
    ...baseline,
    routeDistanceKm,
    routeDistanceMeters: Math.round(routeDistanceKm * 1000),
    durationSeconds,
    estimatedMinutes: 205,
    label: "~3h 25m",
    distanceLabel: "~335km",
    source: "osrm-table",
    ...overrides
  };
}

test("preserve mode carries a renamed Espinho OSRM row forward and falls back for a new camera", () => {
  const renamedEspinho = {
    id: "espinho-silvalde",
    name: "Espinho | Silvalde",
    region: "norte",
    lat: 41.001,
    lon: -8.6501
  };
  const monteVerde = {
    id: "acores-ribeira-grande-praia-do-monte-verde",
    name: "Praia do Monte Verde",
    region: "acores",
    lat: 37.821,
    lon: -25.522
  };
  const oldEspinho = osrmEstimate(renamedEspinho, { meoSpotId: "espinho-silvade" });
  const retiredSurflineCamera = osrmEstimate(
    { id: "surfline-castelo", region: "almada", lat: 38.6131, lon: -9.2175 }
  );

  const result = buildPreservedDriveEstimates(
    [renamedEspinho, monteVerde],
    {
      method: { type: "osrm-table" },
      estimates: [retiredSurflineCamera, oldEspinho]
    }
  );

  assert.deepEqual(result.estimates.map((estimate) => estimate.meoSpotId), [
    "espinho-silvalde",
    "acores-ribeira-grande-praia-do-monte-verde"
  ]);
  assert.deepEqual(result.estimates[0], {
    ...oldEspinho,
    meoSpotId: "espinho-silvalde"
  });
  assert.deepEqual(result.estimates[1], deterministicDriveEstimate(monteVerde));
  assert.deepEqual(result.method, {
    type: "preserved-osrm-with-deterministic-fallback",
    preservedCount: 1,
    fallbackCount: 1,
    totalCount: 2,
    note: "Preserves plausible build-time OSRM routes for unchanged cameras and uses deterministic distance estimates for new or changed cameras."
  });
});

test("preserve mode rejects changed coordinates, changed profiles, and implausible or malformed routes", () => {
  const baseCamera = {
    id: "test-camera",
    name: "Test camera",
    region: "centro",
    lat: 39.5,
    lon: -9.2
  };
  const baseline = deterministicDriveEstimate(baseCamera);
  const cases = [
    {
      name: "coordinates",
      camera: { ...baseCamera, lat: baseCamera.lat + 0.01 },
      previous: osrmEstimate(baseCamera)
    },
    {
      name: "profile",
      camera: { ...baseCamera, region: "cascais" },
      previous: osrmEstimate(baseCamera)
    },
    {
      name: "implausible route",
      camera: baseCamera,
      previous: osrmEstimate(baseCamera, {
        routeDistanceKm: Number((baseline.distanceKm * 0.5).toFixed(1)),
        routeDistanceMeters: undefined
      })
    },
    {
      name: "non-OSRM source",
      camera: baseCamera,
      previous: osrmEstimate(baseCamera, { source: "heuristic" })
    },
    {
      name: "malformed duration",
      camera: baseCamera,
      previous: osrmEstimate(baseCamera, { durationSeconds: -1 })
    }
  ];

  for (const scenario of cases) {
    const result = buildPreservedDriveEstimates(
      [scenario.camera],
      { method: { type: "osrm-table" }, estimates: [scenario.previous] }
    );
    assert.deepEqual(
      result.estimates,
      [deterministicDriveEstimate(scenario.camera)],
      `${scenario.name} should fall back`
    );
    assert.equal(result.method.preservedCount, 0, scenario.name);
    assert.equal(result.method.fallbackCount, 1, scenario.name);
  }
});

test("preserve mode accepts only sane prior OSRM databases and keeps current camera order", () => {
  const first = { id: "first", region: "regional", lat: 38.9, lon: -9.3 };
  const second = { id: "second", region: "regional", lat: 39.1, lon: -9.4 };
  const oldSecond = osrmEstimate(second);
  const oldFirst = osrmEstimate(first);

  const ordered = buildPreservedDriveEstimates(
    [first, second],
    { method: { type: "osrm-table" }, estimates: [oldSecond, oldFirst] }
  );
  assert.deepEqual(ordered.estimates.map((estimate) => estimate.meoSpotId), ["first", "second"]);
  assert.equal(ordered.method.preservedCount, 2);

  const wrongDatabaseSource = buildPreservedDriveEstimates(
    [first],
    { method: { type: "deterministic-distance-estimate" }, estimates: [oldFirst] }
  );
  assert.deepEqual(wrongDatabaseSource.estimates, [deterministicDriveEstimate(first)]);
  assert.equal(wrongDatabaseSource.method.fallbackCount, 1);
});

test("preserve mode accepts the inclusive 0.1km straight-distance boundary", () => {
  const camera = { id: "boundary", region: "cascais", lat: 38.680088, lon: -9.335203 };
  const baseline = deterministicDriveEstimate(camera);
  const previous = osrmEstimate(camera, {
    distanceKm: Number((baseline.distanceKm - 0.1).toFixed(1))
  });

  const result = buildPreservedDriveEstimates(
    [camera],
    { method: { type: "osrm-table" }, estimates: [previous] }
  );

  assert.equal(result.method.preservedCount, 1);
  assert.equal(result.estimates[0].source, "osrm-table");
});

test("preserve mode does not move the OSRM coordinate anchor across generations", () => {
  const firstCamera = { id: "drift", region: "cascais", lat: 38.680088, lon: -9.335203 };
  const firstBaseline = deterministicDriveEstimate(firstCamera);
  const previous = osrmEstimate(firstCamera, {
    distanceKm: Number((firstBaseline.distanceKm - 0.1).toFixed(1))
  });
  const firstGeneration = buildPreservedDriveEstimates(
    [firstCamera],
    { method: { type: "osrm-table" }, estimates: [previous] }
  );
  assert.equal(firstGeneration.estimates[0].distanceKm, previous.distanceKm);

  let secondCamera = null;
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 500; step += 1) {
      const candidate = { ...firstCamera, lat: firstCamera.lat + (direction * step * 0.00001) };
      const distanceKm = deterministicDriveEstimate(candidate).distanceKm;
      if (
        Math.abs(distanceKm - firstBaseline.distanceKm) <= 0.100001
        && Math.abs(distanceKm - previous.distanceKm) > 0.100001
      ) {
        secondCamera = candidate;
        break;
      }
    }
    if (secondCamera) break;
  }
  assert.ok(secondCamera, "fixture finds a second sub-0.1km incremental drift");

  const secondGeneration = buildPreservedDriveEstimates(
    [secondCamera],
    { method: firstGeneration.method, estimates: firstGeneration.estimates }
  );
  assert.equal(secondGeneration.method.preservedCount, 0);
  assert.deepEqual(secondGeneration.estimates, [deterministicDriveEstimate(secondCamera)]);
});
