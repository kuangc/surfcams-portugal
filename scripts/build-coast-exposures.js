#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConditionVectors } from "../src/surf-rating.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAMERA_DB_PATH = path.join(ROOT, "data", "beachcam-cameras.json");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MAPPING_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const OUTPUT_PATH = path.join(ROOT, "data", "coast-exposures.json");
const MAX_SURFLINE_DISTANCE_KM = 8;

const REGION_HEURISTICS = {
  norte: { bearing: 280, label: "West-facing north coast regional estimate" },
  centro: { bearing: 280, label: "West-facing central coast regional estimate" },
  nazare: { bearing: 270, label: "West-facing Nazare coast regional estimate" },
  "costa-oeste": { bearing: 280, label: "West-facing Costa Oeste regional estimate" },
  mafra: { bearing: 290, label: "West/Northwest-facing Mafra regional estimate" },
  sintra: { bearing: 285, label: "West/Northwest-facing Sintra regional estimate" },
  "costa-vicentina": { bearing: 280, label: "West-facing Costa Vicentina regional estimate" },
  alentejo: { bearing: 270, label: "West-facing Alentejo coast regional estimate" },
  algarve: { bearing: 180, label: "South-facing Algarve regional estimate" },
  setubal: { bearing: 180, label: "South-facing Setubal regional estimate" }
};

