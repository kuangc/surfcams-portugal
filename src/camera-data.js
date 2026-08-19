import { CAMERA_DB_URL } from "./config.js";

export function parseEmbeddedCameraDb(documentRef = document) {
  const embedded = documentRef.querySelector("#embeddedCameraDb")?.textContent.trim();
  return embedded ? JSON.parse(embedded) : null;
}

export async function loadCameraDb({
  documentRef = document,
  fetcher = fetch
} = {}) {
  const embeddedDb = parseEmbeddedCameraDb(documentRef);
  const cameraDb = embeddedDb || await (async () => {
    const response = await fetcher(CAMERA_DB_URL);
    if (!response.ok) {
      throw new Error(`Failed to load camera database: HTTP ${response.status}`);
    }
    return response.json();
  })();
  return cameraDb;
}

export function availableCameras(cameraDb) {
  return cameraDb.cameras.filter((camera) => camera.hasStream);
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
