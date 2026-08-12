import { SUGGESTION_FENCE } from "./config.js";
import { isPlayableFavoriteCamera } from "./favorite-catalog.js";

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

export function monitorFavoriteCameras(
  cameras,
  favoriteIds,
  favoriteOrder,
  { getDriveDistanceKm = null } = {}
) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  return sortByDistance(
    favoriteOrder
      .filter((id) => favoriteIds.has(id))
      .map((id) => byId.get(id))
      .filter(isPlayableFavoriteCamera),
    getDriveDistanceKm
  );
}

export function inSuggestionFence(camera) {
  return Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon)
    && camera.lat >= SUGGESTION_FENCE.south && camera.lat <= SUGGESTION_FENCE.north
    && camera.lon <= SUGGESTION_FENCE.westOfLon;
}