const MEO_TEXT_CUES = [
  {
    pattern: /\bvoltad[ao]s?\s+para\s+o\s+ocidente\b|\bvirad[ao]s?\s+para\s+o\s+ocidente\b/i,
    bearing: 270,
    label: "West-facing MEO description cue"
  },
  {
    pattern: /\bcosta\s+norte\s+da\s+ilha\b|\bcosta\s+norte\b/i,
    bearing: 0,
    label: "North-facing MEO description cue"
  },
  {
    pattern: /\bcosta\s+sul\s+da\s+ilha\b|\bcosta\s+sul\b/i,
    bearing: 180,
    label: "South-facing MEO description cue"
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeBearing(value) {
  const bearing = Number(value);
  if (!Number.isFinite(bearing)) return null;
  return ((bearing % 360) + 360) % 360;
}

function compassFromBearing(bearing) {
  if (!Number.isFinite(bearing)) return "unknown";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(normalizeBearing(bearing) / 45) % 8];
}

async function readExistingCuratedExposures() {
  try {
    const existingDb = await readJson(OUTPUT_PATH);
    return new Map((existingDb.exposures || [])
      .filter((entry) => (
        entry?.id
        && (
          entry.coastExposure?.reviewStatus === "curated"
          || entry.coastExposure?.source === "manual"
        )
      ))
      .map((entry) => [entry.id, entry.coastExposure]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

function collectSurflineMetadataExposures(surflineDb) {
  return new Map((surflineDb.spots || [])
    .map((spot) => {
      const bearing = normalizeBearing(spot.staticMetadata?.coastExposure?.bearing);
      if (bearing === null) return null;

      return [spot.id, {
        surflineSpotId: spot.id,
        surflineName: spot.name || spot.id,
        bearing,
        distanceFromLisbonKm: spot.distanceFromLisbonKm ?? null,
        providerSource: spot.staticMetadata.coastExposure.source || "surfline",
        evidence: `Surfline metadata ${spot.id} ${spot.name || spot.id} coastExposure.bearing=${bearing}`
      }];
    })
    .filter(Boolean));
}

function surflineExposureForMapping(mapping, surflineMetadataExposures) {
  if (!mapping) return null;
  if (mapping.reviewStatus === "needs-review") return null;

  for (const [index, surflineSpotId] of mapping.surflineSpotIds.entries()) {
    const candidate = surflineMetadataExposures.get(surflineSpotId);
    if (!candidate) continue;

    const distanceKm = mapping.distancesKm?.[surflineSpotId] ?? null;
    const exactOrNearby = index === 0 || (Number.isFinite(distanceKm) && distanceKm <= MAX_SURFLINE_DISTANCE_KM);
    if (!exactOrNearby) continue;

    return {
      ...candidate,
      distanceKm,
      mappingNotes: mapping.notes,
      mappingConfidence: mapping.confidence || null,
      mappingReviewStatus: mapping.reviewStatus || null
    };
  }

  return null;
}

function exposureConfidenceForMapping(mappingConfidence) {
  return mappingConfidence === "coordinate-nearby" ? "heuristic" : "spot";
}

function exposureReviewStatusForMapping(mappingReviewStatus) {
  return mappingReviewStatus === "needs-review" ? "needs-review" : "generated";
}

function meoTextCue(camera) {
  const description = String(camera.description || "");
  for (const cue of MEO_TEXT_CUES) {
    if (cue.pattern.test(description)) return cue;
  }
  return null;
}

function legacyExposure(camera) {
  const coast = getConditionVectors(camera).coast;
  if (!Number.isFinite(coast.bearing)) return null;
  return coast;
}

function regionHeuristic(camera) {
  const heuristic = REGION_HEURISTICS[camera.region];
  if (!heuristic) return null;
  return heuristic;
}

function buildExposure(camera, { mappingByMeoId, surflineMetadataExposures }) {
  const evidence = [];
  const mapping = mappingByMeoId.get(camera.id);
  const surflineExposure = surflineExposureForMapping(mapping, surflineMetadataExposures);
  if (surflineExposure) {
    evidence.push(surflineExposure.evidence);
    if (surflineExposure.providerSource) {
      evidence.push(`Provider source: ${surflineExposure.providerSource}`);
    }
    if (surflineExposure.distanceKm !== null) {
      evidence.push(`Matched from ${camera.id} to ${surflineExposure.surflineSpotId} at ${surflineExposure.distanceKm}km`);
    }
    if (surflineExposure.mappingConfidence) {
      evidence.push(`Mapping confidence: ${surflineExposure.mappingConfidence}`);
    }
    if (surflineExposure.mappingNotes) evidence.push(surflineExposure.mappingNotes);

    return {
      bearing: surflineExposure.bearing,
      compass: compassFromBearing(surflineExposure.bearing),
      label: `${compassFromBearing(surflineExposure.bearing)}-facing Surfline-derived exposure`,
      confidence: exposureConfidenceForMapping(surflineExposure.mappingConfidence),
      source: "surfline-metadata",
      sourceSpotId: surflineExposure.surflineSpotId,
      sourceDistanceKm: surflineExposure.distanceKm,
      evidence,
      reviewStatus: exposureReviewStatusForMapping(surflineExposure.mappingReviewStatus)
    };
  }

  const cue = meoTextCue(camera);
  if (cue) {
    evidence.push(`MEO description matched ${cue.pattern}`);
    return {
      bearing: cue.bearing,
      compass: compassFromBearing(cue.bearing),
      label: cue.label,
      confidence: "spot",
      source: "meo-description",
      evidence,
      reviewStatus: "generated"
    };
  }

  const legacy = legacyExposure(camera);
  if (legacy) {
    evidence.push(`Existing surf-rating fallback: ${legacy.label}`);
    return {
      bearing: legacy.bearing,
      compass: compassFromBearing(legacy.bearing),
      label: legacy.label,
      confidence: legacy.confidence,
      source: `legacy-${legacy.confidence}`,
      evidence,
      reviewStatus: "generated"
    };
  }

  const heuristic = regionHeuristic(camera);
  if (heuristic) {
    evidence.push(`Aggressive regional heuristic for ${camera.region}`);
    return {
      bearing: heuristic.bearing,
      compass: compassFromBearing(heuristic.bearing),
      label: heuristic.label,
      confidence: "heuristic",
      source: "region-heuristic",
      evidence,
      reviewStatus: "generated"
    };
  }

  evidence.push("No reliable Surfline metadata, MEO description, legacy fallback, or regional heuristic found.");
  return {
    bearing: null,
    compass: "unknown",
    label: "Unknown exposure",
    confidence: "unknown",
    source: "unknown",
    evidence,
    reviewStatus: "needs-curation"
  };
}

async function main() {
  const [cameraDb, surflineDb, mappingDb] = await Promise.all([
    readJson(CAMERA_DB_PATH),
    readJson(SURFLINE_DB_PATH),
    readJson(MAPPING_DB_PATH)
  ]);
  const mappingByMeoId = new Map(mappingDb.matches.map((match) => [match.meoSpotId, match]));
  const surflineMetadataExposures = collectSurflineMetadataExposures(surflineDb);
  const curatedExposureById = await readExistingCuratedExposures();

  const exposures = cameraDb.cameras.map((camera) => ({
    id: camera.id,
    name: camera.name,
    region: camera.region,
    municipality: camera.location || null,
    coastExposure: curatedExposureById.get(camera.id)
      || buildExposure(camera, { mappingByMeoId, surflineMetadataExposures })
  }));
  const finiteCount = exposures.filter((entry) => Number.isFinite(entry.coastExposure.bearing)).length;

  const db = {
    schemaVersion: 1,
    provider: "surfcams-portugal",
    generatedAt: new Date().toISOString(),
    method: "aggressive extraction from normalized Surfline metadata, MEO description cues, existing surf-rating fallbacks, and regional heuristics; hand-curate entries by editing coastExposure fields",
    source: {
      beachcamCameras: "data/beachcam-cameras.json",
      surflineSpots: "data/surfline-spots.json",
      meoSurflineMatches: "data/meo-surfline-matches.json"
    },
    total: exposures.length,
    finite: finiteCount,
    exposures
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  console.log(`Wrote ${finiteCount}/${exposures.length} coast exposure entries to data/coast-exposures.json.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
