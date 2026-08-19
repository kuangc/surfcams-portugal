#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CENTRAL_LISBON,
  estimateDrivingMinutes,
  estimateDrivingMinutesFromSeconds,
  estimateRouteDistanceKm,
  formatDistanceLabel,
  formatDriveLabel,
  haversineKm
} from "../src/spot-data.js";
import { predecessorMeoCameraIds } from "../src/meo-camera-identities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAMERA_DB_PATH = path.join(ROOT, "data", "beachcam-cameras.json");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const DRIVE_DB_PATH = path.join(ROOT, "data", "lisbon-drive-estimates.json");
const ROUTING_PROVIDER = process.env.ROUTING_PROVIDER || "heuristic";
const OSRM_TABLE_URL = process.env.OSRM_TABLE_URL || "https://router.project-osrm.org/table/v1/driving";
const ROUTING_CHUNK_SIZE = Number(process.env.ROUTING_CHUNK_SIZE || 95);

function routeProfile(camera) {
  if (["cascais", "oeiras", "sintra"].includes(camera.region)) return "urban-coast";
  if (["almada", "sesimbra", "setubal"].includes(camera.region)) return "south-bank";
  if (["peniche", "nazare", "costa-oeste", "centro", "norte"].includes(camera.region)) return "regional-long";
  return "regional";
}

function normalizeMeoSpot(camera) {
  const provider = camera.provider || "meo-beachcam";

  return {
    id: camera.id,
    provider,
    name: camera.name,
    url: camera.pageUrl,
    lat: camera.lat,
    lon: camera.lon,
    region: camera.region,
    municipality: camera.location || null,
    hasStream: Boolean(camera.hasStream),
    staticMetadata: {
      providerPageType: provider === "surfline" ? "surfline-report" : "beachcam-livecam",
      livecamId: camera.livecamId || null,
      videoId: camera.videoId || null,
      image: camera.image || null,
      isMulti: Boolean(camera.isMulti),
      description: camera.description || ""
    },
    dynamicConcepts: {
      daily: ["seaTemperature", "regionalTideReference"],
      hourly: [
        "waveHeight",
        "wavePeriod",
        "swellDirection",
        "windSpeed",
        "windDirection",
        "tideState",
        "providerTideTime"
      ]
    },
    currentSnapshot: {
      forecast: camera.forecast || {},
      detailMetrics: camera.detailMetrics || {}
    }
  };
}

export function deterministicDriveEstimate(camera) {
  const profile = routeProfile(camera);
  const distanceKm = haversineKm(CENTRAL_LISBON, camera);
  const routeDistanceKm = estimateRouteDistanceKm(distanceKm, profile);
  const estimatedMinutes = estimateDrivingMinutes(distanceKm, profile);

  return {
    meoSpotId: camera.id,
    distanceKm: Number(distanceKm.toFixed(1)),
    routeDistanceKm: Number(routeDistanceKm.toFixed(1)),
    profile,
    estimatedMinutes,
    label: formatDriveLabel(estimatedMinutes),
    distanceLabel: formatDistanceLabel(routeDistanceKm)
  };
}

function coordinate(point) {
  return `${point.lon},${point.lat}`;
}

function osrmTableUrl(cameras) {
  const coordinates = [
    coordinate(CENTRAL_LISBON),
    ...cameras.map(coordinate)
  ].join(";");
  return `${OSRM_TABLE_URL.replace(/\/$/, "")}/${coordinates}?sources=0&annotations=distance,duration`;
}

function routedEstimate(camera, routeDistanceMeters, durationSeconds) {
  const estimate = deterministicDriveEstimate(camera);
  if (!Number.isFinite(routeDistanceMeters) || !Number.isFinite(durationSeconds)) return estimate;

  const routeDistanceKm = Number((routeDistanceMeters / 1000).toFixed(1));
  if (routeDistanceKm < estimate.distanceKm * 0.9) return estimate;

  const estimatedMinutes = estimateDrivingMinutesFromSeconds(durationSeconds);

  return {
    ...estimate,
    routeDistanceKm,
    routeDistanceMeters: Math.round(routeDistanceMeters),
    durationSeconds: Math.round(durationSeconds),
    estimatedMinutes,
    label: formatDriveLabel(estimatedMinutes),
    distanceLabel: formatDistanceLabel(routeDistanceKm),
    source: "osrm-table"
  };
}

