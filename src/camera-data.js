import { CAMERA_DB_URL } from "./config.js";

export function parseEmbeddedCameraDb(documentRef = document) {
  const embedded = documentRef.querySelector("#embeddedCameraDb")?.textContent.trim();
  return embedded ? JSON.parse(embedded) : null;
}

export async function loadCameraDb({ documentRef = document, fetcher = fetch } = {}) {
  const embeddedDb = parseEmbeddedCameraDb(documentRef);
  if (embeddedDb) return embeddedDb;

  const response = await fetcher(CAMERA_DB_URL);
  if (!response.ok) {
    throw new Error(`Failed to load camera database: HTTP ${response.status}`);
  }
  return response.json();
}

export function availableCameras(cameraDb) {
  return cameraDb.cameras.filter((camera) => camera.hasStream);
}
