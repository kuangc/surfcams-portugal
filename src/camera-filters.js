import { normalizeText } from "./format.js";

export function filterCameras(
  cameras,
  {
    query = "",
    region = "",
    favoriteOnly = false,
    favoriteIds = new Set(),
    mightBeGoodOnly = false,
    isMightBeGood = () => true
  } = {}
) {
  const normalizedQuery = normalizeText(query);

  return cameras.filter((camera) => {
    const matchesRegion = !region || camera.region === region;
    const matchesFavorite = !favoriteOnly || favoriteIds.has(camera.id);
    const matchesMightBeGood = !mightBeGoodOnly || isMightBeGood(camera);
    const haystack = normalizeText(`${camera.name} ${camera.location} ${camera.region}`);
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesRegion && matchesFavorite && matchesMightBeGood && matchesQuery;
  });
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