async function fetchOsrmEstimates(cameras) {
  const estimates = new Map();

  for (let start = 0; start < cameras.length; start += ROUTING_CHUNK_SIZE) {
    const batch = cameras.slice(start, start + ROUTING_CHUNK_SIZE);
    const response = await fetch(osrmTableUrl(batch));
    if (!response.ok) {
      throw new Error(`OSRM table request failed: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.code !== "Ok") {
      throw new Error(`OSRM table request failed: ${payload.code || "unknown"}`);
    }

    const distances = payload.distances?.[0] || [];
    const durations = payload.durations?.[0] || [];
    batch.forEach((camera, index) => {
      estimates.set(camera.id, routedEstimate(camera, distances[index + 1], durations[index + 1]));
    });
  }

  return cameras.map((camera) => estimates.get(camera.id) || deterministicDriveEstimate(camera));
}

const PRESERVE_METHOD_NOTE = "Preserves plausible build-time OSRM routes for unchanged cameras and uses deterministic distance estimates for new or changed cameras.";

function previousDatabaseCanContainOsrm(previousDriveDb) {
  return ["osrm-table", "preserved-osrm-with-deterministic-fallback"]
    .includes(previousDriveDb?.method?.type);
}

function priorOsrmEstimateIsSane(previous, baseline) {
  if (!previous || previous.source !== "osrm-table") return false;
  if (previous.profile !== baseline.profile) return false;
  if (!Number.isFinite(previous.distanceKm) || previous.distanceKm < 0) return false;
  if (Math.abs(previous.distanceKm - baseline.distanceKm) > 0.100001) return false;
  if (!Number.isFinite(previous.routeDistanceKm) || previous.routeDistanceKm <= 0) return false;
  if (!Number.isFinite(previous.routeDistanceMeters) || previous.routeDistanceMeters <= 0) return false;
  if (Math.abs((previous.routeDistanceMeters / 1000) - previous.routeDistanceKm) > 0.2) return false;
  if (previous.routeDistanceKm < baseline.distanceKm * 0.9) return false;
  if (!Number.isFinite(previous.durationSeconds) || previous.durationSeconds <= 0) return false;
  if (!Number.isFinite(previous.estimatedMinutes) || previous.estimatedMinutes <= 0) return false;
  if (typeof previous.label !== "string" || !previous.label.trim()) return false;
  if (typeof previous.distanceLabel !== "string" || !previous.distanceLabel.trim()) return false;
  return true;
}

/**
 * Carry forward trustworthy OSRM results without contacting the routing API.
 * The current camera list owns membership, ordering, coordinates, and IDs.
 */
export function buildPreservedDriveEstimates(cameras, previousDriveDb = {}) {
  const previousById = new Map(
    (Array.isArray(previousDriveDb?.estimates) ? previousDriveDb.estimates : [])
      .filter((estimate) => typeof estimate?.meoSpotId === "string")
      .map((estimate) => [estimate.meoSpotId, estimate])
  );
  const canPreserve = previousDatabaseCanContainOsrm(previousDriveDb);
  let preservedCount = 0;

  const estimates = cameras.map((camera) => {
    const baseline = deterministicDriveEstimate(camera);
    const candidateIds = [camera.id, ...predecessorMeoCameraIds(camera.id)];
    const previous = candidateIds
      .map((candidateId) => previousById.get(candidateId))
      .find(Boolean);

    if (!canPreserve || !priorOsrmEstimateIsSane(previous, baseline)) {
      return baseline;
    }

    preservedCount += 1;
    return {
      ...previous,
      meoSpotId: camera.id
    };
  });

  return {
    estimates,
    method: {
      type: "preserved-osrm-with-deterministic-fallback",
      preservedCount,
      fallbackCount: estimates.length - preservedCount,
      totalCount: estimates.length,
      note: PRESERVE_METHOD_NOTE
    }
  };
}

async function driveEstimates(cameras, { previousDriveDb = null } = {}) {
  if (ROUTING_PROVIDER === "preserve") {
    return buildPreservedDriveEstimates(cameras, previousDriveDb);
  }

  if (ROUTING_PROVIDER !== "osrm") {
    return {
      estimates: cameras.map(deterministicDriveEstimate),
      method: {
        type: "deterministic-distance-estimate",
        note: "Approximate planning chip, not live traffic. Profiles inflate straight-line distance by corridor and round to the nearest five minutes."
      }
    };
  }

  return {
    estimates: await fetchOsrmEstimates(cameras),
    method: {
      type: "osrm-table",
      note: "Build-time OSRM table refresh. Distances are fastest-route road distances from Central Lisbon and durations are rounded to the nearest five minutes."
    }
  };
}

async function main() {
  const cameraDb = JSON.parse(await fs.readFile(CAMERA_DB_PATH, "utf8"));
  const spots = cameraDb.cameras.map(normalizeMeoSpot);
  const routableCameras = cameraDb.cameras
    .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon));
  const previousDriveDb = ROUTING_PROVIDER === "preserve"
    ? JSON.parse(await fs.readFile(DRIVE_DB_PATH, "utf8"))
    : null;
  const { estimates, method } = await driveEstimates(routableCameras, { previousDriveDb });

  const meoDb = {
    schemaVersion: 1,
    provider: "meo-beachcam",
    generatedAt: cameraDb.generatedAt,
    source: cameraDb.source,
    total: spots.length,
    spots
  };

  const driveDb = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    origin: CENTRAL_LISBON,
    method,
    estimates
  };

  await Promise.all([
    fs.writeFile(MEO_DB_PATH, `${JSON.stringify(meoDb, null, 2)}\n`, "utf8"),
    fs.writeFile(DRIVE_DB_PATH, `${JSON.stringify(driveDb, null, 2)}\n`, "utf8")
  ]);

  console.log(`Wrote ${spots.length} MEO spots and ${estimates.length} drive estimates.`);
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
