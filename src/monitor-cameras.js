import { MONITOR_CAMERA_LIMIT, SUGGESTION_FENCE } from "./config.js";
import { rateSurfSpot, SURFLINE_RATING_ORDER } from "./surf-rating.js";

function compareDistance(a, b, getDriveDistanceKm) {
  const aDistance = getDriveDistanceKm(a);
  const bDistance = getDriveDistanceKm(b);
  const aFinite = Number.isFinite(aDistance);
  const bFinite = Number.isFinite(bDistance);

  if (aFinite && bFinite && aDistance !== bDistance) return aDistance - bDistance;
  if (aFinite !== bFinite) return aFinite ? -1 : 1;
  return 0;
}

function sortByDistance(cameras, getDriveDistanceKm) {
  if (typeof getDriveDistanceKm !== "function") return cameras;
  return [...cameras].sort((a, b) => compareDistance(a, b, getDriveDistanceKm));
}

function ratingRank(rating) {
  const idx = SURFLINE_RATING_ORDER.indexOf(String(rating || "").toUpperCase());
  return idx >= 0 ? idx : -1;
}

function compareMightBeGoodEntries(a, b, getDriveDistanceKm) {
  const distanceDelta = typeof getDriveDistanceKm === "function"
    ? compareDistance(a.camera, b.camera, getDriveDistanceKm)
    : 0;
  if (distanceDelta) return distanceDelta;

  return ratingRank(b.resolved?.rating) - ratingRank(a.resolved?.rating);
}

export function monitorCameraSlots(
  cameras,
  favoriteIds,
  favoriteOrder,
  limit = MONITOR_CAMERA_LIMIT,
  { getDriveDistanceKm = null } = {}
) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const orderedFavorites = sortByDistance(favoriteOrder
    .filter((id) => favoriteIds.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean), getDriveDistanceKm)
    .slice(0, limit);
  const slots = orderedFavorites.map((camera) => ({ camera, empty: false }));

  while (slots.length < limit) {
    slots.push({ camera: null, empty: true });
  }

  return slots;
}

export function inSuggestionFence(camera) {
  return Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon)
    && camera.lat >= SUGGESTION_FENCE.south && camera.lat <= SUGGESTION_FENCE.north
    && camera.lon <= SUGGESTION_FENCE.westOfLon;
}

export function mightBeGoodCameras(
  cameras,
  favoriteIds,
  preferences,
  limit = MONITOR_CAMERA_LIMIT,
  { getDriveDistanceKm = null, getConditions = null } = {}
) {
  return cameras
    .filter((camera) => !favoriteIds.has(camera.id))
    .filter(inSuggestionFence)
    .map((camera) => {
      const resolved = typeof getConditions === "function" ? getConditions(camera) : null;
      return { camera, resolved, rating: rateSurfSpot(camera, preferences, resolved) };
    })
    .filter((entry) => entry.resolved && entry.resolved.source !== "meo-static")
    .filter((entry) => entry.rating.isRecommended)
    .sort((a, b) => compareMightBeGoodEntries(a, b, getDriveDistanceKm))
    .map((entry) => entry.camera)
    .slice(0, limit);
}
