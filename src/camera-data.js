import { CAMERA_DB_URL, LOCAL_STREAM_OVERRIDES_URL } from "./config.js";

export function parseEmbeddedCameraDb(documentRef = document) {
  const embedded = documentRef.querySelector("#embeddedCameraDb")?.textContent.trim();
  return embedded ? JSON.parse(embedded) : null;
}

function normalizeStreamOverride(override) {
  const normalized = typeof override === "string" ? { streamUrl: override } : override;
  if (!normalized || typeof normalized !== "object") return null;

  const streamUrl = typeof normalized.streamUrl === "string" ? normalized.streamUrl.trim() : "";
  if (!streamUrl) return null;

  const cameraOverride = {
    streamUrl,
    hasStream: true,
    streamOverride: true
  };

  if (typeof normalized.image === "string") cameraOverride.image = normalized.image;
  if (typeof normalized.livecamId === "string") cameraOverride.livecamId = normalized.livecamId;
  if (typeof normalized.videoId === "string") cameraOverride.videoId = normalized.videoId;

  return cameraOverride;
}

export function applyCameraStreamOverrides(cameraDb, streamOverrides = {}) {
  if (!cameraDb?.cameras?.length || !streamOverrides || typeof streamOverrides !== "object") {
    return cameraDb;
  }

  const cameras = cameraDb.cameras.map((camera) => {
    const streamOverride = normalizeStreamOverride(streamOverrides[camera.id]);
    return streamOverride ? { ...camera, ...streamOverride } : camera;
  });

  return {
    ...cameraDb,
    cameras,
    withStreams: cameras.filter((camera) => camera.hasStream).length
  };
}

export async function loadCameraStreamOverrides({
  fetcher = fetch,
  url = LOCAL_STREAM_OVERRIDES_URL
} = {}) {
  if (!url) return {};

  try {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) return {};
    const streamOverrides = await response.json();
    return streamOverrides && typeof streamOverrides === "object" ? streamOverrides : {};
  } catch {
    return {};
  }
}

export async function loadCameraDb({
  documentRef = document,
  fetcher = fetch,
  streamOverridesUrl = LOCAL_STREAM_OVERRIDES_URL
} = {}) {
  const embeddedDb = parseEmbeddedCameraDb(documentRef);
  const cameraDb = embeddedDb || await (async () => {
    const response = await fetcher(CAMERA_DB_URL);
    if (!response.ok) {
      throw new Error(`Failed to load camera database: HTTP ${response.status}`);
    }
    return response.json();
  })();
  const streamOverrides = await loadCameraStreamOverrides({ fetcher, url: streamOverridesUrl });

  return applyCameraStreamOverrides(cameraDb, streamOverrides);
}

export function availableCameras(cameraDb) {
  return cameraDb.cameras.filter((camera) => camera.hasStream);
}

export function firstClassCameras(cameraDb) {
  return cameraDb.cameras.filter((camera) => camera.hasStream || camera.firstClass);
}

export function mergePromotedSpots(cameraDb, promotedDb) {
  const promoted = promotedDb?.promoted || [];
  if (!promoted.length) return cameraDb;
  const promotedIds = new Set(promoted.map((p) => p.id));
  return {
    ...cameraDb,
    cameras: [...cameraDb.cameras.filter((c) => !promotedIds.has(c.id)), ...promoted]
  };
}
