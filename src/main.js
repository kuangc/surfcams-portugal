import { availableCameras, loadCameraDb } from "./camera-data.js";
import {
  camerasForInitialBounds,
  filterCameras,
  firstCameraById,
  uniqueSortedRegions
} from "./camera-filters.js";
import { DEFAULT_FAVORITE_IDS, HLS_SCRIPT_URL, INITIAL_BOUNDS_IDS, MAX_CAMERA_LIST_ROWS } from "./config.js";
import { loadFavoriteIds, saveFavoriteIds } from "./favorites.js";
import { formatRegion, formatTideState } from "./format.js";
import { getConditionVectors, rateSurfSpot } from "./surf-rating.js";
import { createVideoPlayer } from "./video-player.js";

const state = {
  db: null,
  cameras: [],
  filtered: [],
  favoriteIds: new Set(),
  markers: new Map(),
  markerLayer: null,
  selected: null,
  map: null
};

const els = {
  mapStatus: document.querySelector("#mapStatus"),
  totalCount: document.querySelector("#totalCount"),
  fitCount: document.querySelector("#fitCount"),
  shownCount: document.querySelector("#shownCount"),
  searchInput: document.querySelector("#searchInput"),
  regionSelect: document.querySelector("#regionSelect"),
  fitOnly: document.querySelector("#fitOnly"),
  favoriteOnly: document.querySelector("#favoriteOnly"),
  cameraList: document.querySelector("#cameraList"),
  listNote: document.querySelector("#listNote"),
  detailName: document.querySelector("#detailName"),
  detailLocation: document.querySelector("#detailLocation"),
  detailFavorite: document.querySelector("#detailFavorite"),
  surfBadge: document.querySelector("#surfBadge"),
  surfSummary: document.querySelector("#surfSummary"),
  ratingReasons: document.querySelector("#ratingReasons"),
  coastVector: document.querySelector("#coastVector"),
  windVector: document.querySelector("#windVector"),
  swellVector: document.querySelector("#swellVector"),
  description: document.querySelector("#description"),
  metadataGrid: document.querySelector("#metadataGrid"),
  video: document.querySelector("#video"),
  playButton: document.querySelector("#playButton")
};

const videoPlayer = createVideoPlayer({
  video: els.video,
  status: els.mapStatus,
  hlsScriptUrl: HLS_SCRIPT_URL
});

function toggleFavorite(camera, checked) {
  if (!camera) return;

  if (checked) {
    state.favoriteIds.add(camera.id);
  } else {
    state.favoriteIds.delete(camera.id);
  }

  saveFavoriteIds(state.favoriteIds);
  applyFilters();
  selectCamera(camera, { pan: false });
}

function markerIcon(camera, active = false) {
  const rating = rateSurfSpot(camera);

  return L.divIcon({
    className: "",
    html: `<span class="cam-marker" data-live="${camera.hasStream}" data-active="${active}" data-favorite="${state.favoriteIds.has(camera.id)}" data-rating="${rating.key}"></span>`,
    iconSize: active ? [28, 28] : [20, 20],
    iconAnchor: active ? [14, 14] : [10, 10],
    popupAnchor: [0, -12]
  });
}

function createMetadataItem(label, value) {
  if (!value) return null;

  const item = document.createElement("div");
  item.className = "metadata-item";

  const labelEl = document.createElement("span");
  labelEl.className = "meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  return item;
}

function renderMetadata(camera) {
  const rating = rateSurfSpot(camera);
  const vectors = getConditionVectors(camera);
  const tideState = formatTideState(camera.forecast?.tideState);
  const tide = [tideState, camera.forecast?.tide].filter(Boolean).join(" ");
  const metrics = [
    createMetadataItem("Surf", rating.wave.label),
    rating.wave.estimated ? createMetadataItem("Source Swell", camera.forecast?.wave) : null,
    createMetadataItem("Period", camera.detailMetrics?.["Período das ondas"]),
    createMetadataItem("Swell Dir", vectors.swell.label.replace("Swell from ", "")),
    createMetadataItem("Wind", rating.wind.label),
    createMetadataItem("Wind Fit", rating.wind.alignment),
    createMetadataItem("Coast", vectors.coast.label),
    createMetadataItem("Tide", tide),
    createMetadataItem("Sea Temp", camera.detailMetrics?.["Temp. do mar"])
  ].filter(Boolean);

  els.metadataGrid.textContent = "";
  els.metadataGrid.append(...metrics);
}

