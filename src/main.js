import { firstClassCameras, loadCameraDb } from "./camera-data.js";
import {
  camerasForInitialBounds,
  camerasInBounds,
  filterCameras,
  uniqueSortedRegions
} from "./camera-filters.js";
import {
  formatConditionChips,
  formatConditionLine,
  formatWaterSummary
} from "./condition-summary.js";
import { DEFAULT_FAVORITE_IDS, HLS_SCRIPT_URL, INITIAL_BOUNDS_IDS } from "./config.js";
import { loadFavoriteIds, saveFavoriteIds } from "./favorites.js";
import { formatRegion } from "./format.js";
import { mightBeGoodCameras, monitorCameraSlots } from "./monitor-cameras.js";
import {
  applySpotMetadataToCameraDb,
  emptySpotData,
  findDriveEstimate,
  findSurflineMatches,
  loadSpotData
} from "./spot-data.js";
import {
  DEFAULT_SURF_PREFERENCES,
  loadSurfPreferences,
  saveSurfPreferences,
  serializeSurfPreferences
} from "./surf-preferences.js";
import { rateSurfSpot } from "./surf-rating.js";
import { emptyTideData, findTideSnapshot, loadTideData } from "./tide-data.js";
import { createFeedTilePlayer } from "./video-player.js";

const MONITOR_DURATION_MS = 60_000;
const PROVIDER_ICON_URLS = {
  meo: "https://beachcam.meo.pt/favicon.ico",
  surfline: "https://www.surfline.com/favicon.ico",
  unknown: ""
};

const state = {
  activeRoute: "monitor",
  db: null,
  spotData: emptySpotData(),
  tideData: emptyTideData(),
  cameras: [],
  favoriteIds: new Set(),
  preferences: DEFAULT_SURF_PREFERENCES,
  monitorMode: "favorites",
  monitorPlayers: new Map(),
  markers: new Map(),
  markerLayer: null,
  selectedExploreCamera: null,
  explorePlayer: null,
  map: null,
  mapHasInitialFit: false
};

const els = {
  navButtons: [...document.querySelectorAll("[data-route]")],
  screens: [...document.querySelectorAll("[data-screen]")],
  monitorStatus: document.querySelector("#monitorStatus"),
  monitorWaterSummary: document.querySelector("#monitorWaterSummary"),
  monitorGrid: document.querySelector("#monitorGrid"),
  monitorFavoritesMode: document.querySelector("#monitorFavoritesMode"),
  monitorMightBeGoodMode: document.querySelector("#monitorMightBeGoodMode"),
  favoritesSearchInput: document.querySelector("#favoritesSearchInput"),
  favoritesRegionSelect: document.querySelector("#favoritesRegionSelect"),
  favoritesStatusSelect: document.querySelector("#favoritesStatusSelect"),
  favoritesStreamSelect: document.querySelector("#favoritesStreamSelect"),
  favoritesDistanceSelect: document.querySelector("#favoritesDistanceSelect"),
  favoritesSortSelect: document.querySelector("#favoritesSortSelect"),
  favoritesStatus: document.querySelector("#favoritesStatus"),
  favoritesList: document.querySelector("#favoritesList"),
  favoritesWaterSummary: document.querySelector("#favoritesWaterSummary"),
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
  spotPanel: document.querySelector("#spotPanel"),
  detailWaterSummary: document.querySelector("#detailWaterSummary"),
  detailConditionStrip: document.querySelector("#detailConditionStrip"),
  detailFavorite: document.querySelector("#detailFavorite"),
  configForm: document.querySelector("#configForm"),
  resetConfigButton: document.querySelector("#resetConfigButton")
};

state.explorePlayer = createFeedTilePlayer({
  video: els.exploreVideo,
  status: els.exploreFeedStatus,
  hlsScriptUrl: HLS_SCRIPT_URL
});

function afterNextPaint(callback) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

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
    afterNextPaint(() => {
      refreshExploreMap({ fit: !state.mapHasInitialFit });
    });
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

function manageSpotCameras() {
  return state.db?.cameras || state.cameras;
}

function driveDistanceKm(camera) {
  return findDriveEstimate(camera, state.spotData)?.routeDistanceKm;
}

function favoriteManagerCameras() {
  return filterCameras(manageSpotCameras(), {
    query: els.favoritesSearchInput.value,
    region: els.favoritesRegionSelect.value,
    favoriteIds: state.favoriteIds,
    favoriteStatus: els.favoritesStatusSelect.value,
    streamStatus: els.favoritesStreamSelect.value,
    maxDistanceKm: els.favoritesDistanceSelect.value,
    sort: els.favoritesSortSelect.value || "favorites",
    getConditionRank(camera) {
      return rateSurfSpot(camera, state.preferences);
    },
    getDriveDistanceKm: driveDistanceKm
  });
}

