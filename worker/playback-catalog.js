import cameraDb from "../data/beachcam-cameras.json" with { type: "json" };
import { resolveMeoPlaybackCameras } from "../src/feed-policy.js";

const playbackCatalog = new Map(
  resolveMeoPlaybackCameras(cameraDb).map(({ id, streamUrl }) => [
    id,
    Object.freeze({ id, streamUrl })
  ])
);

export function createPlaybackCatalog() {
  return new Map(playbackCatalog);
}

export function findPlaybackCamera(cameraId) {
  if (typeof cameraId !== "string" || !cameraId.trim()) return null;
  return playbackCatalog.get(cameraId) ?? null;
}

export function playbackCameraCount() {
  return playbackCatalog.size;
}
