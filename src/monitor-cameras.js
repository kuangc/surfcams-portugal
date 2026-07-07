import { MONITOR_CAMERA_LIMIT, SUGGESTION_FENCE } from "./config.js";
import { rateSurfSpot } from "./surf-rating.js";

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
  return sortByDistance(cameras
    .filter((camera) => !favoriteIds.has(camera.id))
    .filter(inSuggestionFence)
    .map((camera) => {
      const resolved = typeof getConditions === "function" ? getConditions(camera) : null;
      return { camera, resolved, rating: rateSurfSpot(camera, preferences, resolved) };
    })
    .filter((entry) => entry.resolved && entry.resolved.source !== "meo-static")
    .filter((entry) => entry.rating.isRecommended)
    .map((entry) => entry.camera), getDriveDistanceKm)
    .slice(0, limit);
}
