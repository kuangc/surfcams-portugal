import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "./config.js";

export function defaultFavoriteSet(availableIds, defaultIds = DEFAULT_FAVORITE_IDS) {
  return new Set(defaultIds.filter((id) => availableIds.has(id)));
}

function validAliasEntry(source, target) {
  return typeof source === "string"
    && source.length > 0
    && source === source.trim()
    && typeof target === "string"
    && target.length > 0
    && target === target.trim()
    && source !== target;
}

export function buildFavoriteIdAliases(promotedDb, identityReplacements = {}) {
  const aliases = new Map();
  const promotedRows = Array.isArray(promotedDb?.promoted) ? promotedDb.promoted : [];
  for (const promoted of promotedRows) {
    const linkedCamId = validAliasEntry(promoted?.id, promoted?.linkedCamId)
      ? promoted.linkedCamId
      : null;
    const stretchCamId = Array.isArray(promoted?.stretchCamIds)
      ? promoted.stretchCamIds.find((cameraId) => validAliasEntry(promoted?.id, cameraId))
      : null;
    const replacementId = linkedCamId || stretchCamId;
    if (replacementId) aliases.set(promoted.id, replacementId);
  }

  const identityEntries = identityReplacements instanceof Map
    ? identityReplacements.entries()
    : Object.entries(identityReplacements || {});
  for (const [source, target] of identityEntries) {
    if (validAliasEntry(source, target)) aliases.set(source, target);
  }
  return aliases;
}

export function canonicalFavoriteId(id, availableIds, aliases = new Map()) {
  if (typeof id !== "string") return null;
  if (availableIds.has(id)) return id;
  const replacement = aliases?.get?.(id);
  return typeof replacement === "string" && availableIds.has(replacement)
    ? replacement
    : null;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function loadFavoriteIds(cameras, storage, aliases = new Map()) {
  const availableIds = new Set(cameras.map((camera) => camera.id));
  let resolvedStorage;
  let stored;
  try {
    resolvedStorage = storage === undefined ? window.localStorage : storage;
    stored = resolvedStorage.getItem(FAVORITE_STORAGE_KEY);
  } catch (_error) {
    return defaultFavoriteSet(availableIds);
  }

  if (stored === null) return defaultFavoriteSet(availableIds);

  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch (_error) {
    return defaultFavoriteSet(availableIds);
  }
  if (!Array.isArray(parsed)) return defaultFavoriteSet(availableIds);

  const normalized = [];
  const seen = new Set();
  for (const id of parsed) {
    const canonicalId = canonicalFavoriteId(id, availableIds, aliases);
    if (canonicalId === null || seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    normalized.push(canonicalId);
  }

  if (!sameOrderedValues(parsed, normalized)) {
    try {
      resolvedStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_error) {
      // Migration persistence is best-effort; the normalized selection is usable now.
    }
  }

  return new Set(normalized);
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
