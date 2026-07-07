import {
  COAST_EXPOSURES_URL,
  LISBON_DRIVE_ESTIMATES_URL,
  MEO_SPOTS_URL,
  MEO_SURFLINE_MATCHES_URL,
  PROMOTED_SPOTS_URL,
  SPOT_METADATA_ENRICHMENT_URL,
  STRETCHES_URL,
  SURFLINE_CONDITIONS_URL,
  SURFLINE_SPOTS_URL
} from "./config.js";

export const CENTRAL_LISBON = {
  label: "Central Lisbon",
  lat: 38.7223,
  lon: -9.1393
};

const EMPTY_SPOT_DATA = {
  surflineDb: { spots: [] },
  meoDb: { spots: [] },
  mappingDb: { matches: [] },
  driveDb: { origin: CENTRAL_LISBON, estimates: [] },
  coastExposureDb: { exposures: [] },
  spotMetadataDb: { entries: [] },
  promotedDb: { promoted: [], deferred: [] },
  conditionsDb: { conditions: {} },
  stretchesDb: { stretches: [] }
};

function toMap(items = [], key = "id") {
  return new Map(items.map((item) => [item[key], item]));
}

function normalizeId(value) {
  return typeof value === "string" ? value : value?.id;
}

export function haversineKm(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = (sinLat * sinLat) + Math.cos(lat1) * Math.cos(lat2) * (sinLon * sinLon);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimateDrivingMinutes(distanceKm, profile = "regional") {
  const profiles = {
    "urban-coast": { multiplier: 1.35, averageKmh: 55, baseMinutes: 15 },
    "south-bank": { multiplier: 1.45, averageKmh: 58, baseMinutes: 18 },
    "regional": { multiplier: 1.18, averageKmh: 72, baseMinutes: 12 },
    "regional-long": { multiplier: 1.15, averageKmh: 80, baseMinutes: 14 }
  };
  const selected = profiles[profile] || profiles.regional;
  const rawMinutes = ((distanceKm * selected.multiplier) / selected.averageKmh) * 60 + selected.baseMinutes;

  return Math.max(5, Math.round(rawMinutes / 5) * 5);
}

export function estimateDrivingMinutesFromSeconds(durationSeconds) {
  if (!Number.isFinite(durationSeconds)) return null;
  return Math.max(5, Math.round((durationSeconds / 60) / 5) * 5);
}

export function formatDriveLabel(minutes) {
  if (!Number.isFinite(minutes)) return "drive ?";
  if (minutes < 60) return `~${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `~${hours}h ${remainder}m` : `~${hours}h`;
}

export function estimateRouteDistanceKm(distanceKm, profile = "regional") {
  const multipliers = {
    "urban-coast": 1.35,
    "south-bank": 1.45,
    "regional": 1.18,
    "regional-long": 1.15
  };
  return distanceKm * (multipliers[profile] || multipliers.regional);
}

export function formatDistanceLabel(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "distance ?";
  const rounded = Math.max(1, Math.round(distanceKm / 5) * 5);
  return `~${rounded}km`;
}

function routedDistanceKm(estimate) {
  const heuristicDistanceKm = Number.isFinite(estimate.distanceKm)
    ? estimateRouteDistanceKm(estimate.distanceKm, estimate.profile)
    : null;
  let routeDistanceKm = null;

  if (Number.isFinite(estimate.routeDistanceKm)) routeDistanceKm = estimate.routeDistanceKm;
  if (Number.isFinite(estimate.routeDistanceMeters)) {
    routeDistanceKm = Number((estimate.routeDistanceMeters / 1000).toFixed(1));
  }

  if (Number.isFinite(routeDistanceKm) && isPlausibleRouteDistance(estimate, routeDistanceKm)) {
    return routeDistanceKm;
  }
  return heuristicDistanceKm;
}

function rawRouteDistanceKm(estimate) {
  if (Number.isFinite(estimate.routeDistanceMeters)) {
    return Number((estimate.routeDistanceMeters / 1000).toFixed(1));
  }
  return Number.isFinite(estimate.routeDistanceKm) ? estimate.routeDistanceKm : null;
}

function isPlausibleRouteDistance(estimate, routeDistanceKm) {
  return !Number.isFinite(estimate.distanceKm) || routeDistanceKm >= estimate.distanceKm * 0.9;
}

function routedMinutes(estimate, routeDistanceKm) {
  const rawRouteDistance = rawRouteDistanceKm(estimate);
  const hasPlausibleRoute = Number.isFinite(rawRouteDistance)
    && isPlausibleRouteDistance(estimate, rawRouteDistance)
    && rawRouteDistance === routeDistanceKm;

  if (hasPlausibleRoute) {
    if (Number.isFinite(estimate.estimatedMinutes)) return estimate.estimatedMinutes;
    return estimateDrivingMinutesFromSeconds(estimate.durationSeconds);
  }

  if (Number.isFinite(estimate.distanceKm)) {
    return estimateDrivingMinutes(estimate.distanceKm, estimate.profile);
  }
  return Number.isFinite(estimate.estimatedMinutes)
    ? estimate.estimatedMinutes
    : estimateDrivingMinutesFromSeconds(estimate.durationSeconds);
}

function toStretchBySpotIdMap(stretches = []) {
  const stretchBySpotId = new Map();
  for (const stretch of stretches) {
    for (const spotId of stretch.surflineSpotIds || []) {
      stretchBySpotId.set(spotId, stretch);
    }
  }
  for (const stretch of stretches) {
    for (const camId of stretch.meoCamIds || []) {
      if (!stretchBySpotId.has(camId)) {
        stretchBySpotId.set(camId, stretch);
      }
    }
  }
  return stretchBySpotId;
}

export function normalizeSpotData({
  surflineDb = EMPTY_SPOT_DATA.surflineDb,
  meoDb = EMPTY_SPOT_DATA.meoDb,
  mappingDb = EMPTY_SPOT_DATA.mappingDb,
  driveDb = EMPTY_SPOT_DATA.driveDb,
  coastExposureDb = EMPTY_SPOT_DATA.coastExposureDb,
  spotMetadataDb = EMPTY_SPOT_DATA.spotMetadataDb,
  promotedDb = EMPTY_SPOT_DATA.promotedDb,
  conditionsDb = EMPTY_SPOT_DATA.conditionsDb,
  stretchesDb = EMPTY_SPOT_DATA.stretchesDb
} = EMPTY_SPOT_DATA) {
  const safeSurflineDb = surflineDb || EMPTY_SPOT_DATA.surflineDb;
  const safeMeoDb = meoDb || EMPTY_SPOT_DATA.meoDb;
  const safeMappingDb = mappingDb || EMPTY_SPOT_DATA.mappingDb;
  const safeDriveDb = driveDb || EMPTY_SPOT_DATA.driveDb;
  const safeCoastExposureDb = coastExposureDb || EMPTY_SPOT_DATA.coastExposureDb;
  const safeSpotMetadataDb = spotMetadataDb || EMPTY_SPOT_DATA.spotMetadataDb;
  const safePromotedDb = promotedDb || EMPTY_SPOT_DATA.promotedDb;
  const safeConditionsDb = conditionsDb || EMPTY_SPOT_DATA.conditionsDb;
  const safeStretchesDb = stretchesDb || EMPTY_SPOT_DATA.stretchesDb;
  const surflineById = toMap(safeSurflineDb.spots);
  const meoById = toMap(safeMeoDb.spots);
  const matchesByMeoId = toMap(safeMappingDb.matches, "meoSpotId");
  const driveByMeoId = toMap(safeDriveDb.estimates, "meoSpotId");
  const coastExposureById = toMap(safeCoastExposureDb.exposures);
  const spotMetadataById = toMap(safeSpotMetadataDb.entries);
  const conditionsById = new Map(Object.entries(safeConditionsDb.conditions || {}));
  const stretchBySpotId = toStretchBySpotIdMap(safeStretchesDb.stretches);

  return {
    surflineDb: safeSurflineDb,
    meoDb: safeMeoDb,
    mappingDb: safeMappingDb,
    driveDb: safeDriveDb,
    coastExposureDb: safeCoastExposureDb,
    spotMetadataDb: safeSpotMetadataDb,
    promotedDb: safePromotedDb,
    conditionsDb: safeConditionsDb,
    stretchesDb: safeStretchesDb,
    surflineById,
    meoById,
    matchesByMeoId,
    driveByMeoId,
    coastExposureById,
    spotMetadataById,
    conditionsById,
    stretchBySpotId,
    stretches: safeStretchesDb.stretches || []
  };
}

export function emptySpotData() {
  return normalizeSpotData();
}

export function findSurflineMatches(camera, normalizedSpotData) {
  const id = normalizeId(camera);
  const mapping = normalizedSpotData?.matchesByMeoId?.get(id);
  if (!mapping) return [];
  if (mapping.reviewStatus === "needs-review" || mapping.reviewStatus === "rejected") return [];

  return mapping.surflineSpotIds
    .map((surflineSpotId) => normalizedSpotData.surflineById.get(surflineSpotId))
    .filter(Boolean)
    .map((spot, index) => ({
      ...spot,
      matchRank: index + 1,
      mappingDistanceKm: mapping.distancesKm?.[spot.id] ?? null
    }));
}

export function findDriveEstimate(camera, normalizedSpotData) {
  const id = normalizeId(camera);
  const estimate = normalizedSpotData?.driveByMeoId?.get(id);
  if (!estimate) return null;

  const routeDistanceKm = routedDistanceKm(estimate);
  const minutes = routedMinutes(estimate, routeDistanceKm);
  const usesSourceLabels = isPlausibleRouteDistance(estimate, rawRouteDistanceKm(estimate));
  return {
    ...estimate,
    estimatedMinutes: minutes,
    routeDistanceKm,
    origin: normalizedSpotData.driveDb.origin || CENTRAL_LISBON,
    label: usesSourceLabels && estimate.label ? estimate.label : formatDriveLabel(minutes),
    distanceLabel: usesSourceLabels && estimate.distanceLabel ? estimate.distanceLabel : formatDistanceLabel(routeDistanceKm)
  };
}

export function applySpotMetadataToCameraDb(cameraDb, normalizedSpotData) {
  if (
    !cameraDb?.cameras?.length
    || (
      !normalizedSpotData?.coastExposureById?.size
      && !normalizedSpotData?.spotMetadataById?.size
    )
  ) {
    return cameraDb;
  }

  let changed = false;
  const cameras = cameraDb.cameras.map((camera) => {
    const metadata = normalizedSpotData.spotMetadataById?.get(camera.id)?.surfMetadata;
    const exposure = normalizedSpotData.coastExposureById.get(camera.id)?.coastExposure;
    if (!metadata && !exposure) return camera;

    changed = true;
    return {
      ...camera,
      surfMetadata: {
        ...camera.surfMetadata,
        ...metadata,
        coastExposure: exposure || metadata?.coastExposure || camera.surfMetadata?.coastExposure
      }
    };
  });

  return changed ? { ...cameraDb, cameras } : cameraDb;
}

export function applyCoastExposuresToCameraDb(cameraDb, normalizedSpotData) {
  return applySpotMetadataToCameraDb(cameraDb, normalizedSpotData);
}

async function fetchJson(fetcher, url) {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to load spot data from ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchOptionalJson(fetcher, url, fallback) {
  try {
    return await fetchJson(fetcher, url);
  } catch {
    return fallback;
  }
}

export async function loadSpotData({ fetcher = fetch } = {}) {
  const [
    surflineDb,
    meoDb,
    mappingDb,
    driveDb,
    coastExposureDb,
    spotMetadataDb,
    promotedDb,
    conditionsDb,
    stretchesDb
  ] = await Promise.all([
    fetchJson(fetcher, SURFLINE_SPOTS_URL),
    fetchJson(fetcher, MEO_SPOTS_URL),
    fetchJson(fetcher, MEO_SURFLINE_MATCHES_URL),
    fetchJson(fetcher, LISBON_DRIVE_ESTIMATES_URL),
    fetchOptionalJson(fetcher, COAST_EXPOSURES_URL, EMPTY_SPOT_DATA.coastExposureDb),
    fetchOptionalJson(fetcher, SPOT_METADATA_ENRICHMENT_URL, EMPTY_SPOT_DATA.spotMetadataDb),
    fetchOptionalJson(fetcher, PROMOTED_SPOTS_URL, EMPTY_SPOT_DATA.promotedDb),
    fetchOptionalJson(fetcher, SURFLINE_CONDITIONS_URL, EMPTY_SPOT_DATA.conditionsDb),
    fetchOptionalJson(fetcher, STRETCHES_URL, EMPTY_SPOT_DATA.stretchesDb)
  ]);

  return normalizeSpotData({
    surflineDb,
    meoDb,
    mappingDb,
    driveDb,
    coastExposureDb,
    spotMetadataDb,
    promotedDb,
    conditionsDb,
    stretchesDb
  });
}
