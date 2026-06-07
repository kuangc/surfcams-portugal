import { normalizeText } from "./format.js";
import { compareSurfFit, rateSurfSpot } from "./surf-rating.js";

export function filterCameras(
  cameras,
  {
    query = "",
    region = "",
    favoriteOnly = false,
    favoriteIds = new Set(),
    surfFitOnly = false,
    sortBySurfFit = false
  } = {}
) {
  const normalizedQuery = normalizeText(query);

  const filtered = cameras.filter((camera) => {
    const matchesRegion = !region || camera.region === region;
    const matchesFavorite = !favoriteOnly || favoriteIds.has(camera.id);
    const matchesSurfFit = !surfFitOnly || rateSurfSpot(camera).isRecommended;
    const haystack = normalizeText(`${camera.name} ${camera.location} ${camera.region}`);
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesRegion && matchesFavorite && matchesSurfFit && matchesQuery;
  });

  return sortBySurfFit ? filtered.sort(compareSurfFit) : filtered;
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
