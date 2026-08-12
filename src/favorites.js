import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "./config.js";

export function defaultFavoriteSet(availableIds, defaultIds = DEFAULT_FAVORITE_IDS) {
  return new Set(defaultIds.filter((id) => availableIds.has(id)));
}

export function loadFavoriteIds(cameras, storage) {
  const availableIds = new Set(cameras.map((camera) => camera.id));
  try {
    const resolvedStorage = storage === undefined ? window.localStorage : storage;
    const stored = resolvedStorage.getItem(FAVORITE_STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id) => availableIds.has(id)));
      }
    }
  } catch (_error) {
    // Fall through to defaults when storage is unavailable or data is invalid.
  }

  return defaultFavoriteSet(availableIds);
}

export function saveFavoriteIds(favoriteIds, storage = window.localStorage) {
  storage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify([...favoriteIds]));
}

export function commitFavoriteMutation(
  currentFavoriteIds,
  mutate,
  storage = window.localStorage
) {
  const nextFavoriteIds = new Set(currentFavoriteIds);
  mutate(nextFavoriteIds);
  saveFavoriteIds(nextFavoriteIds, storage);
  return nextFavoriteIds;
}

export function createFavoriteUndo({
  durationMs = 10_000,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  onExpire
} = {}) {
  let pendingCamera = null;
  let timerId = null;

  function clearPending() {
    if (timerId !== null) clearTimer(timerId);
    timerId = null;
    pendingCamera = null;
  }

  function offer(camera) {
    clearPending();
    pendingCamera = camera;
    timerId = setTimer(() => {
      const expiredCamera = pendingCamera;
      timerId = null;
      pendingCamera = null;
      if (expiredCamera !== null) onExpire?.(expiredCamera);
    }, durationMs);
  }

  function consume() {
    if (pendingCamera === null) return null;
    const camera = pendingCamera;
    clearPending();
    return camera;
  }

  return {
    offer,
    consume,
    cancel: clearPending,
    cleanup: clearPending
  };
}