function hasWaterSummaryData(camera) {
  return Boolean(
    camera?.detailMetrics?.["Temp. do mar"]
    || camera?.forecast?.tideState
    || findTideSnapshot(camera, state.tideData)
  );
}

function waterSummaryCamera() {
  return favoriteCameras().find(hasWaterSummaryData)
    || state.cameras.find(hasWaterSummaryData)
    || null;
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

function monitorPlayerKey(camera, index) {
  return `${camera.id}:${index}`;
}

function scheduleMonitorTile(camera, index, player, delayMs) {
  const key = monitorPlayerKey(camera, index);
  const playTimeoutId = window.setTimeout(() => {
    if (state.activeRoute === "monitor") player.play(camera);
  }, delayMs);
  const timeoutId = window.setTimeout(() => player.expire(), delayMs + MONITOR_DURATION_MS);

  state.monitorPlayers.set(key, { player, playTimeoutId, timeoutId });
}

function restartMonitorTile(camera, index, player) {
  if (state.activeRoute !== "monitor" || player.state() !== "expired") return;

  const key = monitorPlayerKey(camera, index);
  const entry = state.monitorPlayers.get(key);
  if (entry) {
    window.clearTimeout(entry.playTimeoutId);
    window.clearTimeout(entry.timeoutId);
  }

  player.play(camera);
  const timeoutId = window.setTimeout(() => player.expire(), MONITOR_DURATION_MS);
  state.monitorPlayers.set(key, { player, playTimeoutId: null, timeoutId });
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

function isReportOnlyCamera(camera) {
  return !camera?.streamUrl && Boolean(camera?.surfline?.pageUrl);
}

function reportUrl(camera) {
  return camera?.surfline?.pageUrl || camera?.pageUrl || "";
}

function createReportFrame(camera) {
  const frame = document.createElement("div");
  frame.className = "feed-frame report-frame";

  const logo = createProviderLogo("surfline", "Surfline");

  const source = document.createElement("span");
  source.className = "report-frame__source";
  source.textContent = "Surfline";

  const title = document.createElement("strong");
  title.className = "report-frame__title";
  title.textContent = camera.name;

  const action = document.createElement("a");
  action.className = "report-frame__action";
  action.href = reportUrl(camera);
  action.target = "_blank";
  action.rel = "noopener noreferrer";
  action.textContent = "Open Surfline report";

  frame.append(logo, source, title, action);
  return frame;
}

function createMonitorTile(slot, index) {
  if (slot.empty || !slot.camera) return createEmptyMonitorTile(index);

  const camera = slot.camera;
  const tile = document.createElement("article");
  tile.className = "monitor-tile";

  if (isReportOnlyCamera(camera)) {
    tile.append(createReportFrame(camera), createConditionStrip(camera, { showName: true }));
    return tile;
  }

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
  frame.addEventListener("click", () => restartMonitorTile(camera, index, player));
  scheduleMonitorTile(camera, index, player, 350 + (index * 450));

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
  renderWaterSummaries();

  const slots = state.monitorMode === "favorites"
    ? monitorCameraSlots(state.cameras, state.favoriteIds, favoriteOrder(), undefined, { getDriveDistanceKm: driveDistanceKm })
    : mightBeGoodCameras(state.cameras, state.favoriteIds, state.preferences, undefined, { getDriveDistanceKm: driveDistanceKm })
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

  els.monitorStatus.hidden = state.monitorMode === "favorites";
  els.monitorStatus.textContent = state.monitorMode === "favorites"
    ? ""
    : "Might be good is model-based. Check the cams before leaving.";
}

function createMetricIcon(icon, key, tone = "neutral") {
  const iconEl = document.createElement("span");
  iconEl.className = "metric-icon";
  iconEl.dataset.key = key;
  iconEl.dataset.tone = tone;
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;
  return iconEl;
}

function renderWaterSummary(container) {
  if (!container) return;

  const camera = waterSummaryCamera();
  container.textContent = "";

  if (!camera) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const tideSnapshot = findTideSnapshot(camera, state.tideData);
  formatWaterSummary(camera, { tideSnapshot }).forEach((item) => {
    const metric = document.createElement("div");
    metric.className = "water-metric";
    metric.dataset.key = item.key;
    metric.dataset.tone = item.tone;

    const label = document.createElement("span");
    label.className = "water-metric__label";
    label.textContent = item.label;

    const value = document.createElement("strong");
    value.className = "water-metric__value";
    value.textContent = item.value;

    metric.append(createMetricIcon(item.icon, item.key, item.tone), label, value);
    container.appendChild(metric);
  });
}

function renderWaterSummaries() {
  [
    els.monitorWaterSummary,
    els.favoritesWaterSummary,
    els.detailWaterSummary
  ].forEach(renderWaterSummary);
}

function createProviderLogo(source, label) {
  const url = PROVIDER_ICON_URLS[source];
  if (!url) {
    const fallback = document.createElement("span");
    fallback.className = "provider-logo provider-logo--fallback";
    fallback.textContent = label || "SRC";
    return fallback;
  }

  const logo = document.createElement("img");
  logo.className = "provider-logo";
  logo.src = url;
  logo.alt = "";
  logo.width = 22;
  logo.height = 22;
  logo.decoding = "async";
  logo.loading = "lazy";
  return logo;
}

function createConditionToken(chip, { iconOnly = false } = {}) {
  const token = document.createElement("span");
  token.className = "condition-token";
  token.dataset.key = chip.key;
  token.dataset.tone = chip.tone;
  token.title = chip.detail;

  const iconEl = document.createElement("span");
  iconEl.className = "condition-token__icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = chip.icon;

  const labelEl = document.createElement("span");
  labelEl.className = "condition-token__label";
  labelEl.textContent = chip.label;

  token.append(iconEl);
  if (!iconOnly) token.append(labelEl);
  return token;
}

function createRatingToken(chip) {
  const token = createConditionToken(chip);
  token.classList.add("condition-token--fit");
  return token;
}

function createSurflineControl(camera) {
  const matches = findSurflineMatches(camera, state.spotData);
  if (!matches.length) return null;

  const control = document.createElement("label");
  control.className = "condition-chip surfline-control";
  control.dataset.key = "surfline";
  control.dataset.tone = "neutral";
  control.title = "Open a nearby Surfline report";

  const logo = createProviderLogo("surfline", "Surfline");

  const externalIcon = document.createElement("span");
  externalIcon.className = "external-link-icon";
  externalIcon.setAttribute("aria-hidden", "true");
  externalIcon.textContent = "↗";

  const select = document.createElement("select");
  select.className = "surfline-control__select";
  select.setAttribute("aria-label", `Open Surfline report for ${camera.name}`);

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Nearby";
  select.appendChild(placeholder);

  matches.forEach((match) => {
    const option = document.createElement("option");
    option.value = match.url;
    option.textContent = match.name;
    select.appendChild(option);
  });

  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", () => {
    const selectedUrl = select.value;
    select.value = "";
    if (!selectedUrl) return;
    window.open(selectedUrl, "_blank", "noopener,noreferrer");
  });

  control.append(logo, externalIcon, select);
  return control;
}

