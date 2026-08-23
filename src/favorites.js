import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "./config.js";
import {
  MEO_CAMERA_ID_RENAMES,
  canonicalMeoCameraId
} from "./meo-camera-identities.js";

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
        let migrated = false;
        const normalized = parsed.flatMap((id) => {
          if (availableIds.has(id)) return [id];
          if (typeof id !== "string" || !Object.hasOwn(MEO_CAMERA_ID_RENAMES, id)) return [];
          const replacementId = canonicalMeoCameraId(id);
          if (!availableIds.has(replacementId)) return [];
          migrated = true;
          return [replacementId];
        });
        const favoriteIds = new Set(normalized);
        if (migrated) {
          try {
            resolvedStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify([...favoriteIds]));
          } catch (_error) {
            // The in-memory migration is still valid when storage cannot be updated.
          }
        }
        return favoriteIds;
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
  let restoreFocus = null;
  let timerId = null;

  function clearPending() {
    if (timerId !== null) clearTimer(timerId);
    timerId = null;
    pendingCamera = null;
    restoreFocus = null;
  }

  function offer(camera, onSettle = null) {
    clearPending();
    pendingCamera = camera;
    restoreFocus = typeof onSettle === "function" ? onSettle : null;
    timerId = setTimer(() => {
      const expiredCamera = pendingCamera;
      const settle = restoreFocus;
      timerId = null;
      pendingCamera = null;
      restoreFocus = null;
      if (expiredCamera !== null) onExpire?.(expiredCamera);
      settle?.(expiredCamera);
    }, durationMs);
  }

  function consume() {
    if (pendingCamera === null) return null;
    const camera = pendingCamera;
    clearPending();
    return camera;
  }

  function consumeOffer() {
    if (pendingCamera === null) return null;
    const offer = { camera: pendingCamera, restoreFocus };
    clearPending();
    return offer;
  }

  return {
    offer,
    consume,
    consumeOffer,
    cancel: clearPending,
    cleanup: clearPending
  };
}
