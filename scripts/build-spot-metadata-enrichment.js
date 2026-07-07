#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAssociation } from "./lib/spot-matching.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MAPPING_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const COAST_EXPOSURE_PATH = path.join(ROOT, "data", "coast-exposures.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, "data", "spot-metadata-enrichment.json");
const OUTPUT_PATH = process.env.SPOT_ENRICHMENT_OUT
  ? path.resolve(process.env.SPOT_ENRICHMENT_OUT)
  : DEFAULT_OUTPUT_PATH;
const USEFUL_METADATA_SCORE = 6;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function fieldValue(value) {
  if (Array.isArray(value?.value)) return value.value;
  return value?.value ?? null;
}

function candidateSurflineSpots(mapping, surflineById) {
  return (mapping.surflineSpotIds || [])
    .map((surflineSpotId) => surflineById.get(surflineSpotId))
    .filter(Boolean);
}

function metadataScore(spot) {
  const staticMetadata = spot.staticMetadata || {};
  const travelDetails = staticMetadata.travelDetails || {};

  return [
    staticMetadata.guideSummary ? 2 : 0,
    travelDetails ? 4 : 0,
    cleanArray(staticMetadata.breakType).length,
    cleanArray(staticMetadata.abilityLevels).length,
    cleanArray(staticMetadata.boardTypes).length,
    cleanArray(fieldValue(travelDetails.bottom)).length,
    staticMetadata.coastExposure ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function matchEvidenceFor(mapping, surflineSpotId) {
  return mapping.matchEvidence?.find((item) => item.surflineSpotId === surflineSpotId) || {};
}

function primarySurflineSpot(mapping, surflineById) {
  for (const surflineSpotId of mapping.surflineSpotIds || []) {
    const spot = surflineById.get(surflineSpotId);
    if (spot) return spot;
  }
  return null;
}

function bestSurflineSpot(mapping, surflineById) {
  if (mapping.source === "curated") return primarySurflineSpot(mapping, surflineById);

  const candidates = candidateSurflineSpots(mapping, surflineById);
  const enrichedCandidates = candidates.map((spot) => ({
    spot,
    evidence: matchEvidenceFor(mapping, spot.id),
    metadataScore: metadataScore(spot),
    distanceKm: mapping.distancesKm?.[spot.id] ?? Number.POSITIVE_INFINITY
  }));
  const usefulCandidates = enrichedCandidates.filter((candidate) => (
    candidate.metadataScore >= USEFUL_METADATA_SCORE
  ));
  const rankedCandidates = usefulCandidates.length ? usefulCandidates : enrichedCandidates;

  return rankedCandidates.sort((a, b) => {
    const nameDelta = (b.evidence.nameScore || 0) - (a.evidence.nameScore || 0);
    if (nameDelta) return nameDelta;
    const distanceDelta = a.distanceKm - b.distanceKm;
    if (distanceDelta) return distanceDelta;
    return b.metadataScore - a.metadataScore;
  })[0]?.spot || null;
}

function surflineNameFromId(surflineSpotId) {
  return String(surflineSpotId || "").replace(/^surfline-/, "");
}

export function trustedConditionsSourceFor(mapping, meoSpot) {
  const trustedCandidates = (mapping?.surflineSpotIds || [])
    .map((surflineSpotId, index) => {
      const evidence = matchEvidenceFor(mapping, surflineSpotId);
      const distanceKm = mapping.distancesKm?.[surflineSpotId] ?? null;
      const association = evaluateAssociation({
        nameScore: evidence.nameScore || 0,
        distanceKm,
        curated: mapping.reviewStatus === "curated",
        camLat: meoSpot?.lat ?? null,
        camLon: meoSpot?.lon ?? null,
        surflineName: surflineNameFromId(surflineSpotId),
        meoName: `${meoSpot?.id || ""} ${meoSpot?.name || ""}`
      });

      return {
        surflineSpotId,
        distanceKm,
        trusted: association.trusted,
        index
      };
    })
    .filter((candidate) => candidate.trusted);

  return trustedCandidates.sort((a, b) => {
    const aFinite = Number.isFinite(a.distanceKm);
    const bFinite = Number.isFinite(b.distanceKm);
    if (aFinite && bFinite && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (aFinite !== bFinite) return aFinite ? -1 : 1;
    return a.index - b.index;
  })[0]?.surflineSpotId || null;
}

function compactSurflineMetadata(meoSpot, mapping, surflineSpot, coastExposure) {
  const staticMetadata = surflineSpot.staticMetadata || {};
  const travelDetails = staticMetadata.travelDetails || {};
  const best = travelDetails.best || {};

  return {
    source: "surfline-metadata",
    confidence: mapping.confidence || "nearby",
    reviewStatus: mapping.reviewStatus || "generated",
    sourceSpotId: surflineSpot.id,
    conditionsSourceSpotId: trustedConditionsSourceFor(mapping, meoSpot),
    sourceSpotName: surflineSpot.name,
    sourceDistanceKm: mapping.distancesKm?.[surflineSpot.id] ?? null,
    sourceUrl: surflineSpot.url,
    breadcrumb: cleanArray(staticMetadata.breadcrumb),
    guideSummary: staticMetadata.guideSummary || "",
    nearbySpotNames: cleanArray(staticMetadata.nearbySpotNames),
    breakType: cleanArray(staticMetadata.breakType),
    abilityLevels: cleanArray(staticMetadata.abilityLevels),
    boardTypes: cleanArray(staticMetadata.boardTypes),
    bottom: cleanArray(fieldValue(travelDetails.bottom)),
    best: {
      season: fieldValue(best.season),
      size: fieldValue(best.size),
      tide: fieldValue(best.tide),
      windDirection: fieldValue(best.windDirection),
      swellDirection: fieldValue(best.swellDirection)
    },
    crowdFactor: fieldValue(travelDetails.crowdFactor),
    localVibe: fieldValue(travelDetails.localVibe),
    shoulderBurn: fieldValue(travelDetails.shoulderBurn),
    hazards: fieldValue(travelDetails.hazards),
    coastExposure: coastExposure?.coastExposure || staticMetadata.coastExposure || null,
    evidence: [
      `MEO ${meoSpot.id} mapped to ${surflineSpot.id}`,
      `Mapping source ${mapping.source || "unknown"} with confidence ${mapping.confidence || "unknown"}`,
      Number.isFinite(mapping.distancesKm?.[surflineSpot.id])
        ? `Source spot distance ${mapping.distancesKm[surflineSpot.id]}km`
        : null,
      staticMetadata.coastExposure
        ? `Surfline coast exposure ${staticMetadata.coastExposure.bearing}`
        : null
    ].filter(Boolean)
  };
}

async function main() {
  const [meoDb, surflineDb, mappingDb, coastExposureDb] = await Promise.all([
    readJson(MEO_DB_PATH),
    readJson(SURFLINE_DB_PATH),
    readJson(MAPPING_DB_PATH),
    readJson(COAST_EXPOSURE_PATH).catch((error) => {
      if (error.code === "ENOENT") return { exposures: [] };
      throw error;
    })
  ]);

  const surflineById = new Map((surflineDb.spots || []).map((spot) => [spot.id, spot]));
  const coastExposureById = new Map((coastExposureDb.exposures || []).map((entry) => [entry.id, entry]));
  const mappingByMeoId = new Map((mappingDb.matches || []).map((mapping) => [mapping.meoSpotId, mapping]));
  const entries = [];

  for (const meoSpot of meoDb.spots || []) {
    const mapping = mappingByMeoId.get(meoSpot.id);
    if (!mapping) continue;
    if (mapping.reviewStatus === "needs-review" || mapping.reviewStatus === "rejected") continue;

    const surflineSpot = bestSurflineSpot(mapping, surflineById);
    if (!surflineSpot) continue;

    const surfMetadata = compactSurflineMetadata(
      meoSpot,
      mapping,
      surflineSpot,
      coastExposureById.get(meoSpot.id)
    );

    entries.push({
      id: meoSpot.id,
      name: meoSpot.name,
      region: meoSpot.region,
      surfMetadata
    });
  }

  const db = {
    schemaVersion: 1,
    provider: "surfcams-portugal",
    generatedAt: new Date().toISOString(),
    method: "MEO-keyed enrichment from generated MEO-to-Surfline mappings, normalized Surfline metadata, and the hand-curatable coast exposure layer.",
    source: {
      meoSpots: "data/meo-spots.json",
      surflineSpots: "data/surfline-spots.json",
      meoSurflineMatches: "data/meo-surfline-matches.json",
      coastExposures: "data/coast-exposures.json"
    },
    total: entries.length,
    entries
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  console.log(`Wrote ${entries.length} MEO spot metadata enrichment entries to ${path.relative(ROOT, OUTPUT_PATH)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