function createConditionStrip(camera, { showName = false, compact = false, showSurfline = !compact } = {}) {
  const strip = document.createElement("div");
  strip.className = compact ? "condition-strip condition-strip--compact" : "condition-strip";
  strip.setAttribute("aria-label", `${camera.name} / ${formatConditionLine(camera, state.preferences)}`);
  const driveEstimate = findDriveEstimate(camera, state.spotData);
  const chips = new Map(
    formatConditionChips(camera, state.preferences, { driveEstimate })
      .map((chip) => [chip.key, chip])
  );

  const topRow = document.createElement("div");
  topRow.className = "condition-strip__top";
  if (showName && chips.has("fit")) {
    const name = document.createElement("span");
    name.className = "condition-spot-name";
    name.textContent = camera.name;
    topRow.append(name, createRatingToken(chips.get("fit")));
  } else if (chips.has("fit")) {
    topRow.appendChild(createRatingToken(chips.get("fit")));
  }
  strip.appendChild(topRow);

  const metricsRow = document.createElement("div");
  metricsRow.className = "condition-strip__metrics";
  const source = chips.get("source");
  if (source) {
    const sourceToken = document.createElement("span");
    sourceToken.className = "condition-source";
    sourceToken.dataset.source = source.source;
    sourceToken.title = source.detail;
    sourceToken.setAttribute("aria-label", source.detail);
    sourceToken.appendChild(createProviderLogo(source.source, source.label));
    metricsRow.appendChild(sourceToken);
  }

  ["wave", "swell", "wind"].forEach((key) => {
    const chip = chips.get(key);
    if (chip) metricsRow.appendChild(createConditionToken(chip));
  });
  strip.appendChild(metricsRow);

  const routeRow = document.createElement("div");
  routeRow.className = "condition-strip__route";
  ["coast", "drive"].forEach((key) => {
    const chip = chips.get(key);
    if (chip) routeRow.appendChild(createConditionToken(chip));
  });
  if (routeRow.childElementCount) strip.appendChild(routeRow);

  const surflineControl = showSurfline ? createSurflineControl(camera) : null;
  if (surflineControl) strip.appendChild(surflineControl);

  return strip;
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
  if (state.selectedExploreCamera?.id === camera.id) {
    renderExploreSelection(state.cameras.find((candidate) => candidate.id === camera.id) || null);
  }
}

