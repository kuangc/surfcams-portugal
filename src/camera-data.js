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
  return cameraDb.cameras.filter((camera) => (
    camera.hasStream
    || camera.firstClass
    || camera.promoted
    || camera.adviceGuideOnly
  ));
}

export function mergePromotedSpots(cameraDb, promotedDb) {
  const promoted = promotedDb?.promoted || [];
  if (!promoted.length) return cameraDb;
  const existingById = new Map(cameraDb.cameras.map((c) => [c.id, c]));
  const promotedIds = new Set(promoted.map((p) => p.id));
  // Promoted records win on collision, but stream fields (e.g. from
  // local-stream-overrides applied at load) must survive the replacement.
  const merged = promoted.map((record) => {
    const existing = existingById.get(record.id);
    if (!existing) return record;
    const streamUrl = record.streamUrl || existing.streamUrl || "";
    const out = { ...record, streamUrl, hasStream: Boolean(streamUrl) };
    if (!record.image && existing.image) out.image = existing.image;
    if (!record.livecamId && existing.livecamId) out.livecamId = existing.livecamId;
    if (!record.videoId && existing.videoId) out.videoId = existing.videoId;
    if (existing.streamOverride) out.streamOverride = true;
    return out;
  });
  return {
    ...cameraDb,
    cameras: [...cameraDb.cameras.filter((c) => !promotedIds.has(c.id)), ...merged]
  };
}

const RESERVED_SUBJECT_IDS = new Set(["__proto__", "constructor", "prototype"]);

function guideSubjects(adviceRuntime) {
  if (adviceRuntime?.subjectsById instanceof Map) {
    return [...adviceRuntime.subjectsById.entries()];
  }
  if (adviceRuntime?.subjects && typeof adviceRuntime.subjects === "object") {
    return Object.entries(adviceRuntime.subjects);
  }
  return [];
}

function safeHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function guideRecord(key, subject) {
  if (
    !subject?.guideOnly
    || typeof key !== "string"
    || typeof subject.id !== "string"
    || !subject.id.trim()
    || subject.id !== subject.id.trim()
    || key !== subject.id
    || RESERVED_SUBJECT_IDS.has(subject.id)
    || typeof subject.name !== "string"
    || !subject.name.trim()
    || typeof subject.region !== "string"
    || !subject.region.trim()
    || !Number.isFinite(subject.lat)
    || !Number.isFinite(subject.lon)
    || subject.lat < -90
    || subject.lat > 90
    || subject.lon < -180
    || subject.lon > 180
  ) {
    return null;
  }

  const pageUrl = safeHttpUrl(subject.surfline?.pageUrl);
  return {
    id: subject.id,
    name: subject.name,
    region: subject.region,
    lat: subject.lat,
    lon: subject.lon,
    ...(pageUrl ? { surfline: { pageUrl } } : {}),
    adviceGuideOnly: true
  };
}

export function mergeAdviceGuideSubjects(cameraDb, adviceRuntime) {
  if (!Array.isArray(cameraDb?.cameras)) return cameraDb;

  const existingIds = new Set(cameraDb.cameras.map((camera) => camera?.id).filter(Boolean));
  const appended = [];
  for (const [key, subject] of guideSubjects(adviceRuntime)) {
    const record = guideRecord(key, subject);
    if (!record || existingIds.has(record.id)) continue;
    existingIds.add(record.id);
    appended.push(record);
  }

  return appended.length
    ? { ...cameraDb, cameras: [...cameraDb.cameras, ...appended] }
    : cameraDb;
}

export function sanitizeFavoriteIds(cameras, favoriteIds) {
  const eligibleIds = new Set(
    (Array.isArray(cameras) ? cameras : [])
      .filter((camera) => camera?.id && !camera.adviceGuideOnly)
      .map((camera) => camera.id)
  );
  return new Set(
    favoriteIds && typeof favoriteIds[Symbol.iterator] === "function"
      ? [...favoriteIds].filter((id) => eligibleIds.has(id))
      : []
  );
}

export function routeCameraPlayback(camera, linkedCamera, player) {
  if (camera?.adviceGuideOnly) {
    player?.clear?.();
    return "guide";
  }

  const reportOnly = !camera?.streamUrl && Boolean(camera?.surfline?.pageUrl);
  if (reportOnly) {
    if (linkedCamera?.streamUrl) {
      player?.play?.(linkedCamera);
      return "linked-live";
    }
    player?.clear?.();
    return "report";
  }

  player?.play?.(camera);
  return "live";
}
