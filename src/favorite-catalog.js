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

function providerFor(camera) {
  return camera.streamSource || camera.provider || camera.source || "";
}

function compareRecordNames(a, b) {
  return String(a.camera.name || "").localeCompare(String(b.camera.name || ""), undefined, {
    sensitivity: "base"
  });
}

export function playableFavoriteCatalog(cameras, favoriteIds = new Set()) {
  return cameras
    .filter(isPlayableFavoriteCamera)
    .map((camera) => ({ camera, saved: favoriteIds.has(camera.id) }));
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
  if (nextFavoriteIds.has(cameraId)) return nextFavoriteIds;
  if (!catalog.some(({ camera }) => camera.id === cameraId)) return nextFavoriteIds;
  nextFavoriteIds.add(cameraId);
  return nextFavoriteIds;
}
