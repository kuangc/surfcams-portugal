#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { haversineKm } from "../src/spot-data.js";
import { classifyGeneratedMatch } from "./lib/spot-matching.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MAPPING_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const MAX_PRIMARY_DISTANCE_KM = 1.2;
const MAX_NAME_PRIMARY_DISTANCE_KM = 3;
const MAX_CORRIDOR_DISTANCE_KM = 8;
const MAX_MATCHES_PER_MEO_SPOT = 5;
const EXCLUDED_MEO_REGIONS = new Set(["fluviaispiscinas", "lagos-e-rios"]);
const EXCLUDED_NAME_PATTERN = /\b(skatepark|skate)\b/i;
const STOP_WORDS = new Set([
  "a",
  "as",
  "baia",
  "beach",
  "cam",
  "costa",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "estatica",
  "fixa",
  "live",
  "norte",
  "o",
  "os",
  "panoramica",
  "praia",
  "praias",
  "sul",
  "the",
  "vila",
  "webcam"
]);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function nameScore(meoSpot, surflineSpot) {
  const meoTokens = new Set(tokens(`${meoSpot.id} ${meoSpot.name}`));
  const surflineTokens = new Set(tokens(`${surflineSpot.id.replace(/^surfline-/, "")} ${surflineSpot.name}`));
  if (!meoTokens.size || !surflineTokens.size) return 0;

  let overlap = 0;
  for (const token of meoTokens) {
    if (surflineTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(meoTokens.size, surflineTokens.size);
}

function isAutoMappable(meoSpot) {
  return Number.isFinite(meoSpot.lat)
    && Number.isFinite(meoSpot.lon)
    && !EXCLUDED_MEO_REGIONS.has(meoSpot.region)
    && !EXCLUDED_NAME_PATTERN.test(meoSpot.name || "");
}

function rankedSurflineCandidates(meoSpot, surflineSpots) {
  return surflineSpots
    .filter((spot) => Number.isFinite(spot.lat) && Number.isFinite(spot.lon))
    .map((spot) => ({
      spot,
      distanceKm: Number(haversineKm(meoSpot, spot).toFixed(1)),
      nameScore: nameScore(meoSpot, spot)
    }))
    .sort((a, b) => (
      a.distanceKm - b.distanceKm
      || b.nameScore - a.nameScore
      || a.spot.name.localeCompare(b.spot.name)
    ));
}

function acceptsPrimary(candidate) {
  return candidate.distanceKm <= MAX_PRIMARY_DISTANCE_KM
    || (candidate.distanceKm <= MAX_NAME_PRIMARY_DISTANCE_KM && candidate.nameScore >= 0.5);
}

function distancesForCandidates(candidates) {
  return Object.fromEntries(candidates.map((candidate) => [candidate.spot.id, candidate.distanceKm]));
}

export function isCuratedMatch(match) {
  return match?.source === "curated"
    || match?.source === "manual"
    || match?.reviewStatus === "curated";
}

export function isRejectedMatch(match) {
  return match?.reviewStatus === "rejected";
}

// Rows that must survive regeneration verbatim (distances re-enriched, everything else untouched):
// curated (human-accepted) and rejected (human-declined) are both terminal human decisions.
export function isPreservedMatch(match) {
  return isCuratedMatch(match) || isRejectedMatch(match);
}

// Shared by curated and rejected rows: both are terminal human decisions that must
// survive regeneration verbatim. Only distancesKm/matchEvidence are re-derived (in case
// the underlying spot databases shifted); source/confidence/reviewStatus are `||` fallbacks
// that only apply when the field is unset, so an already-set "rejected" reviewStatus (or any
// other already-set field) passes through untouched.
function enrichPreservedMatch(match, meoById, surflineById) {
  const meoSpot = meoById.get(match.meoSpotId);
  const distancesKm = { ...(match.distancesKm || {}) };
  const matchEvidence = [];

  for (const surflineSpotId of match.surflineSpotIds || []) {
    const surflineSpot = surflineById.get(surflineSpotId);
    if (!meoSpot || !surflineSpot) continue;
    distancesKm[surflineSpotId] = Number(haversineKm(meoSpot, surflineSpot).toFixed(1));
    matchEvidence.push({
      surflineSpotId,
      distanceKm: distancesKm[surflineSpotId],
      nameScore: Number(nameScore(meoSpot, surflineSpot).toFixed(2))
    });
  }

  return {
    ...match,
    source: match.source || "curated",
    confidence: match.confidence || "curated",
    reviewStatus: match.reviewStatus || "curated",
    distancesKm,
    matchEvidence
  };
}

function generatedMatch(meoSpot, surflineSpots) {
  if (!isAutoMappable(meoSpot)) return null;

  const ranked = rankedSurflineCandidates(meoSpot, surflineSpots);
  const primary = ranked[0];
  if (!primary || !acceptsPrimary(primary)) return null;

  const selected = ranked
    .filter((candidate) => candidate.distanceKm <= MAX_CORRIDOR_DISTANCE_KM)
    .slice(0, MAX_MATCHES_PER_MEO_SPOT);

  const { reviewStatus, confidence } = classifyGeneratedMatch({
    nameScore: primary.nameScore,
    distanceKm: primary.distanceKm,
    camLat: meoSpot.lat,
    camLon: meoSpot.lon,
    surflineName: primary.spot.name,
    meoName: `${meoSpot.id} ${meoSpot.name}`
  });

  return {
    meoSpotId: meoSpot.id,
    surflineSpotIds: selected.map((candidate) => candidate.spot.id),
    source: "generated-nearest",
    confidence,
    reviewStatus,
    proposedCloseRule: "nearest-cached-surfline-spots-for-same-meo-location",
    distancesKm: distancesForCandidates(selected),
    matchEvidence: selected.map((candidate) => ({
      surflineSpotId: candidate.spot.id,
      surflineName: candidate.spot.name,
      distanceKm: candidate.distanceKm,
      nameScore: Number(candidate.nameScore.toFixed(2))
    })),
    notes: `Auto-remapped from cached Surfline coordinates; primary ${primary.spot.name} is ${primary.distanceKm}km away with name score ${primary.nameScore.toFixed(2)}.`
  };
}

async function main() {
  const [meoDb, surflineDb, existingMappingDb] = await Promise.all([
    readJson(MEO_DB_PATH),
    readJson(SURFLINE_DB_PATH),
    readJson(MAPPING_DB_PATH).catch((error) => {
      if (error.code === "ENOENT") return { matches: [] };
      throw error;
    })
  ]);

  const meoById = new Map((meoDb.spots || []).map((spot) => [spot.id, spot]));
  const surflineById = new Map((surflineDb.spots || []).map((spot) => [spot.id, spot]));
  // Curated (human-accepted) and rejected (human-declined) rows are both preserved verbatim
  // across regeneration; only the auto-generation pass is skipped for their MEO spot.
  const preservedByMeoId = new Map((existingMappingDb.matches || [])
    .filter(isPreservedMatch)
    .map((match) => [match.meoSpotId, enrichPreservedMatch(match, meoById, surflineById)]));

  const matches = [];
  for (const meoSpot of meoDb.spots || []) {
    const preserved = preservedByMeoId.get(meoSpot.id);
    if (preserved) {
      matches.push(preserved);
      continue;
    }

    const generated = generatedMatch(meoSpot, surflineDb.spots || []);
    if (generated) matches.push(generated);
  }

  const db = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    closeRuleProposal: {
      id: "name-first-cam-at-spot",
      description: "Preserve curated MEO-to-Surfline corridor mappings first. For generated rows, trust the primary (nearest) candidate when its name matches (nameScore>=0.5 or slug containment) within 3km, or when it's within 0.2km by proximity alone; the name path is disabled inside the Caparica ambiguity zone where shared regional name stems make matches unreliable. Primary candidates that clear neither bar are marked needs-review for hand curation.",
      maxPrimaryDistanceKm: MAX_PRIMARY_DISTANCE_KM,
      maxNamePrimaryDistanceKm: MAX_NAME_PRIMARY_DISTANCE_KM,
      maxCorridorDistanceKm: MAX_CORRIDOR_DISTANCE_KM,
      needsUserCalibration: true
    },
    source: {
      meoSpots: "data/meo-spots.json",
      surflineSpots: "data/surfline-spots.json"
    },
    total: matches.length,
    curated: matches.filter((match) => match.source === "curated").length,
    generated: matches.filter((match) => match.source === "generated-nearest").length,
    needsReview: matches.filter((match) => match.reviewStatus === "needs-review").length,
    rejected: matches.filter((match) => match.reviewStatus === "rejected").length,
    matches
  };

  await fs.writeFile(MAPPING_DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  console.log(`Wrote ${matches.length} MEO-to-Surfline mappings to data/meo-surfline-matches.json.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
