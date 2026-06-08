import { availableCameras, loadCameraDb } from "./camera-data.js";
import {
  camerasForInitialBounds,
  filterCameras,
  uniqueSortedRegions
} from "./camera-filters.js";
import { formatConditionLine, formatSpotMetadata } from "./condition-summary.js";
import { DEFAULT_FAVORITE_IDS, HLS_SCRIPT_URL, INITIAL_BOUNDS_IDS } from "./config.js";
import { loadFavoriteIds, saveFavoriteIds } from "./favorites.js";
import { formatRegion } from "./format.js";
import { mightBeGoodCameras, monitorCameraSlots } from "./monitor-cameras.js";
import {
  DEFAULT_SURF_PREFERENCES,
  loadSurfPreferences,
  saveSurfPreferences,
  serializeSurfPreferences
} from "./surf-preferences.js";
import { getConditionVectors, rateSurfSpot } from "./surf-rating.js";
import { createFeedTilePlayer } from "./video-player.js";

const MONITOR_DURATION_MS = 60_000;

const state = {
  activeRoute: "monitor",
  db: null,
  cameras: [],
  favoriteIds: new Set(),
  preferences: DEFAULT_SURF_PREFERENCES,
  monitorMode: "favorites",
  monitorPlayers: new Map(),
  markers: new Map(),
  markerLayer: null,
  selectedExploreCamera: null,
  map: null
};

const els = {
  navButtons: [...document.querySelectorAll("[data-route]")],
  screens: [...document.querySelectorAll("[data-screen]")],
  monitorStatus: document.querySelector("#monitorStatus"),
  monitorGrid: document.querySelector("#monitorGrid"),
  monitorFavoritesMode: document.querySelector("#monitorFavoritesMode"),
  monitorMightBeGoodMode: document.querySelector("#monitorMightBeGoodMode"),
  favoritesList: document.querySelector("#favoritesList"),
  searchInput: document.querySelector("#searchInput"),
  regionSelect: document.querySelector("#regionSelect"),
  favoriteOnly: document.querySelector("#favoriteOnly"),
  mightBeGoodOnly: document.querySelector("#mightBeGoodOnly"),
  detailName: document.querySelector("#detailName"),
  detailLocation: document.querySelector("#detailLocation"),
  detailFavorite: document.querySelector("#detailFavorite"),
  description: document.querySelector("#description"),
  metadataGrid: document.querySelector("#metadataGrid"),
  configForm: document.querySelector("#configForm"),
  resetConfigButton: document.querySelector("#resetConfigButton")
};

