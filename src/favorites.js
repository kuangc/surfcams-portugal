import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "./config.js";

export function defaultFavoriteSet(availableIds, defaultIds = DEFAULT_FAVORITE_IDS) {
  return new Set(defaultIds.filter((id) => availableIds.has(id)));
}

export function loadFavoriteIds(cameras, storage = window.localStorage) {
  const availableIds = new Set(cameras.map((camera) => camera.id));
  const stored = storage.getItem(FAVORITE_STORAGE_KEY);

  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id) => availableIds.has(id)));
      }
    } catch (_error) {
      // Fall through to defaults when stored data is invalid.
    }
  }

  return defaultFavoriteSet(availableIds);
}

export function saveFavoriteIds(favoriteIds, storage = window.localStorage) {
  storage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify([...favoriteIds]));
}

