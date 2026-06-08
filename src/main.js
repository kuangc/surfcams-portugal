import { availableCameras, loadCameraDb } from "./camera-data.js";
import {
  camerasForInitialBounds,
  filterCameras,
  uniqueSortedRegions
} from "./camera-filters.js";
import { formatConditionChips, formatConditionLine, formatSpotMetadata } from "./condition-summary.js";
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
  explorePlayer: null,
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
  exploreResultsSummary: document.querySelector("#exploreResultsSummary"),
  exploreList: document.querySelector("#exploreList"),
  exploreVideo: document.querySelector("#exploreVideo"),
  exploreFeedStatus: document.querySelector("#exploreFeedStatus"),
  detailName: document.querySelector("#detailName"),
  detailLocation: document.querySelector("#detailLocation"),
  detailConditionStrip: document.querySelector("#detailConditionStrip"),
  detailFavorite: document.querySelector("#detailFavorite"),
  description: document.querySelector("#description"),
  metadataGrid: document.querySelector("#metadataGrid"),
  configForm: document.querySelector("#configForm"),
  resetConfigButton: document.querySelector("#resetConfigButton")
};

state.explorePlayer = createFeedTilePlayer({
  video: els.exploreVideo,
  status: els.exploreFeedStatus,
  hlsScriptUrl: HLS_SCRIPT_URL
});

