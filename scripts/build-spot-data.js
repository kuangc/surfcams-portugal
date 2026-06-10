#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CENTRAL_LISBON,
  estimateDrivingMinutes,
  estimateRouteDistanceKm,
  formatDistanceLabel,
  formatDriveLabel,
  haversineKm
} from "../src/spot-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAMERA_DB_PATH = path.join(ROOT, "data", "beachcam-cameras.json");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const DRIVE_DB_PATH = path.join(ROOT, "data", "lisbon-drive-estimates.json");

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

function driveEstimate(camera) {
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

async function main() {
  const cameraDb = JSON.parse(await fs.readFile(CAMERA_DB_PATH, "utf8"));
  const spots = cameraDb.cameras.map(normalizeMeoSpot);
  const estimates = cameraDb.cameras
    .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon))
    .map(driveEstimate);

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
    method: {
      type: "deterministic-distance-estimate",
      note: "Approximate planning chip, not live traffic. Profiles inflate straight-line distance by corridor and round to the nearest five minutes."
    },
    estimates
  };

  await Promise.all([
    fs.writeFile(MEO_DB_PATH, `${JSON.stringify(meoDb, null, 2)}\n`, "utf8"),
    fs.writeFile(DRIVE_DB_PATH, `${JSON.stringify(driveDb, null, 2)}\n`, "utf8")
  ]);

  console.log(`Wrote ${spots.length} MEO spots and ${estimates.length} drive estimates.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
