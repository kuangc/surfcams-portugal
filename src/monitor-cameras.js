import { MONITOR_CAMERA_LIMIT } from "./config.js";
import { rateSurfSpot } from "./surf-rating.js";

export function monitorCameraSlots(cameras, favoriteIds, favoriteOrder, limit = MONITOR_CAMERA_LIMIT) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const orderedFavorites = favoriteOrder
    .filter((id) => favoriteIds.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit);
  const slots = orderedFavorites.map((camera) => ({ camera, empty: false }));

  while (slots.length < limit) {
    slots.push({ camera: null, empty: true });
  }

  return slots;
}

export function mightBeGoodCameras(cameras, favoriteIds, preferences, limit = MONITOR_CAMERA_LIMIT) {
  return cameras
    .filter((camera) => !favoriteIds.has(camera.id))
    .map((camera) => ({ camera, rating: rateSurfSpot(camera, preferences) }))
    .filter((entry) => entry.rating.isRecommended)
    .slice(0, limit)
    .map((entry) => entry.camera);
}
