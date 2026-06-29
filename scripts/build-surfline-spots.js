#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CENTRAL_LISBON, haversineKm } from "../src/spot-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".cache", "surfline", "pages");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const LISBON_RADIUS_KM = 100;
const DISPLAY_NAME_OVERRIDES_BY_REMOTE_ID = {
  "584204204e65fad6a77099d8": "Costa da Caparica | Costelo (Irmao)"
};
const BOARD_TYPE_VALUES = new Set(["SHORTBOARD", "FUNBOARD", "LONGBOARD", "FISH", "BODYBOARD"]);

const DEFAULT_REFRESH_CONCEPTS = {
  daily: [
    "tideExtremes",
    "sunriseSunset",
    "daylightWindows",
    "humanForecastSummary"
  ],
  hourly: [
    "conditionRating",
    "surfHeight",
    "wind",
    "swellComponents",
    "tideAtHour",
    "weather",
    "waterTemperature"
  ]
};

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeCachedHtml(rawHtml) {
  const trimmed = rawHtml.trim();
  if (!trimmed.startsWith("\"")) return rawHtml;

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : rawHtml;
  } catch {
    return rawHtml;
  }
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return match ? JSON.parse(match[1]) : null;
}

function extractRemoteSurflineId(url) {
  return String(url || "").match(/\/([0-9a-f]{24})(?:\?|$)/)?.[1] || null;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function appSpotId(name, remoteSpotId, existingByRemoteId, usedIds) {
  const existing = existingByRemoteId.get(remoteSpotId);
  if (existing?.id && !usedIds.has(existing.id)) return existing.id;

  const base = `surfline-${slugify(name) || remoteSpotId}`;
  if (!usedIds.has(base)) return base;
  return `${base}-${remoteSpotId.slice(0, 6)}`;
}

function reportUrl(record, associatedUrl, existingByRemoteId) {
  const existing = existingByRemoteId.get(record._id);
  if (existing?.url) return existing.url;
  if (associatedUrl) return associatedUrl;
  return `https://www.surfline.com/surf-report/${slugify(record.name)}/${record._id}`;
}

function breadcrumbNames(breadcrumb = []) {
  return breadcrumb.map((item) => item.name || item).filter(Boolean);
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function cleanBreakTypes(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && !BOARD_TYPE_VALUES.has(item))
    : [];
}

function bestTravelDetails(primaryTravelDetails, existingSpot) {
  return primaryTravelDetails
    || existingSpot?.staticMetadata?.travelDetails
    || null;
}

function bestGuideSummary(travelDetails, existingSpot) {
  return existingSpot?.staticMetadata?.guideSummary
    || travelDetails?.description
    || "";
}

function bestBreakType(record, travelDetails, existingSpot, previous) {
  return firstNonEmptyArray(
    cleanBreakTypes(travelDetails?.breakType),
    cleanBreakTypes(existingSpot?.staticMetadata?.breakType),
    cleanBreakTypes(previous?.staticMetadata?.breakType),
    cleanBreakTypes(record.breakType)
  );
}

function currentSnapshot(record, primaryForecast = null) {
  const forecast = primaryForecast || record;
  return {
    conditions: forecast.conditions || null,
    rating: forecast.rating || null,
    surf: forecast.surf || null,
    waveHeight: forecast.waveHeight || null,
    wind: forecast.wind || null,
    swells: forecast.swells || [],
    tide: forecast.tide || null,
    weather: forecast.weather || null,
    waterTemp: forecast.waterTemp || null
  };
}

function addCandidate(candidatesByRemoteId, record, {
  source,
  url = null,
  primaryForecast = null,
  primaryTravelDetails = null,
  providedBreadcrumb = [],
  existingByRemoteId
}) {
  if (!record?._id || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return;

  const distanceFromLisbonKm = Number(haversineKm(CENTRAL_LISBON, record).toFixed(1));
  if (distanceFromLisbonKm > LISBON_RADIUS_KM) return;

  const existingSpot = existingByRemoteId.get(record._id);
  const previous = candidatesByRemoteId.get(record._id);
  const travelDetails = bestTravelDetails(primaryTravelDetails, existingSpot)
    || previous?.staticMetadata?.travelDetails
    || null;
  const offshoreDirection = Number.isFinite(record.offshoreDirection)
    ? record.offshoreDirection
    : previous?.staticMetadata?.coastExposure?.bearing ?? null;
  const breadcrumb = firstNonEmptyArray(
    breadcrumbNames(record.breadcrumb || []),
    breadcrumbNames(providedBreadcrumb),
    existingSpot?.staticMetadata?.breadcrumb,
    previous?.staticMetadata?.breadcrumb
  );

  const staticMetadata = {
    breadcrumb,
    guideSummary: bestGuideSummary(travelDetails, existingSpot),
    nearbySpotNames: existingSpot?.staticMetadata?.nearbySpotNames || previous?.staticMetadata?.nearbySpotNames || [],
    abilityLevels: firstNonEmptyArray(
      record.abilityLevels,
      travelDetails?.abilityLevels?.levels,
      existingSpot?.staticMetadata?.abilityLevels,
      previous?.staticMetadata?.abilityLevels
    ),
    boardTypes: firstNonEmptyArray(
      record.boardTypes,
      travelDetails?.boardTypes,
      existingSpot?.staticMetadata?.boardTypes,
      previous?.staticMetadata?.boardTypes
    ),
    breakType: bestBreakType(record, travelDetails, existingSpot, previous),
    travelDetails,
    coastExposure: offshoreDirection === null
      ? null
      : {
        bearing: offshoreDirection,
        source: "surfline-offshoreDirection",
        confidence: "spot"
      }
  };

  candidatesByRemoteId.set(record._id, {
    remoteSpotId: record._id,
    provider: "surfline",
    name: DISPLAY_NAME_OVERRIDES_BY_REMOTE_ID[record._id] || existingSpot?.name || previous?.name || record.name,
    url: reportUrl(record, url, existingByRemoteId),
    lat: record.lat,
    lon: record.lon,
    region: record.subregion?.name || existingSpot?.region || "",
    country: "Portugal",
    distanceFromLisbonKm,
    sourceRecords: [...new Set([...(previous?.sourceRecords || []), source])],
    staticMetadata,
    currentSnapshot: currentSnapshot(record, primaryForecast),
    refreshConcepts: existingSpot?.refreshConcepts || DEFAULT_REFRESH_CONCEPTS
  });
}

async function parseCachePages(existingByRemoteId) {
  const candidatesByRemoteId = new Map();
  const files = (await fs.readdir(CACHE_DIR))
    .filter((file) => file.endsWith(".html") && file.startsWith("surfline-"))
    .sort();

  for (const file of files) {
    const html = normalizeCachedHtml(await fs.readFile(path.join(CACHE_DIR, file), "utf8"));
    const state = extractNextData(html)?.props?.pageProps?.ssrReduxState;
    const report = state?.spot?.report;
    const primary = report?.data?.spot;
    const associatedUrl = report?.associated?.href;
    const primaryForecast = report?.data?.forecast || null;
    const nearbySpots = state?.spot?.nearby?.data?.spots || [];

    addCandidate(candidatesByRemoteId, primary, {
      source: `primary:${file}`,
      url: associatedUrl,
      primaryForecast,
      primaryTravelDetails: primary?.travelDetails || null,
      breadcrumb: primary?.breadcrumb || [],
      existingByRemoteId
    });

    nearbySpots.forEach((spot) => addCandidate(candidatesByRemoteId, spot, {
      source: `nearby:${file}`,
      primaryTravelDetails: candidatesByRemoteId.get(spot._id)?.staticMetadata?.travelDetails || null,
      existingByRemoteId
    }));
  }

  return candidatesByRemoteId;
}

function existingSpotsByRemoteId(existingDb) {
  return new Map((existingDb.spots || [])
    .map((spot) => [spot.remoteSpotId || extractRemoteSurflineId(spot.url), spot])
    .filter(([remoteSpotId]) => remoteSpotId));
}

function attachAppIds(candidatesByRemoteId, existingByRemoteId) {
  const usedIds = new Set();
  return [...candidatesByRemoteId.values()]
    .sort((a, b) => a.distanceFromLisbonKm - b.distanceFromLisbonKm || a.name.localeCompare(b.name))
    .map((spot) => {
      const id = appSpotId(spot.name, spot.remoteSpotId, existingByRemoteId, usedIds);
      usedIds.add(id);
      return { id, ...spot };
    });
}

async function main() {
  const existingDb = await readJson(SURFLINE_DB_PATH);
  const existingByRemoteId = existingSpotsByRemoteId(existingDb);
  const candidatesByRemoteId = await parseCachePages(existingByRemoteId);
  const spots = attachAppIds(candidatesByRemoteId, existingByRemoteId);

  const db = {
    schemaVersion: 2,
    provider: "surfline",
    generatedAt: new Date().toISOString(),
    coverage: {
      origin: CENTRAL_LISBON,
      radiusKm: LISBON_RADIUS_KM,
      method: "Primary Surfline report pages plus embedded nearby spot records from cached HTML."
    },
    source: {
      method: "Normalized from cached Surfline __NEXT_DATA__ payloads.",
      supportUrl: existingDb.source?.supportUrl || "https://support.surfline.com/hc/en-us/articles/13749782983579-Understanding-the-Spot-Forecast-Page-on-the-Surfline-Website"
    },
    staticMetadataFields: [
      "name",
      "url",
      "lat",
      "lon",
      "region",
      "country",
      "distanceFromLisbonKm",
      "breadcrumb",
      "guideSummary",
      "travelDetails",
      "breakType",
      "abilityLevels",
      "boardTypes",
      "coastExposure"
    ],
    refreshConcepts: DEFAULT_REFRESH_CONCEPTS,
    total: spots.length,
    spots
  };

  await fs.writeFile(SURFLINE_DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  console.log(`Wrote ${spots.length} Surfline spots within ${LISBON_RADIUS_KM}km of Lisbon.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
