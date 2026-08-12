function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .toLocaleLowerCase();
}

export function isPlayableFavoriteCamera(camera) {
  if (!camera?.hasStream || camera.adviceGuideOnly || typeof camera.streamUrl !== "string") {
    return false;
  }

  try {
    return new URL(camera.streamUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function playableFeedKey(camera) {
  if (!isPlayableFavoriteCamera(camera)) return "";
  return new URL(camera.streamUrl).href;
}

export function uniquePlayableCameras(cameras, preferredIds = new Set()) {
  const byFeed = new Map();
  cameras.forEach((camera) => {
    const feedKey = playableFeedKey(camera);
    if (!feedKey) return;
    const existing = byFeed.get(feedKey);
    if (!existing || (!preferredIds.has(existing.id) && preferredIds.has(camera.id))) {
      byFeed.set(feedKey, camera);
    }
  });
  return [...byFeed.values()];
}

function providerFor(camera) {
  return camera.streamSource || camera.provider || camera.source || "";
}

function compareRecordNames(a, b) {
  return String(a.camera.name || "").localeCompare(String(b.camera.name || ""), undefined, {
    sensitivity: "base"
  });
}

export function playableFavoriteCatalog(cameras, favoriteIds = new Set()) {
  const aliasIdsByFeed = new Map();
  cameras.filter(isPlayableFavoriteCamera).forEach((camera) => {
    const feedKey = playableFeedKey(camera);
    const aliasIds = aliasIdsByFeed.get(feedKey) || [];
    aliasIds.push(camera.id);
    aliasIdsByFeed.set(feedKey, aliasIds);
  });
  return uniquePlayableCameras(cameras, favoriteIds)
    .map((camera) => {
      const aliasIds = aliasIdsByFeed.get(playableFeedKey(camera)) || [camera.id];
      return {
        camera,
        aliasIds,
        saved: aliasIds.some((id) => favoriteIds.has(id))
      };
    });
}

export function favoriteFeedRecord(catalog, camera) {
  const feedKey = playableFeedKey(camera);
  if (!feedKey) return null;
  return catalog.find(({ camera: candidate }) => playableFeedKey(candidate) === feedKey) || null;
}

export function searchFavoriteCatalog(
  catalog,
  { query = "", region = "", provider = "" } = {}
) {
  const normalizedQuery = normalizeCatalogText(query);
  const normalizedRegion = normalizeCatalogText(region);
  const normalizedProvider = normalizeCatalogText(provider);
  const results = catalog.filter(({ camera }) => {
    const haystack = [
      normalizeCatalogText(camera.name ?? ""),
      normalizeCatalogText(camera.location ?? ""),
      normalizeCatalogText(camera.region ?? "")
    ].join(" ");
    return (!normalizedQuery || haystack.includes(normalizedQuery))
      && (!normalizedRegion || normalizeCatalogText(camera.region) === normalizedRegion)
      && (!normalizedProvider || normalizeCatalogText(providerFor(camera)) === normalizedProvider);
  });

  if (!normalizedQuery) return results;

  return [...results].sort((a, b) => {
    const aExact = normalizeCatalogText(a.camera.name) === normalizedQuery;
    const bExact = normalizeCatalogText(b.camera.name) === normalizedQuery;
    return Number(bExact) - Number(aExact) || compareRecordNames(a, b);
  });
}

export function addFavorite(favoriteIds, cameraId, catalog) {
  const nextFavoriteIds = new Set(favoriteIds);
  const record = catalog.find(({ camera }) => camera.id === cameraId);
  if (!record) return nextFavoriteIds;
  (record.aliasIds || [cameraId]).forEach((id) => nextFavoriteIds.delete(id));
  nextFavoriteIds.add(cameraId);
  return nextFavoriteIds;
}