function renderVector(vectorEl, label, vector, note = "") {
  const arrow = vectorEl.querySelector(".vector-arrow");
  const labelEl = vectorEl.querySelector(".vector-label");
  const noteEl = vectorEl.querySelector(".vector-note");
  const hasBearing = Number.isFinite(vector.bearing);
  const arrowBearing = Number.isFinite(vector.arrowBearing) ? vector.arrowBearing : vector.bearing;

  arrow.dataset.known = String(hasBearing);
  arrow.style.setProperty("--bearing", `${hasBearing ? arrowBearing : 0}deg`);
  labelEl.textContent = label;
  noteEl.textContent = note || vector.label;
}

function renderConditionVisual(camera) {
  const vectors = getConditionVectors(camera);

  renderVector(els.coastVector, "Coast", vectors.coast, `${vectors.coast.label} (${vectors.coast.confidence})`);
  renderVector(els.windVector, "Wind", vectors.wind, `${vectors.wind.label} · ${vectors.wind.alignment}`);
  renderVector(els.swellVector, "Swell", vectors.swell);
}

function renderSurfRating(camera) {
  const rating = rateSurfSpot(camera);
  const surfSize = rating.wave.estimated ? rating.wave.label : `${rating.wave.label} waves`;

  els.surfBadge.textContent = rating.label;
  els.surfBadge.dataset.rating = rating.key;
  els.surfSummary.textContent = `${surfSize} · ${rating.wind.label} · ${rating.period.label} period`;
  els.ratingReasons.textContent = "";

  rating.reasons.forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    els.ratingReasons.appendChild(item);
  });
}

function findCameraRow(cameraId) {
  return [...els.cameraList.querySelectorAll(".camera-row")]
    .find((row) => row.dataset.cameraRow === cameraId);
}

function selectCamera(camera, options = {}) {
  if (!camera) return;

  const previous = state.selected;
  state.selected = camera;

  if (previous && state.markers.has(previous.id)) {
    state.markers.get(previous.id).setIcon(markerIcon(previous, false));
  }
  if (state.markers.has(camera.id)) {
    state.markers.get(camera.id).setIcon(markerIcon(camera, true));
    if (options.pan !== false) state.map.panTo([camera.lat, camera.lon]);
  }

  els.detailName.textContent = camera.name;
  els.detailLocation.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;
  els.description.textContent = camera.description || "";
  els.playButton.disabled = !camera.streamUrl;
  els.detailFavorite.checked = state.favoriteIds.has(camera.id);
  renderSurfRating(camera);
  renderConditionVisual(camera);
  renderMetadata(camera);

  els.mapStatus.textContent = camera.streamUrl
    ? `${camera.name}: feed ready.`
    : `${camera.name}: no feed URL indexed.`;

  els.cameraList.querySelectorAll(".camera-row[aria-current='true']").forEach((row) => {
    row.setAttribute("aria-current", "false");
  });
  const row = findCameraRow(camera.id);
  if (row) row.setAttribute("aria-current", "true");
  if (options.play) videoPlayer.play(camera);
}

function applyFilters() {
  state.filtered = filterCameras(state.cameras, {
    query: els.searchInput.value,
    region: els.regionSelect.value,
    surfFitOnly: els.fitOnly.checked,
    sortBySurfFit: true,
    favoriteOnly: els.favoriteOnly.checked,
    favoriteIds: state.favoriteIds
  });

  renderMarkers();
  renderList();
  els.shownCount.textContent = state.filtered.length;
  els.fitCount.textContent = state.cameras.filter((camera) => rateSurfSpot(camera).isRecommended).length;
  els.mapStatus.textContent = `${state.filtered.length} cameras shown · ${state.filtered.filter((camera) => rateSurfSpot(camera).isRecommended).length} good for us.`;

  if (state.selected && !state.filtered.some((camera) => camera.id === state.selected.id) && state.filtered[0]) {
    selectCamera(state.filtered[0], { pan: false });
  }
}

function renderMarkers() {
  state.markerLayer.clearLayers();

  state.filtered.forEach((camera) => {
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) return;

    let marker = state.markers.get(camera.id);
    if (!marker) {
      marker = L.marker([camera.lat, camera.lon], {
        icon: markerIcon(camera, camera.id === state.selected?.id)
      });
      marker.on("click", () => selectCamera(camera, { play: true, pan: false }));
      state.markers.set(camera.id, marker);
    }

    marker.setIcon(markerIcon(camera, camera.id === state.selected?.id));
    state.markerLayer.addLayer(marker);
  });
}

function fitCameraBounds(cameras, padding = [34, 34]) {
  const bounds = cameras
    .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon))
    .map((camera) => [camera.lat, camera.lon]);

  if (bounds.length) state.map.fitBounds(bounds, { padding });
}

