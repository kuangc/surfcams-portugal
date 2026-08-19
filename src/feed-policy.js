const RESERVED_IDS = new Set(["__meta", "__proto__", "constructor", "prototype"]);
const SAFE_CAMERA_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const MEO_STREAM_HOST = "video-auth1.iol.pt";

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function httpsStreamUrl(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    return url.protocol === "https:"
      && url.hostname === MEO_STREAM_HOST
      && !url.username
      && !url.password
      && !url.port
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function hasValidCoordinates(camera) {
  return Number.isFinite(camera?.lat)
    && camera.lat >= -90
    && camera.lat <= 90
    && Number.isFinite(camera?.lon)
    && camera.lon >= -180
    && camera.lon <= 180;
}

function isSurflineRecord(camera) {
  return normalizeText(camera?.provider).toLowerCase().startsWith("surfline");
}

function normalizeNativeCamera(camera) {
  if (
    !camera
    || typeof camera !== "object"
    || camera.promoted
    || camera.adviceGuideOnly
    || camera.streamOverride
    || isSurflineRecord(camera)
    || camera.hasStream !== true
    || !hasValidCoordinates(camera)
  ) {
    return null;
  }

  const id = normalizeText(camera.id);
  const name = normalizeText(camera.name);
  const location = normalizeText(camera.location);
  const region = normalizeText(camera.region);
  const streamUrl = httpsStreamUrl(camera.streamUrl);
  if (
    !SAFE_CAMERA_ID.test(id)
    || RESERVED_IDS.has(id)
    || !name
    || !location
    || !region
    || !streamUrl
  ) {
    return null;
  }

  const livecamId = normalizeText(camera.livecamId);
  const feedCameraId = livecamId || id;
  const normalized = {
    ...camera,
    id,
    name,
    location,
    region,
    streamUrl,
    streamSource: "meo",
    feedCameraId,
    hasStream: true
  };
  if (typeof camera.image === "string") normalized.image = camera.image.trim();
  if (typeof camera.livecamId === "string") normalized.livecamId = livecamId;
  return normalized;
}

/**
 * Build the playable catalog from the provider-native MEO database only.
 *
 * Surfline-enriched fields already attached to native rows are preserved for
 * conditions and advice. Promoted/report identities and any legacy stream
 * substitution are deliberately excluded from playback.
 */
export function resolveMeoPlaybackCameras(cameraDb) {
  const cameras = Array.isArray(cameraDb?.cameras) ? cameraDb.cameras : [];
  const seenIds = new Set();
  const seenFeedIds = new Set();
  const seenStreamUrls = new Set();
  const resolved = [];

  for (const camera of cameras) {
    const normalized = normalizeNativeCamera(camera);
    if (
      !normalized
      || seenIds.has(normalized.id)
      || seenFeedIds.has(normalized.feedCameraId)
      || seenStreamUrls.has(normalized.streamUrl)
    ) {
      continue;
    }

    seenIds.add(normalized.id);
    seenFeedIds.add(normalized.feedCameraId);
    seenStreamUrls.add(normalized.streamUrl);
    resolved.push(normalized);
  }

  return resolved;
}