function setRoute(route) {
  state.activeRoute = route;

  els.navButtons.forEach((button) => {
    if (button.dataset.route === route) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  els.screens.forEach((screen) => {
    const isActive = screen.dataset.screen === route;
    screen.hidden = !isActive;
    screen.dataset.active = String(isActive);
  });

  if (route === "explore" && state.map) {
    window.setTimeout(() => state.map.invalidateSize(), 0);
  }
}

function favoriteOrder() {
  return [...new Set([
    ...DEFAULT_FAVORITE_IDS,
    ...state.favoriteIds,
    ...state.cameras.map((camera) => camera.id)
  ])];
}

function byId() {
  return new Map(state.cameras.map((camera) => [camera.id, camera]));
}

function favoriteCameras() {
  const camerasById = byId();
  return favoriteOrder()
    .filter((id) => state.favoriteIds.has(id))
    .map((id) => camerasById.get(id))
    .filter(Boolean);
}

function clearMonitorPlayers() {
  state.monitorPlayers.forEach(({ player, timeoutId }) => {
    window.clearTimeout(timeoutId);
    player.clear();
  });
  state.monitorPlayers.clear();
}

function createEmptyMonitorTile(index) {
  const tile = document.createElement("article");
  tile.className = "monitor-tile monitor-tile--empty";
  tile.setAttribute("aria-label", `Empty monitor slot ${index + 1}`);

  const button = document.createElement("button");
  button.className = "empty-slot-button";
  button.type = "button";
  button.textContent = "Add favorite";
  button.addEventListener("click", () => setRoute("explore"));

  const note = document.createElement("p");
  note.textContent = "Empty on purpose. Favorites are never auto-filled.";

  tile.append(button, note);
  return tile;
}

function createMonitorTile(slot, index) {
  if (slot.empty || !slot.camera) return createEmptyMonitorTile(index);

  const camera = slot.camera;
  const tile = document.createElement("article");
  tile.className = "monitor-tile";

  const frame = document.createElement("div");
  frame.className = "feed-frame";

  const video = document.createElement("video");
  video.className = "feed-video";
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  video.poster = camera.image || "";

  const status = document.createElement("span");
  status.className = "feed-status";
  status.textContent = camera.streamUrl ? "Loading" : "No feed";

  frame.append(video, status);

  const summary = document.createElement("p");
  summary.className = "condition-line";
  summary.textContent = `${camera.name} / ${formatConditionLine(camera, state.preferences)}`;

  tile.append(frame, summary);

  const player = createFeedTilePlayer({ video, status, hlsScriptUrl: HLS_SCRIPT_URL });
  const timeoutId = window.setTimeout(() => player.expire(), MONITOR_DURATION_MS);
  state.monitorPlayers.set(`${camera.id}:${index}`, { player, timeoutId });
  player.play(camera);

  return tile;
}

function setMonitorMode(mode) {
  state.monitorMode = mode;
  els.monitorFavoritesMode.setAttribute("aria-pressed", String(mode === "favorites"));
  els.monitorMightBeGoodMode.setAttribute("aria-pressed", String(mode === "might-be-good"));
  renderMonitor();
}

function renderMonitor() {
  clearMonitorPlayers();

  const slots = state.monitorMode === "favorites"
    ? monitorCameraSlots(state.cameras, state.favoriteIds, favoriteOrder())
    : mightBeGoodCameras(state.cameras, state.favoriteIds, state.preferences)
      .map((camera) => ({ camera, empty: false }));

  els.monitorGrid.textContent = "";

  if (!slots.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No spots match the current might-be-good model.";
    els.monitorGrid.appendChild(empty);
  } else {
    slots.forEach((slot, index) => {
      els.monitorGrid.appendChild(createMonitorTile(slot, index));
    });
  }

  els.monitorStatus.textContent = state.monitorMode === "favorites"
    ? "Showing favorites only. Empty slots are not auto-filled."
    : "Might be good is model-based. Check the cams before leaving.";
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

function compassFromBearing(bearing) {
  if (!Number.isFinite(bearing)) return "unknown";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function createConditionVectors(camera) {
  const vectors = getConditionVectors(camera);
  const strip = document.createElement("div");
  strip.className = "condition-vectors";

  [
    ["Coast", `${compassFromBearing(vectors.coast.bearing)} exposure`],
    ["Wind", `${vectors.wind.arrow} ${vectors.wind.compass} ${vectors.wind.alignment}`],
    ["Swell", `${vectors.swell.compass} swell`]
  ].forEach(([label, value]) => {
    const item = document.createElement("span");
    item.className = "vector-pill";
    item.textContent = `${label}: ${value}`;
    strip.appendChild(item);
  });

  return strip;
}

function renderMetadata(camera) {
  els.metadataGrid.textContent = "";
  if (!camera) return;

  const items = formatSpotMetadata(camera, state.preferences)
    .map((metric) => createMetadataItem(metric.label, metric.value))
    .filter(Boolean);

  els.metadataGrid.append(...items, createConditionVectors(camera));
}

function findFavoriteCard(cameraId) {
  return [...els.favoritesList.querySelectorAll(".favorite-card")]
    .find((row) => row.dataset.cameraRow === cameraId);
}

function toggleFavorite(camera, checked) {
  if (!camera) return;

  if (checked) {
    state.favoriteIds.add(camera.id);
  } else {
    state.favoriteIds.delete(camera.id);
  }

  saveFavoriteIds(state.favoriteIds);
  renderMonitor();
  renderFavorites();
  renderMarkers();
  renderExploreSelection(camera);
}

function createFavoriteCard(camera) {
  const card = document.createElement("article");
  card.className = "favorite-card";
  card.dataset.cameraRow = camera.id;

  const header = document.createElement("header");

  const title = document.createElement("h2");
  title.textContent = camera.name;

  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;

  header.append(title, meta);

  const summary = document.createElement("p");
  summary.className = "condition-line";
  summary.textContent = formatConditionLine(camera, state.preferences);

  const vectors = createConditionVectors(camera);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const mapButton = document.createElement("button");
  mapButton.className = "secondary-button";
  mapButton.type = "button";
  mapButton.textContent = "Map";
  mapButton.addEventListener("click", () => {
    renderExploreSelection(camera);
    setRoute("explore");
    if (Number.isFinite(camera.lat) && Number.isFinite(camera.lon)) {
      state.map.panTo([camera.lat, camera.lon]);
    }
  });

  const removeButton = document.createElement("button");
  removeButton.className = "danger-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => toggleFavorite(camera, false));

  actions.append(mapButton, removeButton);
  card.append(header, summary, vectors, actions);
  return card;
}

function renderFavorites() {
  els.favoritesList.textContent = "";
  const cameras = favoriteCameras();

  if (!cameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No favorites yet. Add spots from the map.";
    els.favoritesList.appendChild(empty);
    return;
  }

  cameras.forEach((camera) => {
    els.favoritesList.appendChild(createFavoriteCard(camera));
  });
}

function renderExploreSelection(camera) {
  state.selectedExploreCamera = camera || null;

  if (!camera) {
    els.detailName.textContent = "Select a camera";
    els.detailLocation.textContent = "Choose a marker to inspect conditions.";
    els.detailFavorite.disabled = true;
    els.detailFavorite.textContent = "Add favorite";
    els.detailFavorite.setAttribute("aria-pressed", "false");
    els.description.textContent = "";
    renderMetadata(null);
    renderMarkers();
    return;
  }

  const rating = rateSurfSpot(camera, state.preferences);
  const isFavorite = state.favoriteIds.has(camera.id);

  els.detailName.textContent = camera.name;
  els.detailLocation.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)} / ${rating.label}`;
  els.detailFavorite.disabled = false;
  els.detailFavorite.textContent = isFavorite ? "Remove favorite" : "Add favorite";
  els.detailFavorite.setAttribute("aria-pressed", String(isFavorite));
  els.description.textContent = camera.description || "No spot notes indexed.";
  renderMetadata(camera);
  renderMarkers();
}

function formField(name) {
  return els.configForm.elements.namedItem(name);
}

function renderConfigure() {
  const values = serializeSurfPreferences(state.preferences);

  Object.entries(values).forEach(([name, value]) => {
    const field = formField(name);
    if (!field) return;

    if (field.type === "checkbox") {
      field.checked = value;
    } else {
      field.value = value;
    }
  });
}

function readConfigForm() {
  return {
    minSurfHeightM: formField("minSurfHeightM").value,
    maxSurfHeightM: formField("maxSurfHeightM").value,
    maxWindSpeedKmh: formField("maxWindSpeedKmh").value,
    minPeriodSeconds: formField("minPeriodSeconds").value,
    surfSizeScale: formField("surfSizeScale").value,
    preferOffshore: formField("preferOffshore").checked,
    allowLightWind: formField("allowLightWind").checked
  };
}

function markerIcon(camera, active = false) {
  const rating = rateSurfSpot(camera, state.preferences);

  return L.divIcon({
    className: "",
    html: `<span class="cam-marker" data-active="${active}" data-favorite="${state.favoriteIds.has(camera.id)}" data-fit="${rating.key}" data-live="${camera.hasStream}"></span>`,
    iconSize: active ? [28, 28] : [20, 20],
    iconAnchor: active ? [14, 14] : [10, 10],
    popupAnchor: [0, -12]
  });
}

function isMightBeGood(camera) {
  return rateSurfSpot(camera, state.preferences).isRecommended;
}

function exploreCameras() {
  return filterCameras(state.cameras, {
    query: els.searchInput.value,
    region: els.regionSelect.value,
    favoriteOnly: els.favoriteOnly.checked,
    favoriteIds: state.favoriteIds,
    mightBeGoodOnly: els.mightBeGoodOnly.checked,
    isMightBeGood
  });
}

function renderMarkers() {
  if (!state.markerLayer) return;

  state.markerLayer.clearLayers();

  exploreCameras().forEach((camera) => {
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) return;

    let marker = state.markers.get(camera.id);
    if (!marker) {
      marker = L.marker([camera.lat, camera.lon]);
      marker.on("click", () => {
        renderExploreSelection(camera);
        setRoute("explore");
      });
      state.markers.set(camera.id, marker);
    }

    marker.setIcon(markerIcon(camera, camera.id === state.selectedExploreCamera?.id));
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

function renderRegions() {
  els.regionSelect.textContent = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All regions";
  els.regionSelect.appendChild(allOption);

  uniqueSortedRegions(state.cameras).forEach((region) => {
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

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });

  els.monitorFavoritesMode.addEventListener("click", () => setMonitorMode("favorites"));
  els.monitorMightBeGoodMode.addEventListener("click", () => setMonitorMode("might-be-good"));

  [els.searchInput, els.regionSelect, els.favoriteOnly, els.mightBeGoodOnly].forEach((input) => {
    input.addEventListener("input", renderMarkers);
    input.addEventListener("change", renderMarkers);
  });

  els.detailFavorite.addEventListener("click", () => {
    const camera = state.selectedExploreCamera;
    if (!camera) return;
    toggleFavorite(camera, !state.favoriteIds.has(camera.id));
  });

  els.configForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.preferences = saveSurfPreferences(readConfigForm());
    renderConfigure();
    renderMonitor();
    renderFavorites();
    renderExploreSelection(state.selectedExploreCamera);
  });

  els.resetConfigButton.addEventListener("click", () => {
    state.preferences = saveSurfPreferences(DEFAULT_SURF_PREFERENCES);
    renderConfigure();
    renderMonitor();
    renderFavorites();
    renderExploreSelection(state.selectedExploreCamera);
  });
}

async function init() {
  bindEvents();
  initMap();
  state.db = await loadCameraDb();
  state.cameras = availableCameras(state.db);
  state.favoriteIds = loadFavoriteIds(state.cameras);
  state.preferences = loadSurfPreferences();

  renderRegions();
  renderConfigure();
  renderMonitor();
  renderFavorites();
  renderExploreSelection(favoriteCameras()[0] || state.cameras[0]);
  fitInitialBounds();
  setRoute("monitor");
}

init().catch((error) => {
  els.monitorStatus.textContent = error.message;
});
