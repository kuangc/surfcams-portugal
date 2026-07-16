import { adviceSubjectIdFor } from "./spot-advice.js";

const RAW_REGISTRY_KEY = "__rawSurflineFeeds";
const RESERVED_IDS = new Set(["__meta", "__proto__", "constructor", "prototype"]);
const SAFE_CAMERA_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const SURFLINE_STILL_HOSTS = new Set(["camstills.cdn-surfline.com"]);

function safeHttpsUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeRawSurflineFeeds(localOverrides = {}) {
  const rows = Array.isArray(localOverrides?.[RAW_REGISTRY_KEY])
    ? localOverrides[RAW_REGISTRY_KEY]
    : [];
  const feeds = new Map();

  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!SAFE_CAMERA_ID.test(id) || RESERVED_IDS.has(id) || feeds.has(id)) continue;

    const streamUrl = safeHttpsUrl(row.streamUrl);
    const hasImage = Object.hasOwn(row, "image");
    const image = hasImage ? safeHttpsUrl(row.image) : null;
    if (!streamUrl || (hasImage && !image)) continue;

    feeds.set(id, { id, streamUrl, ...(image ? { image } : {}) });
  }

  return feeds;
}

export function extractSurflineCameraId(stillUrl) {
  if (typeof stillUrl !== "string") return null;

  try {
    const url = new URL(stillUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!SURFLINE_STILL_HOSTS.has(url.hostname)) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts.at(-2) || "";
    return SAFE_CAMERA_ID.test(id) && !RESERVED_IDS.has(id) ? id : null;
  } catch {
    return null;
  }
}

function hasHttpsStream(camera) {
  return Boolean(safeHttpsUrl(camera?.streamUrl));
}

function logicalSubjectId(camera, spotData) {
  if (camera?.promoted && typeof camera.id === "string") return camera.id;
  return adviceSubjectIdFor(camera, spotData);
}

function rawFeedForSubject(subject, rawFeeds) {
  for (const camera of subject?.surflineCams || []) {
    const id = extractSurflineCameraId(camera?.stillUrl);
    if (id && rawFeeds.has(id)) return rawFeeds.get(id);
  }
  return null;
}

function withRawSurflineFeed(camera, feed) {
  return {
    ...camera,
    streamSource: "surfline-raw",
    feedCameraId: feed.id,
    streamUrl: feed.streamUrl,
    image: feed.image || camera.image || "",
    hasStream: true
  };
}

function withMeoFeed(camera, source) {
  if (!hasHttpsStream(source)) return null;

  return {
    ...camera,
    streamSource: "meo",
    feedCameraId: source.livecamId || source.id,
    streamUrl: safeHttpsUrl(source.streamUrl),
    image: source.image || camera.image || "",
    hasStream: true
  };
}

export function resolveFeedBackedCameras(cameraDb, spotData, localOverrides = {}) {
  const cameras = Array.isArray(cameraDb?.cameras) ? cameraDb.cameras : [];
  const camerasById = new Map(cameras.map((camera) => [camera.id, camera]));
  const rawFeeds = normalizeRawSurflineFeeds(localOverrides);
  const rawFeedsBySubject = new Map();

  for (const camera of cameras) {
    if (!camera?.promoted || typeof camera.id !== "string") continue;
    const feed = rawFeedForSubject(camera, rawFeeds);
    if (feed) rawFeedsBySubject.set(camera.id, feed);
  }

  const resolved = [];
  for (const camera of cameras) {
    if (!camera || typeof camera.id !== "string") continue;

    const subjectId = logicalSubjectId(camera, spotData);
    const rawFeed = subjectId ? rawFeedsBySubject.get(subjectId) : null;
    if (rawFeed) {
      resolved.push(withRawSurflineFeed(camera, rawFeed));
      continue;
    }

    if (camera.promoted) {
      const linked = typeof camera.linkedCamId === "string"
        ? camerasById.get(camera.linkedCamId)
        : null;
      const fallback = withMeoFeed(camera, linked);
      if (fallback) resolved.push(fallback);
      continue;
    }

    if (camera.provider === "surfline") continue;
    const native = withMeoFeed(camera, camera);
    if (native) resolved.push(native);
  }

  return resolved;
}