function syncFavoriteToggle(button, camera) {
  const isFavorite = Boolean(camera && state.favoriteIds.has(camera.id));
  button.disabled = !camera;
  button.textContent = isFavorite ? "♥" : "♡";
  button.title = isFavorite ? "Remove from favorites" : "Add to favorites";
  button.setAttribute("aria-pressed", String(isFavorite));
  button.setAttribute("aria-label", camera ? `Toggle favorite: ${camera.name}` : "Toggle favorite");
}

function createFavoriteToggle(camera) {
  const button = document.createElement("button");
  button.className = "favorite-toggle";
  button.type = "button";
  syncFavoriteToggle(button, camera);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(camera, !state.favoriteIds.has(camera.id));
  });
  return button;
}

function createFavoriteCard(camera) {
  const card = document.createElement("article");
  card.className = "favorite-card";
  card.dataset.cameraRow = camera.id;

  const body = document.createElement("div");
  body.className = "favorite-card__body";

  const header = document.createElement("header");

  const title = document.createElement("h2");
  title.textContent = camera.name;

  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;

  header.append(title, meta);
  body.append(header, createConditionStrip(camera, { compact: true }));
  card.append(body, createFavoriteToggle(camera));
  return card;
}

function renderFavorites() {
  els.favoritesList.textContent = "";
  renderWaterSummaries();
  const manageCameras = manageSpotCameras();
  const cameras = favoriteManagerCameras();
  const favoriteCount = manageCameras.filter((camera) => state.favoriteIds.has(camera.id)).length;
  els.favoritesStatus.textContent = `${favoriteCount} favorites · ${cameras.length}/${manageCameras.length} spots shown`;

  if (!cameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No spots match those filters.";
    els.favoritesList.appendChild(empty);
    return;
  }

  cameras.forEach((camera) => {
    els.favoritesList.appendChild(createFavoriteCard(camera));
  });
}

function playExploreCamera(camera) {
  if (state.activeRoute !== "explore") return;
  if (isReportOnlyCamera(camera)) {
    state.explorePlayer.clear();
    els.exploreFeedStatus.textContent = "Open Surfline report";
    return;
  }
  state.explorePlayer.play(camera);
}

function selectExploreCamera(camera, { pan = false, route = false, scroll = false } = {}) {
  renderExploreSelection(camera);

  if (route) setRoute("explore");

  if (pan && Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon) && state.map) {
    state.map.panTo([camera.lat, camera.lon]);
  }

  if (scroll && els.spotPanel && window.matchMedia("(max-width: 900px)").matches) {
    els.spotPanel.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function renderExploreList() {
  if (!els.exploreList) return;

  const allCameras = exploreCameras();
  const cameras = exploreVisibleCameras();
  const mapScoped = state.activeRoute === "explore" && state.map && state.mapHasInitialFit;
  els.exploreResultsSummary.textContent = mapScoped
    ? `${cameras.length}/${allCameras.length} spots in this map view. Move or zoom the map to change the list.`
    : `${cameras.length} spots shown. Click a row or marker to watch.`;
  els.exploreList.textContent = "";

  if (!cameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = mapScoped
      ? "No spots visible in this map view. Move or zoom the map."
      : "No spots match those filters.";
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
      selectExploreCamera(camera, { pan: true, scroll: true });
    });

    els.exploreList.appendChild(row);
  });
}

function updateExploreRowSelection(cameraId) {
  els.exploreList.querySelectorAll(".explore-row[aria-current='true']").forEach((row) => {
    row.setAttribute("aria-current", "false");
  });
  const row = [...els.exploreList.querySelectorAll(".explore-row")]
    .find((row) => row.dataset.cameraRow === cameraId);
  if (row) row.setAttribute("aria-current", "true");
}