function fitInitialBounds() {
  const boundsCameras = camerasForInitialBounds(state.cameras, DEFAULT_FAVORITE_IDS, INITIAL_BOUNDS_IDS);
  fitCameraBounds(boundsCameras, [42, 42]);
}

function createCameraRow(camera) {
  const rating = rateSurfSpot(camera);
  const row = document.createElement("div");
  row.className = "camera-row";
  row.dataset.cameraRow = camera.id;
  row.setAttribute("aria-current", String(camera.id === state.selected?.id));

  const openButton = document.createElement("button");
  openButton.className = "camera-open";
  openButton.type = "button";
  openButton.addEventListener("click", () => selectCamera(camera, { play: true }));

  const name = document.createElement("span");
  name.className = "camera-row__name";
  name.textContent = camera.name;

  const meta = document.createElement("span");
  meta.className = "camera-row__meta";
  meta.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;

  const conditions = document.createElement("span");
  conditions.className = "camera-row__conditions";

  const score = document.createElement("span");
  score.className = "rating-chip";
  score.dataset.rating = rating.key;
  score.textContent = rating.label;

  const wave = document.createElement("span");
  wave.className = "condition-chip";
  wave.textContent = rating.wave.label;

  const windFit = document.createElement("span");
  windFit.className = "condition-chip condition-chip--wind-fit";
  windFit.dataset.fit = rating.wind.alignment;
  windFit.textContent = rating.wind.alignment;

  conditions.append(score, wave, windFit);
  openButton.append(name, meta, conditions);

  const favoriteLabel = document.createElement("label");
  favoriteLabel.className = "favorite-check";

  const favoriteInput = document.createElement("input");
  favoriteInput.type = "checkbox";
  favoriteInput.checked = state.favoriteIds.has(camera.id);
  favoriteInput.setAttribute("aria-label", `Favorite ${camera.name}`);
  favoriteInput.addEventListener("change", (event) => toggleFavorite(camera, event.target.checked));

  favoriteLabel.append(favoriteInput);
  row.append(openButton, favoriteLabel);
  return row;
}

function renderList() {
  const fragment = document.createDocumentFragment();
  const rows = state.filtered.slice(0, MAX_CAMERA_LIST_ROWS);

  rows.forEach((camera) => {
    fragment.appendChild(createCameraRow(camera));
  });

  els.cameraList.textContent = "";
  els.cameraList.appendChild(fragment);
  els.listNote.textContent = state.filtered.length === 0
    ? "No cameras match these filters."
    : state.filtered.length > MAX_CAMERA_LIST_ROWS
    ? `Showing ${MAX_CAMERA_LIST_ROWS} of ${state.filtered.length}. Search or filter to narrow.`
    : `${state.filtered.length} cameras in view.`;
}

function renderRegions() {
  els.regionSelect.textContent = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All regions";
  els.regionSelect.appendChild(allOption);

  const regions = uniqueSortedRegions(state.cameras);
  regions.forEach((region) => {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = formatRegion(region);
    els.regionSelect.appendChild(option);
  });
}

function initMap() {
  state.map = L.map("map", {
    preferCanvas: true,
    zoomControl: true
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
}

async function init() {
  initMap();
  state.db = await loadCameraDb();
  state.cameras = availableCameras(state.db);
  state.filtered = state.cameras;
  state.favoriteIds = loadFavoriteIds(state.cameras);

  els.totalCount.textContent = state.cameras.length;
  els.fitCount.textContent = state.cameras.filter((camera) => rateSurfSpot(camera).isRecommended).length;
  els.shownCount.textContent = state.cameras.length;
  renderRegions();
  applyFilters();
  fitInitialBounds();

  const firstFavorite = firstCameraById(state.cameras, DEFAULT_FAVORITE_IDS);
  const initialCamera = state.filtered[0] || firstFavorite || state.cameras[0];
  selectCamera(initialCamera, { play: false, pan: false });
}

els.searchInput.addEventListener("input", applyFilters);
els.regionSelect.addEventListener("change", applyFilters);
els.fitOnly.addEventListener("change", applyFilters);
els.favoriteOnly.addEventListener("change", applyFilters);
els.detailFavorite.addEventListener("change", (event) => toggleFavorite(state.selected, event.target.checked));
els.playButton.addEventListener("click", () => videoPlayer.play(state.selected));

init().catch((error) => {
  els.mapStatus.textContent = error.message;
  els.listNote.textContent = error.message;
});
