function normalizedText(value) {
  return String(value || "").trim();
}

export function aggregateMapMarkerLabel(cameras = []) {
  const count = cameras.length;
  const noun = cameras.some((camera) => camera?.exploreInformationOnly)
    ? "surf spots"
    : `surf camera${count === 1 ? "" : "s"}`;
  const contexts = [];
  const seen = new Set();

  cameras.forEach((camera) => {
    [camera?.location, camera?.region].forEach((value) => {
      const context = normalizedText(value);
      const key = context.toLocaleLowerCase();
      if (!context || seen.has(key)) return;
      seen.add(key);
      contexts.push(context);
    });
  });

  const visibleContexts = contexts.slice(0, 3);
  const remainingContextCount = contexts.length - visibleContexts.length;
  const geography = contexts.length
    ? `near ${visibleContexts.join(" · ")}${remainingContextCount ? ` + ${remainingContextCount} more area${remainingContextCount === 1 ? "" : "s"}` : ""}`
    : "in this area";
  return `${count} ${noun} ${geography}. Activate to zoom in.`;
}

export function shouldShowFavoriteResults({ query = "", region = "", provider = "" } = {}) {
  return normalizedText(query).length >= 2
    || Boolean(normalizedText(region))
    || Boolean(normalizedText(provider));
}

function coordinateCellSize(zoom) {
  if (zoom <= 6) return 2;
  if (zoom <= 8) return 0.5;
  return 0.16;
}

function validCoordinate(camera) {
  return Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon);
}

export function groupMobileMapMarkers(
  cameras,
  { zoom = 0, maxIndividualZoom = 10, priorityCameraId = null } = {}
) {
  const located = cameras.filter(validCoordinate);
  if (zoom >= maxIndividualZoom) {
    return located.map((camera) => ({
      key: camera.id,
      center: [camera.lat, camera.lon],
      cameras: [camera]
    }));
  }

  const cellSize = coordinateCellSize(zoom);
  const groupsByCell = new Map();
  located
    .filter((camera) => camera.id !== priorityCameraId)
    .forEach((camera) => {
    const key = `${Math.floor(camera.lat / cellSize)}:${Math.floor(camera.lon / cellSize)}`;
    const group = groupsByCell.get(key) || [];
    group.push(camera);
    groupsByCell.set(key, group);
  });

  const groups = [...groupsByCell.entries()].map(([key, groupCameras]) => ({
    key,
    center: [
      groupCameras.reduce((sum, camera) => sum + camera.lat, 0) / groupCameras.length,
      groupCameras.reduce((sum, camera) => sum + camera.lon, 0) / groupCameras.length
    ],
    cameras: groupCameras
  }));
  const priorityCamera = located.find((camera) => camera.id === priorityCameraId);
  if (priorityCamera) {
    groups.push({
      key: priorityCamera.id,
      center: [priorityCamera.lat, priorityCamera.lon],
      cameras: [priorityCamera]
    });
  }
  return groups;
}