function renderExploreSelection(camera) {
  state.selectedExploreCamera = camera || null;
  els.detailConditionStrip.textContent = "";
  renderWaterSummaries();

  if (!camera) {
    els.detailName.textContent = "Select a camera";
    els.detailLocation.textContent = "Choose a marker to watch.";
    els.detailFavorite.disabled = true;
    syncFavoriteToggle(els.detailFavorite, null);
    renderMarkers();
    state.explorePlayer.clear();
    return;
  }

  els.detailName.textContent = camera.name;
  els.detailLocation.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;
  els.detailFavorite.disabled = false;
  syncFavoriteToggle(els.detailFavorite, camera);
  els.detailConditionStrip.appendChild(createConditionStrip(camera));
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

function exploreVisibleCameras() {
  if (state.activeRoute !== "explore" || !state.map || !state.mapHasInitialFit) {
    return exploreCameras();
  }

  return camerasInBounds(exploreCameras(), state.map.getBounds());
}

function renderMarkers() {
  if (!state.markerLayer) return;

  state.markerLayer.clearLayers();

  exploreCameras().forEach((camera) => {
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) return;

    let marker = state.markers.get(camera.id);
    if (!marker) {
      marker = L.marker([camera.lat, camera.lon], {
        title: camera.name,
        alt: camera.name
      });
      marker.bindTooltip(camera.name, {
        direction: "top",
        offset: [0, -12],
        opacity: 0.95,
        sticky: true
      });
      marker.on("click", () => {
        selectExploreCamera(camera, { scroll: true });
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

function renderRegionOptions(select, cameras = state.cameras) {
  select.textContent = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All regions";
  select.appendChild(allOption);

  uniqueSortedRegions(cameras).forEach((region) => {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = formatRegion(region);
    select.appendChild(option);
  });
}

function renderRegions() {
  renderRegionOptions(els.regionSelect, state.cameras);
  renderRegionOptions(els.favoritesRegionSelect, manageSpotCameras());
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
  state.map.on("moveend zoomend", () => {
    if (state.activeRoute === "explore") renderExploreList();
  });
}

function refreshExploreMap({ fit = false } = {}) {
  if (state.activeRoute !== "explore") return;

  ensureMap();
  state.map.invalidateSize({ pan: false });
  renderMarkers();

  if (fit || !state.mapHasInitialFit) {
    fitInitialBounds();
    state.mapHasInitialFit = true;
  } else if (
    Number.isFinite(state.selectedExploreCamera?.lat)
    && Number.isFinite(state.selectedExploreCamera?.lon)
  ) {
    state.map.panTo([state.selectedExploreCamera.lat, state.selectedExploreCamera.lon], { animate: false });
  }

  if (state.selectedExploreCamera) {
    playExploreCamera(state.selectedExploreCamera);
  }

  renderExploreList();
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });

  els.monitorFavoritesMode.addEventListener("click", () => setMonitorMode("favorites"));
  els.monitorMightBeGoodMode.addEventListener("click", () => setMonitorMode("might-be-good"));

  [
    els.favoritesSearchInput,
    els.favoritesRegionSelect,
    els.favoritesStatusSelect,
    els.favoritesStreamSelect,
    els.favoritesDistanceSelect,
    els.favoritesSortSelect
  ].forEach((input) => {
    input.addEventListener("input", renderFavorites);
    input.addEventListener("change", renderFavorites);
  });

  [els.searchInput, els.regionSelect, els.favoriteOnly, els.mightBeGoodOnly].forEach((input) => {
    input.addEventListener("input", () => {
      if (state.activeRoute === "explore") {
        refreshExploreMap({ fit: true });
      } else {
        renderExploreList();
        renderMarkers();
      }
    });
    input.addEventListener("change", () => {
      if (state.activeRoute === "explore") {
        refreshExploreMap({ fit: true });
      } else {
        renderExploreList();
        renderMarkers();
      }
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
  const [cameraDb, spotData, tideData] = await Promise.all([
    loadCameraDb(),
    loadSpotData().catch(() => emptySpotData()),
    loadTideData().catch(() => emptyTideData())
  ]);

  state.spotData = spotData;
  state.db = applySpotMetadataToCameraDb(cameraDb, state.spotData);
  state.tideData = tideData;
  state.cameras = firstClassCameras(state.db);
  state.favoriteIds = loadFavoriteIds(manageSpotCameras());
  state.preferences = loadSurfPreferences();

  renderRegions();
  renderConfigure();
  renderFavorites();
  renderExploreList();
  renderExploreSelection(favoriteCameras()[0] || state.cameras[0]);
  setRoute("monitor");
}

init().catch((error) => {
  els.monitorStatus.hidden = false;
  els.monitorStatus.textContent = error.message;
});