function setRoute(route) {
  if (route !== "monitor") clearMonitorPlayers();
  if (route !== "explore") state.explorePlayer.clear();

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

  if (route === "monitor" && state.cameras.length) {
    renderMonitor();
  }

  if (route === "explore") {
    window.setTimeout(() => {
      ensureMap();
      renderExploreList();
      renderMarkers();
      state.map.invalidateSize();
      if (state.selectedExploreCamera) {
        playExploreCamera(state.selectedExploreCamera);
      }
    }, 0);
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
  state.monitorPlayers.forEach(({ player, playTimeoutId, timeoutId }) => {
    window.clearTimeout(playTimeoutId);
    window.clearTimeout(timeoutId);
    player.clear();
  });
  state.monitorPlayers.clear();
}

function renderMonitorIfActive() {
  if (state.activeRoute === "monitor") renderMonitor();
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
  status.textContent = camera.streamUrl ? "Queued" : "No feed";

  frame.append(video, status);
  tile.append(frame, createConditionStrip(camera, { showName: true }));

  const player = createFeedTilePlayer({ video, status, hlsScriptUrl: HLS_SCRIPT_URL });
  const playTimeoutId = window.setTimeout(() => {
    if (state.activeRoute === "monitor") player.play(camera);
  }, 350 + (index * 450));
  const timeoutId = window.setTimeout(() => player.expire(), MONITOR_DURATION_MS);
  state.monitorPlayers.set(`${camera.id}:${index}`, { player, playTimeoutId, timeoutId });

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

function createConditionStrip(camera, { showName = false, compact = false } = {}) {
  const strip = document.createElement("div");
  strip.className = compact ? "condition-strip condition-strip--compact" : "condition-strip";
  strip.setAttribute("aria-label", `${camera.name} / ${formatConditionLine(camera, state.preferences)}`);

  if (showName) {
    const name = document.createElement("span");
    name.className = "condition-spot-name";
    name.textContent = camera.name;
    strip.appendChild(name);
  }

  formatConditionChips(camera, state.preferences).forEach((chip) => {
    const chipEl = document.createElement("span");
    chipEl.className = "condition-chip";
    chipEl.dataset.key = chip.key;
    chipEl.dataset.tone = chip.tone;
    chipEl.title = chip.detail;
    chipEl.textContent = chip.label;
    strip.appendChild(chipEl);
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
  renderMonitorIfActive();
  renderFavorites();
  renderExploreList();
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
    window.setTimeout(() => {
      if (Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && state.map) {
        state.map.panTo([camera.lat, camera.lon]);
      }
    }, 0);
  });

  const removeButton = document.createElement("button");
  removeButton.className = "danger-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => toggleFavorite(camera, false));

  actions.append(mapButton, removeButton);
  card.append(header, createConditionStrip(camera), vectors, actions);
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

function playExploreCamera(camera) {
  if (state.activeRoute !== "explore") return;
  state.explorePlayer.play(camera);
}

function renderExploreList() {
  if (!els.exploreList) return;

  const cameras = exploreCameras();
  els.exploreResultsSummary.textContent = `${cameras.length} spots shown. Click a row or marker to watch.`;
  els.exploreList.textContent = "";

  if (!cameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No spots match those filters.";
    els.exploreList.appendChild(empty);
    return;
  }

  cameras.forEach((camera) => {
    const row = document.createElement("button");
    row.className = "explore-row";
    row.type = "button";
    row.dataset.cameraRow = camera.id;
    row.setAttribute("aria-current", String(camera.id === state.selectedExploreCamera?.id));

    const title = document.createElement("span");
    title.className = "explore-row__title";
    title.textContent = camera.name;

    const meta = document.createElement("span");
    meta.className = "explore-row__meta";
    meta.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;

    row.append(title, meta, createConditionStrip(camera, { compact: true }));
    row.addEventListener("click", () => {
      renderExploreSelection(camera);
      if (Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && state.map) {
        state.map.panTo([camera.lat, camera.lon]);
      }
    });

    els.exploreList.appendChild(row);
  });
}

function updateExploreRowSelection(cameraId) {
  els.exploreList.querySelectorAll(".explore-row[aria-current='true']").forEach((row) => {
    row.setAttribute("aria-current", "false");
  });
  const row = [...els.exploreList.querySelectorAll(".explore-row")]
    .find((item) => item.dataset.cameraRow === cameraId);
  if (row) row.setAttribute("aria-current", "true");
}

function renderExploreSelection(camera) {
  state.selectedExploreCamera = camera || null;
  els.detailConditionStrip.textContent = "";

  if (!camera) {
    els.detailName.textContent = "Select a camera";
    els.detailLocation.textContent = "Choose a marker to inspect conditions.";
    els.detailFavorite.disabled = true;
    els.detailFavorite.textContent = "Add favorite";
    els.detailFavorite.setAttribute("aria-pressed", "false");
    els.description.textContent = "";
    renderMetadata(null);
    renderMarkers();
    state.explorePlayer.clear();
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
  els.detailConditionStrip.appendChild(createConditionStrip(camera));
  renderMetadata(camera);
  updateExploreRowSelection(camera.id);
  renderMarkers();
  playExploreCamera(camera);
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

function ensureMap() {
  if (state.map) return;

  state.map = L.map("map", {
    preferCanvas: true,
    zoomControl: true
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  renderMarkers();
  fitInitialBounds();
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });

  els.monitorFavoritesMode.addEventListener("click", () => setMonitorMode("favorites"));
  els.monitorMightBeGoodMode.addEventListener("click", () => setMonitorMode("might-be-good"));

  [els.searchInput, els.regionSelect, els.favoriteOnly, els.mightBeGoodOnly].forEach((input) => {
    input.addEventListener("input", () => {
      renderExploreList();
      renderMarkers();
    });
    input.addEventListener("change", () => {
      renderExploreList();
      renderMarkers();
    });
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
    renderMonitorIfActive();
    renderFavorites();
    renderExploreList();
    renderExploreSelection(state.selectedExploreCamera);
  });

  els.resetConfigButton.addEventListener("click", () => {
    state.preferences = saveSurfPreferences(DEFAULT_SURF_PREFERENCES);
    renderConfigure();
    renderMonitorIfActive();
    renderFavorites();
    renderExploreList();
    renderExploreSelection(state.selectedExploreCamera);
  });
}

async function init() {
  bindEvents();
  state.db = await loadCameraDb();
  state.cameras = availableCameras(state.db);
  state.favoriteIds = loadFavoriteIds(state.cameras);
  state.preferences = loadSurfPreferences();

  renderRegions();
  renderConfigure();
  renderFavorites();
  renderExploreList();
  renderExploreSelection(favoriteCameras()[0] || state.cameras[0]);
  setRoute("monitor");
}

init().catch((error) => {
  els.monitorStatus.textContent = error.message;
});
