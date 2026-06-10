import { normalizeText } from "./format.js";
import { parseMetricNumber } from "./surf-rating.js";

const CONDITION_RANKS = {
  good: 3,
  caution: 2,
  poor: 1
};

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareName(a, b) {
  return compareText(a.name, b.name);
}

function compareFavorite(a, b, favoriteIds) {
  return Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id));
}

function compareNumberDesc(a, b, getValue) {
  const aValue = getValue(a);
  const bValue = getValue(b);
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);

  if (aFinite && bFinite && aValue !== bValue) return bValue - aValue;
  if (aFinite !== bFinite) return aFinite ? -1 : 1;
  return 0;
}

function compareNumberAsc(a, b, getValue) {
  const aValue = getValue(a);
  const bValue = getValue(b);
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);

  if (aFinite && bFinite && aValue !== bValue) return aValue - bValue;
  if (aFinite !== bFinite) return aFinite ? -1 : 1;
  return 0;
}

function waveMeters(camera) {
  return parseMetricNumber(camera.forecast?.wave || camera.detailMetrics?.Ondulação);
}

function conditionRank(camera, getConditionRank) {
  const value = getConditionRank(camera);
  const key = typeof value === "string" ? value : value?.key;
  if (value?.isRecommended) return CONDITION_RANKS.good;
  return CONDITION_RANKS[key] || 0;
}

function compareCameras(a, b, sort, favoriteIds, getConditionRank, getDriveDistanceKm) {
  switch (sort) {
    case "favorites":
      return compareFavorite(a, b, favoriteIds) || compareName(a, b);
    case "distance":
      return compareNumberAsc(a, b, getDriveDistanceKm) || compareName(a, b);
    case "name":
      return compareName(a, b);
    case "region":
      return compareText(a.region, b.region) || compareName(a, b);
    case "popular":
      return compareNumberDesc(a, b, (camera) => camera.clicks) || compareName(a, b);
    case "wave":
      return compareNumberDesc(a, b, waveMeters) || compareName(a, b);
    case "fit":
      return compareNumberDesc(a, b, (camera) => conditionRank(camera, getConditionRank)) || compareName(a, b);
    default:
      return 0;
  }
}

export function filterCameras(
  cameras,
  {
    query = "",
    region = "",
    favoriteOnly = false,
    favoriteIds = new Set(),
    favoriteStatus = "",
    streamStatus = "",
    maxDistanceKm = "",
    mightBeGoodOnly = false,
    isMightBeGood = () => true,
    sort = "",
    getConditionRank = () => null,
    getDriveDistanceKm = () => null
  } = {}
) {
  const normalizedQuery = normalizeText(query);
  const maxDistance = maxDistanceKm === "" || maxDistanceKm === null || maxDistanceKm === undefined
    ? null
    : Number(maxDistanceKm);

  const filtered = cameras.filter((camera) => {
    const isFavorite = favoriteIds.has(camera.id);
    const driveDistanceKm = getDriveDistanceKm(camera);
    const matchesRegion = !region || camera.region === region;
    const matchesFavorite = !favoriteOnly || isFavorite;
    const matchesFavoriteStatus = !favoriteStatus
      || favoriteStatus === "all"
      || (favoriteStatus === "favorites" && isFavorite)
      || (favoriteStatus === "not-favorites" && !isFavorite);
    const matchesStreamStatus = !streamStatus
      || streamStatus === "all"
      || (streamStatus === "live" && camera.hasStream)
      || (streamStatus === "no-stream" && !camera.hasStream);
    const matchesDistance = !Number.isFinite(maxDistance)
      || (Number.isFinite(driveDistanceKm) && driveDistanceKm <= maxDistance);
    const matchesMightBeGood = !mightBeGoodOnly || isMightBeGood(camera);
    const haystack = normalizeText(`${camera.name} ${camera.location} ${camera.region}`);
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesRegion
      && matchesFavorite
      && matchesFavoriteStatus
      && matchesStreamStatus
      && matchesDistance
      && matchesMightBeGood
      && matchesQuery;
  });

  return sort
    ? [...filtered].sort((a, b) => compareCameras(a, b, sort, favoriteIds, getConditionRank, getDriveDistanceKm))
    : filtered;
}

export function camerasInBounds(cameras, bounds) {
  if (!bounds?.contains) return cameras;

  return cameras.filter((camera) => (
    Number.isFinite(camera.lat)
    && Number.isFinite(camera.lon)
    && bounds.contains([camera.lat, camera.lon])
  ));
}

export function uniqueSortedRegions(cameras) {
  return [...new Set(cameras.map((camera) => camera.region).filter(Boolean))].sort();
}

export function camerasForInitialBounds(cameras, defaultFavoriteIds, initialBoundsIds) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  return [
    ...defaultFavoriteIds,
    ...initialBoundsIds
  ]
    .map((id) => byId.get(id))
    .filter(Boolean);
}

export function firstCameraById(cameras, ids) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  return ids.map((id) => byId.get(id)).find(Boolean) || null;
}
