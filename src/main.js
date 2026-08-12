import {
  loadCameraDb,
  mergeAdviceGuideSubjects,
  mergePromotedSpots,
  sanitizeFavoriteIds
} from "./camera-data.js";
import { resolveFeedBackedCameras } from "./feed-policy.js";
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
import {
  CONDITIONS_STALE_BANNER_HOURS,
  DEFAULT_FAVORITE_IDS,
  HLS_SCRIPT_URL,
  INITIAL_BOUNDS_IDS,
  SURFLINE_FRESH_MAX_AGE_HOURS
} from "./config.js";
import {
  addFavorite,
  playableFavoriteCatalog,
  searchFavoriteCatalog
} from "./favorite-catalog.js";
import {
  commitFavoriteMutation,
  createFavoriteUndo,
  loadFavoriteIds
} from "./favorites.js";
import { formatRegion } from "./format.js";
import { formatConditionsAgeLabel, newestConditionsAgeHours, resolveConditions } from "./forecast-sources.js";
import { fetchLiveForecast } from "./live-forecast.js";
import { createGalleryPreviewSession } from "./feed-lifecycle.js";
import { inSuggestionFence, monitorFavoriteCameras } from "./monitor-cameras.js";
import { addSessionFeedback, exportSessionFeedback, importSessionFeedback } from "./session-feedback.js";
import {
  applySpotMetadataToCameraDb,
  emptySpotData,
  findDriveEstimate,
  loadSpotData
} from "./spot-data.js";
import {
  adviceSubjectIdFor,
  findAdviceTideSnapshot,
  formatSpotPlaybook,
  recommendationAdviceFor,
  selectLocalLens
} from "./spot-advice.js";
import { stretchMembers } from "./stretch-view.js";
import {
  DEFAULT_SURF_PREFERENCES,
  loadSurfPreferences,
  saveSurfPreferences,
  serializeSurfPreferences
} from "./surf-preferences.js";
import { rateSurfSpot } from "./surf-rating.js";
import { emptyTideData, findNearestTideSnapshot, findTideSnapshot, loadTideData } from "./tide-data.js";
import { createTodayForecastStore } from "./today-forecast-store.js";
import { recommendTodaySpots } from "./today-recommendations.js";
import {
  formatLeaveCall,
  formatLisbonTime,
  formatRecommendationStatus,
  formatWindowCall,
  selectRecommendationCameras,
  shortlistBestBets
} from "./today-recommendations-ui.js";
import { createFeedTilePlayer } from "./video-player.js";

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
  liveForecastCache: new Map(),
  liveForecastPending: new Set(),
  todayForecastStore: null,
  todayForecastLoading: false,
  todayForecastSummary: null,
  todayForecastUnsubscribe: null,
  recommendationGeneration: 0,
  monitorMode: "favorites",
  monitorSessions: new Map(),
  monitorObserver: null,
  monitorFallbackSession: null,
  adviceRefreshTimerId: null,
  adviceRefreshGeneration: 0,
  stalenessBannerDismissed: false,
  stalenessBannerEl: null,
  markers: new Map(),
  markerLayer: null,
  selectedExploreCamera: null,
  explorePlayer: null,
  stretchChipEl: null,
  stretchPanelEl: null,
  spotPlaybookEl: null,
  map: null,
  mapHasInitialFit: false
};

const els = {
  navButtons: [...document.querySelectorAll("[data-route]")],
  screens: [...document.querySelectorAll("[data-screen]")],
  monitorStatus: document.querySelector("#monitorStatus"),
  monitorWaterSummary: document.querySelector("#monitorWaterSummary"),
  monitorGrid: document.querySelector("#monitorGrid"),
  todayRecommendations: document.querySelector("#todayRecommendations"),
  bestBetsList: document.querySelector("#bestBetsList"),
  worthChecking: document.querySelector("#worthChecking"),
  worthCheckingCount: document.querySelector("#worthCheckingCount"),
  worthCheckingList: document.querySelector("#worthCheckingList"),
  monitorFavoritesMode: document.querySelector("#monitorFavoritesMode"),
  monitorMightBeGoodMode: document.querySelector("#monitorMightBeGoodMode"),
  addFavoriteCamera: document.querySelector("#addFavoriteCamera"),
  favoriteAddDialog: document.querySelector("#favoriteAddDialog"),
  closeFavoriteAddDialog: document.querySelector("#closeFavoriteAddDialog"),
  favoriteAddInput: document.querySelector("#favoriteAddInput"),
  favoriteAddResults: document.querySelector("#favoriteAddResults"),
  favoriteAddRegion: document.querySelector("#favoriteAddRegion"),
  favoriteAddProvider: document.querySelector("#favoriteAddProvider"),
  favoriteStatusLive: document.querySelector("#favoriteStatusLive"),
  favoriteUndoToast: document.querySelector("#favoriteUndoToast"),
  favoriteUndoMessage: document.querySelector("#favoriteUndoMessage"),
  favoriteUndoButton: document.querySelector("#favoriteUndoButton"),
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
  resetConfigButton: document.querySelector("#resetConfigButton"),
  exportSessionFeedbackButton: document.querySelector("#exportSessionFeedback"),
  importSessionFeedbackInput: document.querySelector("#importSessionFeedback"),
  sessionFeedbackStatus: document.querySelector("#sessionFeedbackStatus")
};

state.explorePlayer = createFeedTilePlayer({
  video: els.exploreVideo,
  status: els.exploreFeedStatus,
  hlsScriptUrl: HLS_SCRIPT_URL
});

let favoriteAddRecords = [];
let favoriteAddActiveIndex = -1;

const favoriteUndo = createFavoriteUndo({
  durationMs: 10_000,
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (timerId) => window.clearTimeout(timerId),
  onExpire: hideFavoriteUndoToast
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
    .filter((camera) => camera && !camera.adviceGuideOnly);
}

// The Explore screen has no sort control, so it renders state.cameras in whatever
// order it receives them in. Sorting once here (coast app: north-to-south is a
// meaningful base order) keeps promoted Surfline-only spots interleaved next to
// their geographic neighbors instead of stuck at the end of the raw crawl order.
// Stable sort: cameras with equal/missing latitude keep their relative order.
function sortCamerasByLatitudeDescending(cameras) {
  return [...cameras].sort((a, b) => {
    const aLat = Number.isFinite(a.lat) ? a.lat : -Infinity;
    const bLat = Number.isFinite(b.lat) ? b.lat : -Infinity;
    return bLat - aLat;
  });
}

function driveDistanceKm(camera) {
  return findDriveEstimate(camera, state.spotData)?.routeDistanceKm;
}

function driveMinutes(camera) {
  return findDriveEstimate(camera, state.spotData)?.estimatedMinutes ?? null;
}

function getConditions(camera) {
  if (camera?.adviceGuideOnly) return null;
  return resolveConditions(camera, state.spotData, {
    liveCache: state.liveForecastCache ?? null,
    now: Date.now()
  });
}

function recommendationCameras() {
  return selectRecommendationCameras(state.cameras, {
    subjectIdFor: (camera) => adviceSubjectIdFor(camera, state.spotData),
    inFence: inSuggestionFence,
    isFavorite: (camera) => state.favoriteIds.has(camera.id)
  });
}

async function loadTodayForecasts() {
  if (!state.todayForecastStore) return;
  const generation = state.recommendationGeneration + 1;
  state.recommendationGeneration = generation;
  state.todayForecastLoading = true;
  state.todayForecastSummary = null;
  renderMonitorIfActive();

  const summary = await state.todayForecastStore.load(recommendationCameras());
  if (state.recommendationGeneration !== generation) return;
  state.todayForecastLoading = false;
  state.todayForecastSummary = summary;
  renderMonitorIfActive();
}

function requestLiveForecastForSelection(camera) {
  if (!camera || camera.adviceGuideOnly || getConditions(camera).source !== "meo-static") return;
  if (state.liveForecastPending.has(camera.id)) return;

  state.liveForecastPending.add(camera.id);
  fetchLiveForecast(camera)
    .then((live) => {
      if (!live) return;

      state.liveForecastCache.set(camera.id, live);
      if (state.selectedExploreCamera?.id === camera.id) {
        renderExploreConditions(state.selectedExploreCamera);
      }
    })
    .finally(() => {
      state.liveForecastPending.delete(camera.id);
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
  state.monitorObserver?.disconnect();
  state.monitorObserver = null;
  state.monitorSessions.forEach((session) => session.clear());
  state.monitorSessions.clear();
  state.monitorFallbackSession = null;
}

function renderMonitorIfActive() {
  if (state.activeRoute === "monitor") renderMonitor();
}

function createMonitorObserver() {
  if (typeof window.IntersectionObserver !== "function") return null;
  return new window.IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      state.monitorSessions.get(entry.target)?.setVisible(entry.isIntersecting);
    });
  }, { root: null, rootMargin: "0px" });
}

function activateFallbackPreview(session) {
  if (state.monitorFallbackSession === session) return;
  state.monitorFallbackSession?.setVisible(false);
  state.monitorFallbackSession = session;
  session.setVisible(true);
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

function clearStalenessBanner() {
  state.stalenessBannerEl?.remove();
  state.stalenessBannerEl = null;
}

function renderStalenessBanner() {
  clearStalenessBanner();
  if (state.stalenessBannerDismissed) return;

  const ageHours = newestConditionsAgeHours(state.spotData, Date.now());
  if (ageHours !== null && ageHours <= CONDITIONS_STALE_BANNER_HOURS) return;

  const banner = document.createElement("div");
  banner.className = "staleness-banner";
  banner.setAttribute("role", "status");

  const message = document.createElement("span");
  message.textContent = state.monitorMode === "might-be-good"
    ? `Surfline conditions data is stale (${formatConditionsAgeLabel(ageHours)}). Best bets require fresh Surfline conditions, so stale spots stay out.`
    : `Surfline conditions data is stale (${formatConditionsAgeLabel(ageHours)}) — ratings fall back to model/MEO.`;

  const dismiss = document.createElement("button");
  dismiss.className = "staleness-banner__dismiss";
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.title = "Dismiss stale conditions notice";
  dismiss.setAttribute("aria-label", "Dismiss stale conditions notice");
  dismiss.addEventListener("click", () => {
    state.stalenessBannerDismissed = true;
    clearStalenessBanner();
  });

  banner.append(message, dismiss);
  const anchor = state.monitorMode === "might-be-good" ? els.todayRecommendations : els.monitorGrid;
  anchor.insertAdjacentElement("beforebegin", banner);
  state.stalenessBannerEl = banner;
}

function createMonitorTile(slot, index) {
  if (slot.empty || !slot.camera) return createEmptyMonitorTile(index);

  const camera = slot.camera;
  const tile = document.createElement("article");
  tile.className = "monitor-tile";

  const conditionStrip = createConditionStrip(camera, { showName: true });
  renderLocalLens(conditionStrip, camera);

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

  const retryButton = document.createElement("button");
  retryButton.className = "feed-retry-button";
  retryButton.type = "button";
  const usesManualFallback = !state.monitorObserver;
  retryButton.hidden = !usesManualFallback;
  retryButton.textContent = usesManualFallback ? "Play preview" : "";

  frame.append(video, status, retryButton);
  tile.append(frame, conditionStrip);

  const player = createFeedTilePlayer({
    video,
    status,
    hlsScriptUrl: HLS_SCRIPT_URL,
    onStateChange: (playerState) => {
      if (playerState === "blocked") {
        retryButton.hidden = false;
        retryButton.textContent = "Play";
      } else if (playerState === "unavailable") {
        retryButton.hidden = false;
        retryButton.textContent = "Retry";
      } else if (playerState === "expired") {
        retryButton.hidden = false;
        retryButton.textContent = "Restart preview";
      } else if (usesManualFallback && playerState === "idle") {
        retryButton.hidden = false;
        retryButton.textContent = "Play preview";
      } else {
        retryButton.hidden = true;
      }
    }
  });
  const session = createGalleryPreviewSession({ camera, player });
  state.monitorSessions.set(tile, session);
  frame.addEventListener("click", () => session.restart());
  retryButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (usesManualFallback && state.monitorFallbackSession !== session) {
      activateFallbackPreview(session);
      return;
    }
    if (session.restart()) return;
    if (player.state() !== "blocked" && player.state() !== "unavailable") return;
    void player.play(camera);
  });

  if (state.monitorObserver) {
    state.monitorObserver.observe(tile);
  }

  return tile;
}

function recommendationInputs({ readyOnly = false } = {}) {
  const now = new Date();
  return recommendationCameras()
    .filter((camera) => !readyOnly || state.todayForecastStore?.status(camera) === "ready")
    .map((camera) => ({
      camera,
      forecast: state.todayForecastStore?.get(camera) || null,
      conditions: getConditions(camera),
      advice: recommendationAdviceFor(camera, state.spotData, now.getTime()),
      tide: findAdviceTideSnapshot(camera, state.spotData, state.tideData, now)
        || findNearestTideSnapshot(camera, state.tideData, now),
      driveMinutes: driveMinutes(camera)
    }));
}

function appendEvidenceRow(container, label, value) {
  if (!value) return;
  const row = document.createElement("div");
  const term = document.createElement("span");
  const detail = document.createElement("strong");
  term.textContent = label;
  detail.textContent = value;
  row.append(term, detail);
  container.appendChild(row);
}

function renderTimelineDetails(details, evaluation) {
  details.textContent = "";
  details.dataset.selectedTime = evaluation.time;
  appendEvidenceRow(details, "Time", formatLisbonTime(evaluation.time));
  appendEvidenceRow(details, "Local face", evaluation.localFace
    ? `${evaluation.localFace.minM.toFixed(1)}–${evaluation.localFace.maxM.toFixed(1)} m`
    : "No trusted estimate");
  appendEvidenceRow(details, "Primary swell", Number.isFinite(evaluation.offshore?.primarySwellHeightM)
    ? `${evaluation.offshore.primarySwellHeightM.toFixed(1)} m · ${evaluation.offshore.primarySwellPeriodS ?? "?"} s`
    : "Unknown");
  appendEvidenceRow(details, "Wind", Number.isFinite(evaluation.wind?.speedKmh)
    ? `${Math.round(evaluation.wind.speedKmh)} km/h · ${evaluation.wind.directionDeg ?? "?"}°`
    : "Unknown");
  appendEvidenceRow(details, "Tide", evaluation.tide?.stage
    ? `${evaluation.tide.stage} · ${evaluation.tide.direction || "turning"}`
    : "Unknown");
  appendEvidenceRow(details, "Evidence", `${evaluation.confidence} confidence · ${evaluation.localFace?.source || "no local-face source"}`);
}

function createTodayTimeline(recommendation) {
  const shell = document.createElement("details");
  shell.className = "recommendation-timeline";

  const summary = document.createElement("summary");
  summary.textContent = "Hourly forecast & evidence";

  const timeline = document.createElement("div");
  timeline.className = "today-timeline";
  timeline.setAttribute("role", "group");
  timeline.setAttribute("aria-label", `Hourly forecast for ${recommendation.camera.name}`);

  const details = document.createElement("div");
  details.className = "today-timeline__details";
  const buttons = [];
  recommendation.evaluations.forEach((evaluation) => {
    const button = document.createElement("button");
    button.className = "today-timeline__hour";
    button.type = "button";
    button.dataset.tone = evaluation.quality;
    button.textContent = formatLisbonTime(evaluation.time);
    button.setAttribute("aria-label", `${formatLisbonTime(evaluation.time)}: ${evaluation.quality}. ${evaluation.primaryReason}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      buttons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      renderTimelineDetails(details, evaluation);
    });
    buttons.push(button);
    timeline.appendChild(button);
  });

  const selected = recommendation.bestWindow.representativeHour
    || recommendation.evaluations.find((evaluation) => (
      Date.parse(evaluation.time) >= Date.parse(recommendation.bestWindow.start)
      && evaluation.quality === "good"
    ))
    || recommendation.evaluations[0];
  if (selected) {
    const selectedIndex = recommendation.evaluations.indexOf(selected);
    buttons[selectedIndex]?.setAttribute("aria-pressed", "true");
    renderTimelineDetails(details, selected);
  }

  shell.append(summary, timeline, details);
  return shell;
}

function createRecommendationAction(camera) {
  const action = document.createElement("button");
  action.className = "recommendation-action";
  action.type = "button";
  action.textContent = "Watch live cam";
  action.addEventListener("click", () => selectExploreCamera(camera, { route: true, scroll: true }));
  return action;
}

function appendFeedbackOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function createSessionFeedbackDisclosure(recommendation) {
  const details = document.createElement("details");
  details.className = "session-feedback";
  const summary = document.createElement("summary");
  summary.textContent = "How was it?";

  const form = document.createElement("form");
  const faceLabel = document.createElement("label");
  faceLabel.textContent = "Actual face size";
  const face = document.createElement("select");
  face.name = "actualFace";
  face.required = true;
  appendFeedbackOption(face, "", "Choose…");
  appendFeedbackOption(face, "flat", "Flat");
  appendFeedbackOption(face, "ankle", "Ankle");
  appendFeedbackOption(face, "knee-waist", "Knee–waist");
  appendFeedbackOption(face, "waist-chest", "Waist–chest");
  appendFeedbackOption(face, "head-plus", "Head+");
  faceLabel.appendChild(face);

  const qualityLabel = document.createElement("label");
  qualityLabel.textContent = "Actual quality";
  const quality = document.createElement("select");
  quality.name = "actualQuality";
  quality.required = true;
  appendFeedbackOption(quality, "", "Choose…");
  appendFeedbackOption(quality, "poor", "Poor");
  appendFeedbackOption(quality, "okay", "Okay");
  appendFeedbackOption(quality, "good", "Good");
  qualityLabel.appendChild(quality);

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Note (optional)";
  const note = document.createElement("textarea");
  note.name = "note";
  note.maxLength = 500;
  note.rows = 2;
  noteLabel.appendChild(note);

  const save = document.createElement("button");
  save.className = "secondary-button";
  save.type = "submit";
  save.textContent = "Save check-in";
  const status = document.createElement("span");
  status.className = "session-feedback__status";
  status.setAttribute("aria-live", "polite");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const predicted = recommendation.bestWindow.representativeHour
      || recommendation.bestWindow.hours[0]
      || recommendation.evaluations[0];
    try {
      addSessionFeedback({
        spotId: recommendation.camera.id,
        startedAt: new Date().toISOString(),
        predictedQuality: recommendation.quality,
        predictedConfidence: recommendation.confidence,
        predictedFaceMinM: predicted?.localFace?.minM ?? null,
        predictedFaceMaxM: predicted?.localFace?.maxM ?? null,
        actualFace: values.get("actualFace"),
        actualQuality: values.get("actualQuality"),
        tideStage: predicted?.tide?.stage || "unknown",
        note: values.get("note")
      });
      status.textContent = "Saved privately in this browser.";
      form.reset();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  form.append(faceLabel, qualityLabel, noteLabel, save, status);
  details.append(summary, form);
  return details;
}

function createBestBetCard(recommendation) {
  const card = document.createElement("article");
  card.className = "best-bet-card";

  const header = document.createElement("header");
  header.className = "best-bet-card__header";
  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = recommendation.camera.name;
  const timeCall = document.createElement("p");
  timeCall.className = "best-bet-card__time";
  timeCall.textContent = formatWindowCall(recommendation.bestWindow);
  identity.append(name, timeCall);

  const confidence = document.createElement("span");
  confidence.className = "recommendation-confidence";
  confidence.dataset.confidence = recommendation.confidence;
  confidence.textContent = `${recommendation.confidence} confidence`;
  header.append(identity, confidence);

  const leaveCall = document.createElement("p");
  leaveCall.className = "best-bet-card__leave";
  leaveCall.textContent = formatLeaveCall(recommendation.bestWindow, recommendation.driveMinutes) || "Travel time unavailable";

  const reasons = document.createElement("ul");
  reasons.className = "recommendation-reasons";
  recommendation.reasons.slice(0, 3).forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    reasons.appendChild(item);
  });

  const actions = document.createElement("div");
  actions.className = "recommendation-actions";
  actions.appendChild(createRecommendationAction(recommendation.camera));

  card.append(header, leaveCall, reasons, actions, createTodayTimeline(recommendation), createSessionFeedbackDisclosure(recommendation));
  return card;
}

function createWorthCheckingRow(recommendation) {
  const row = document.createElement("article");
  row.className = "worth-checking-row";
  const copy = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = recommendation.camera.name;
  const reason = document.createElement("p");
  reason.textContent = recommendation.primaryReason;
  copy.append(name, reason);
  row.append(copy, createRecommendationAction(recommendation.camera));
  return row;
}

function appendTodayEmptyState(message, detail = "") {
  const empty = document.createElement("div");
  empty.className = "today-empty-state";
  const title = document.createElement("strong");
  title.textContent = message;
  empty.appendChild(title);
  if (detail) {
    const copy = document.createElement("p");
    copy.textContent = detail;
    empty.appendChild(copy);
  }
  els.bestBetsList.appendChild(empty);
}

function renderTodayRecommendations() {
  const readyOnly = state.todayForecastLoading;
  const inputs = recommendationInputs({ readyOnly });
  const result = recommendTodaySpots(inputs, state.preferences, { now: Date.now() });
  const visibleBestBets = shortlistBestBets(result.bestBets);
  const hasFreshAnchor = inputs.some((input) => input.conditions?.source === "surfline-fresh");
  const wasWorthCheckingOpen = els.worthChecking.open;

  els.bestBetsList.textContent = "";
  els.worthCheckingList.textContent = "";
  visibleBestBets.forEach((recommendation) => {
    els.bestBetsList.appendChild(createBestBetCard(recommendation));
  });

  if (!result.bestBets.length) {
    if (state.todayForecastLoading && !inputs.length) {
      appendTodayEmptyState("Checking the remaining daylight…", "Best bets appear only after the required inputs are ready.");
    } else if (!state.todayForecastLoading && (state.todayForecastSummary?.ready || 0) === 0) {
      appendTodayEmptyState("No trustworthy Best bets for the rest of today.", "No fresh hourly forecast — cannot make a trustworthy call.");
    } else if (!hasFreshAnchor) {
      appendTodayEmptyState(
        "No trustworthy Best bets for the rest of today.",
        `No Surfline local-face anchor updated within ${SURFLINE_FRESH_MAX_AGE_HOURS} hours.`
      );
    } else {
      appendTodayEmptyState("No trustworthy Best bets for the rest of today.", "Forecast loaded, but every researched spot misses a hard gate.");
    }
  }

  result.worthChecking.forEach((recommendation) => {
    els.worthCheckingList.appendChild(createWorthCheckingRow(recommendation));
  });
  els.worthCheckingCount.textContent = result.worthChecking.length ? `(${result.worthChecking.length})` : "";
  els.worthChecking.hidden = result.worthChecking.length === 0;
  els.worthChecking.open = wasWorthCheckingOpen && !els.worthChecking.hidden;

  els.monitorStatus.hidden = false;
  els.monitorStatus.textContent = formatRecommendationStatus({
    loading: state.todayForecastLoading,
    readyCount: inputs.length,
    totalCandidates: recommendationCameras().length,
    visibleBestBets: visibleBestBets.length,
    totalBestBets: result.bestBets.length,
    worthChecking: result.worthChecking.length,
    hasFreshAnchor
  });
}

function setMonitorMode(mode) {
  state.monitorMode = mode;
  els.monitorFavoritesMode.setAttribute("aria-pressed", String(mode === "favorites"));
  els.monitorMightBeGoodMode.setAttribute("aria-pressed", String(mode === "might-be-good"));
  renderMonitor();
  if (mode === "might-be-good") {
    void loadTodayForecasts();
  } else {
    state.recommendationGeneration += 1;
  }
}

function renderMonitor() {
  clearMonitorPlayers();
  renderWaterSummaries();
  renderStalenessBanner();

  const favoritesMode = state.monitorMode === "favorites";
  els.monitorGrid.hidden = !favoritesMode;
  els.todayRecommendations.hidden = favoritesMode;
  if (!favoritesMode) {
    els.monitorWaterSummary.hidden = true;
    els.monitorGrid.textContent = "";
    renderTodayRecommendations();
    return;
  }

  const favoriteCameras = monitorFavoriteCameras(
    state.cameras,
    state.favoriteIds,
    favoriteOrder(),
    { getDriveDistanceKm: driveDistanceKm }
  );

  els.monitorGrid.textContent = "";

  if (!favoriteCameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No favorites selected.";
    els.monitorGrid.appendChild(empty);
  } else {
    state.monitorObserver = createMonitorObserver();
    favoriteCameras.forEach((camera, index) => {
      els.monitorGrid.appendChild(createMonitorTile({ camera }, index));
    });
  }

  els.monitorStatus.hidden = true;
  els.monitorStatus.textContent = "";
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

function renderWaterSummary(container, camera = waterSummaryCamera()) {
  if (!container) return;

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
  renderWaterSummary(els.monitorWaterSummary);
  renderWaterSummary(els.favoritesWaterSummary);

  if (state.selectedExploreCamera?.adviceGuideOnly) {
    els.detailWaterSummary.textContent = "";
    els.detailWaterSummary.hidden = true;
    return;
  }
  renderWaterSummary(els.detailWaterSummary, state.selectedExploreCamera || undefined);
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

function createConditionStrip(camera, { showName = false, compact = false } = {}) {
  const strip = document.createElement("div");
  strip.className = compact ? "condition-strip condition-strip--compact" : "condition-strip";
  if (camera.adviceGuideOnly) {
    const label = "Guide only · no live camera or conditions";
    strip.setAttribute("aria-label", `${camera.name} / ${label}`);
    const message = document.createElement("span");
    message.className = "muted";
    message.textContent = label;
    strip.appendChild(message);
    return strip;
  }
  const resolved = getConditions(camera);
  strip.setAttribute("aria-label", `${camera.name} / ${formatConditionLine(camera, state.preferences, resolved)}`);
  const driveEstimate = findDriveEstimate(camera, state.spotData);
  const chips = new Map(
    formatConditionChips(camera, state.preferences, { driveEstimate }, resolved)
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

  const chip = document.createElement("span");
  chip.className = `provenance-chip provenance-${resolved.source}`;
  chip.textContent = resolved.source === "surfline-fresh"
    ? `Surfline · ${Math.round(resolved.ageHours)}h`
    : resolved.source === "live-model" ? "Model · now" : "MEO · static";
  chip.title = resolved.fetchedAt ? `fetched ${resolved.fetchedAt}` : "embedded crawl snapshot";
  metricsRow.appendChild(chip);

  strip.appendChild(metricsRow);

  const routeRow = document.createElement("div");
  routeRow.className = "condition-strip__route";
  ["coast", "drive"].forEach((key) => {
    const chip = chips.get(key);
    if (chip) routeRow.appendChild(createConditionToken(chip));
  });
  if (routeRow.childElementCount) strip.appendChild(routeRow);

  return strip;
}

function updateLocalLensSlot(line, camera, now = new Date()) {
  const evaluatedAt = now instanceof Date ? now : new Date(now);
  const resolved = getConditions(camera);
  const tide = findAdviceTideSnapshot(camera, state.spotData, state.tideData, evaluatedAt);
  const lens = selectLocalLens(camera, state.spotData, resolved, tide, evaluatedAt.getTime());
  if (!lens) {
    line.textContent = "";
    line.hidden = true;
    return null;
  }

  line.hidden = false;
  line.textContent = `${lens.scopeLabel} · ${lens.text}`;
  return lens;
}

function renderLocalLens(container, camera) {
  const line = document.createElement("p");
  line.className = "local-lens";
  line.dataset.role = "local-lens";
  line.dataset.cameraId = camera.id;
  container.appendChild(line);
  updateLocalLensSlot(line, camera);
  return line;
}

function announceFavoriteStatus(message) {
  els.favoriteStatusLive.textContent = message;
}

function hideFavoriteUndoToast() {
  els.favoriteUndoToast.hidden = true;
  els.favoriteUndoMessage.textContent = "Camera removed.";
}

function cancelFavoriteUndoOffer() {
  favoriteUndo.cancel();
  hideFavoriteUndoToast();
}

function renderFavoriteMutationSurfaces(cameraId = null) {
  renderMonitorIfActive();
  renderFavorites();
  renderExploreList();
  renderMarkers();
  if (cameraId && state.selectedExploreCamera?.id === cameraId) {
    renderExploreSelection(state.cameras.find((candidate) => candidate.id === cameraId) || null);
  }
}

function addFavoriteCamera(cameraId) {
  const catalog = playableFavoriteCatalog(state.cameras, state.favoriteIds);
  const record = catalog.find(({ camera }) => camera.id === cameraId);
  const candidateFavoriteIds = addFavorite(state.favoriteIds, cameraId, catalog);

  if (!record) {
    announceFavoriteStatus("That camera does not have a supported playable feed.");
    return false;
  }
  if (state.favoriteIds.has(cameraId) || !candidateFavoriteIds.has(cameraId)) {
    announceFavoriteStatus(`${record.camera.name} is already saved.`);
    return false;
  }

  try {
    const nextFavoriteIds = commitFavoriteMutation(state.favoriteIds, (nextFavoriteIds) => {
      candidateFavoriteIds.forEach((id) => nextFavoriteIds.add(id));
    });
    state.favoriteIds = nextFavoriteIds;
  } catch (error) {
    announceFavoriteStatus(`Could not save ${record.camera.name}. Your favorites were not changed.`);
    return false;
  }

  cancelFavoriteUndoOffer();
  renderFavoriteMutationSurfaces(cameraId);
  announceFavoriteStatus(`${record.camera.name} added to favorites.`);
  if (els.favoriteAddDialog.open) {
    els.favoriteAddInput.value = "";
    renderFavoriteAddResults();
  }
  return true;
}

function removeFavoriteCamera(camera) {
  if (!camera || !state.favoriteIds.has(camera.id)) return false;

  try {
    const nextFavoriteIds = commitFavoriteMutation(state.favoriteIds, (nextFavoriteIds) => {
      nextFavoriteIds.delete(camera.id);
    });
    state.favoriteIds = nextFavoriteIds;
  } catch (error) {
    announceFavoriteStatus(`Could not remove ${camera.name}. Your favorites were not changed.`);
    return false;
  }

  cancelFavoriteUndoOffer();
  renderFavoriteMutationSurfaces(camera.id);
  favoriteUndo.offer(camera);
  els.favoriteUndoMessage.textContent = `${camera.name} removed.`;
  els.favoriteUndoToast.hidden = false;
  announceFavoriteStatus(`${camera.name} removed from favorites. Undo is available for 10 seconds.`);
  return true;
}

function undoFavoriteRemoval() {
  const camera = favoriteUndo.consume();
  hideFavoriteUndoToast();
  if (!camera) return;

  try {
    const nextFavoriteIds = commitFavoriteMutation(state.favoriteIds, (nextFavoriteIds) => {
      nextFavoriteIds.add(camera.id);
    });
    state.favoriteIds = nextFavoriteIds;
  } catch (error) {
    announceFavoriteStatus(`Could not restore ${camera.name}. Your favorites were not changed.`);
    return;
  }

  renderFavoriteMutationSurfaces(camera.id);
  announceFavoriteStatus(`${camera.name} restored to favorites.`);
}

function toggleFavorite(camera, checked) {
  if (!camera || camera.adviceGuideOnly) return;
  if (checked) {
    addFavoriteCamera(camera.id);
  } else {
    removeFavoriteCamera(camera);
  }
}

function syncFavoriteToggle(button, camera) {
  const isFavorite = Boolean(camera && !camera.adviceGuideOnly && state.favoriteIds.has(camera.id));
  button.hidden = Boolean(camera?.adviceGuideOnly);
  button.disabled = !camera || Boolean(camera.adviceGuideOnly);
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

  const poster = document.createElement("img");
  poster.className = "favorite-poster";
  poster.src = camera.image || camera.poster || camera.stillUrl || "";
  poster.alt = `Poster frame for ${camera.name}`;
  poster.loading = "lazy";
  poster.decoding = "async";

  const body = document.createElement("div");
  body.className = "favorite-card__body";

  const header = document.createElement("header");

  const title = document.createElement("h2");
  title.textContent = camera.name;

  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;

  header.append(title, meta);
  const feed = document.createElement("p");
  feed.className = "favorite-card__feed";
  feed.textContent = `Source: ${favoriteSourceLabel(camera)} · ${favoriteFeedStatus(camera)}`;

  const conditionStrip = createConditionStrip(camera, { compact: true });
  renderLocalLens(conditionStrip, camera);
  body.append(header, feed, conditionStrip);

  const removeButton = document.createElement("button");
  removeButton.className = "secondary-button favorite-remove-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", `Remove ${camera.name} from favorites`);
  removeButton.addEventListener("click", () => removeFavoriteCamera(camera));

  card.append(poster, body, removeButton);
  return card;
}

function favoriteSourceLabel(camera) {
  const source = camera.streamSource || camera.provider || camera.source || "";
  if (source === "meo" || source === "meo-beachcam") return "MEO Beachcam";
  if (source === "surfline" || source === "surfline-raw") return "Surfline";
  return source ? formatRegion(source) : "Supported source";
}

function favoriteFeedStatus(camera) {
  return camera.hasStream && camera.streamUrl ? "Feed available" : "Feed unavailable";
}

function renderFavorites() {
  els.favoritesList.textContent = "";
  renderWaterSummaries();
  const cameras = favoriteCameras();
  announceFavoriteStatus(`${cameras.length} saved camera${cameras.length === 1 ? "" : "s"}.`);

  if (!cameras.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No cameras saved yet. Add a supported playable camera.";
    els.favoritesList.appendChild(empty);
    return;
  }

  cameras.forEach((camera) => {
    els.favoritesList.appendChild(createFavoriteCard(camera));
  });
}

function favoriteProviderValue(camera) {
  return camera.streamSource || camera.provider || camera.source || "";
}

function renderFavoriteAddFilterOptions() {
  const catalogCameras = playableFavoriteCatalog(state.cameras, state.favoriteIds)
    .map(({ camera }) => camera);
  renderRegionOptions(els.favoriteAddRegion, catalogCameras);

  els.favoriteAddProvider.textContent = "";
  const allSources = document.createElement("option");
  allSources.value = "";
  allSources.textContent = "All sources";
  els.favoriteAddProvider.appendChild(allSources);

  const providers = new Map();
  catalogCameras.forEach((camera) => {
    const value = favoriteProviderValue(camera);
    if (value) providers.set(value, favoriteSourceLabel(camera));
  });
  [...providers.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
    .forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      els.favoriteAddProvider.appendChild(option);
    });
}

function hideFavoriteAddResults() {
  favoriteAddActiveIndex = -1;
  els.favoriteAddResults.hidden = true;
  els.favoriteAddInput.setAttribute("aria-expanded", "false");
  els.favoriteAddInput.removeAttribute("aria-activedescendant");
}

function setFavoriteAddActiveIndex(index) {
  const options = [...els.favoriteAddResults.querySelectorAll("[data-favorite-option]")];
  if (!options.length) {
    favoriteAddActiveIndex = -1;
    els.favoriteAddInput.removeAttribute("aria-activedescendant");
    return;
  }

  favoriteAddActiveIndex = Math.max(0, Math.min(index, options.length - 1));
  options.forEach((option, optionIndex) => {
    option.setAttribute("aria-selected", String(optionIndex === favoriteAddActiveIndex));
  });
  const activeOption = options[favoriteAddActiveIndex];
  els.favoriteAddInput.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

function acceptFavoriteAddRecord(index = favoriteAddActiveIndex) {
  const record = favoriteAddRecords[index];
  if (!record) return;
  if (record.saved || state.favoriteIds.has(record.camera.id)) {
    announceFavoriteStatus(`${record.camera.name} is already saved.`);
    return;
  }
  addFavoriteCamera(record.camera.id);
}

function favoriteAddOptionLabel({ camera, saved }) {
  const place = [camera.location, formatRegion(camera.region)].filter(Boolean).join(" · ");
  const savedLabel = saved ? " · Saved" : "";
  return `${camera.name} — ${place} · ${favoriteSourceLabel(camera)}${savedLabel}`;
}

function renderFavoriteAddResults() {
  const catalog = playableFavoriteCatalog(state.cameras, state.favoriteIds);
  favoriteAddRecords = searchFavoriteCatalog(catalog, {
    query: els.favoriteAddInput.value,
    region: els.favoriteAddRegion.value,
    provider: els.favoriteAddProvider.value
  });
  favoriteAddActiveIndex = -1;
  els.favoriteAddInput.removeAttribute("aria-activedescendant");
  els.favoriteAddResults.textContent = "";

  if (!favoriteAddRecords.length) {
    const noResults = document.createElement("div");
    noResults.className = "favorite-add-option favorite-add-option--empty";
    noResults.setAttribute("role", "option");
    noResults.setAttribute("aria-disabled", "true");
    noResults.textContent = "No matches. Only supported cameras with playable feeds appear here.";
    els.favoriteAddResults.appendChild(noResults);
  } else {
    favoriteAddRecords.forEach((record, index) => {
      const option = document.createElement("div");
      option.className = "favorite-add-option";
      option.id = `favorite-add-option-${index}`;
      option.dataset.favoriteOption = "";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      if (record.saved) option.setAttribute("aria-disabled", "true");
      option.textContent = favoriteAddOptionLabel(record);
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        setFavoriteAddActiveIndex(index);
        acceptFavoriteAddRecord(index);
        els.favoriteAddInput.focus();
      });
      els.favoriteAddResults.appendChild(option);
    });
  }

  els.favoriteAddResults.hidden = false;
  els.favoriteAddInput.setAttribute("aria-expanded", "true");
}

function openFavoriteAddDialog() {
  if (!els.favoriteAddDialog.open) els.favoriteAddDialog.showModal();
  renderFavoriteAddResults();
  els.favoriteAddInput.focus();
}

function closeFavoriteAddDialog() {
  hideFavoriteAddResults();
  if (els.favoriteAddDialog.open) els.favoriteAddDialog.close();
  els.addFavoriteCamera.focus();
}

function openFavoriteAddResultsForNavigation() {
  if (els.favoriteAddResults.hidden) renderFavoriteAddResults();
  return favoriteAddRecords.length;
}

function handleFavoriteAddKeydown(event) {
  let resultCount;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      resultCount = openFavoriteAddResultsForNavigation();
      if (resultCount) setFavoriteAddActiveIndex(
        favoriteAddActiveIndex < resultCount - 1 ? favoriteAddActiveIndex + 1 : 0
      );
      break;
    case "ArrowUp":
      event.preventDefault();
      resultCount = openFavoriteAddResultsForNavigation();
      if (resultCount) setFavoriteAddActiveIndex(
        favoriteAddActiveIndex > 0 ? favoriteAddActiveIndex - 1 : resultCount - 1
      );
      break;
    case "Home":
      event.preventDefault();
      resultCount = openFavoriteAddResultsForNavigation();
      if (!resultCount) break;
      setFavoriteAddActiveIndex(0);
      break;
    case "End":
      event.preventDefault();
      resultCount = openFavoriteAddResultsForNavigation();
      if (!resultCount) break;
      setFavoriteAddActiveIndex(resultCount - 1);
      break;
    case "Enter":
      if (favoriteAddActiveIndex < 0) break;
      event.preventDefault();
      acceptFavoriteAddRecord();
      break;
    case "Escape":
      event.preventDefault();
      event.stopPropagation();
      if (!els.favoriteAddResults.hidden) {
        hideFavoriteAddResults();
      } else {
        closeFavoriteAddDialog();
      }
      break;
    default:
      break;
  }
}

function playExploreCamera(camera) {
  if (state.activeRoute !== "explore") return;
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
    : `${cameras.length} spots shown. Select a row or marker for details.`;
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

function renderSlCamBadge(camera) {
  els.detailName.parentElement?.querySelector(".sl-cam-badge")?.remove();
  if (!camera?.surflineCams?.length) return;

  const badge = document.createElement("span");
  badge.className = "sl-cam-badge";
  badge.textContent = "SL cam";
  badge.title = camera.surflineCams.map((cam) => cam.title).filter(Boolean).join(", ");
  els.detailName.insertAdjacentElement("afterend", badge);
}

function ratingTone(rating) {
  const normalized = String(rating || "").toUpperCase();
  if (["GOOD", "VERY_GOOD", "EPIC"].includes(normalized)) return "good";
  if (["POOR", "VERY_POOR"].includes(normalized)) return "poor";
  if (["POOR_TO_FAIR", "FAIR", "FAIR_TO_GOOD"].includes(normalized)) return "caution";
  return "muted";
}

function ratingLabel(rating) {
  return String(rating || "No rating").replaceAll("_", " ");
}

function createStretchSpotTile(spot) {
  const tile = document.createElement("article");
  tile.className = "stretch-tile";
  tile.dataset.kind = "spot";

  if (spot.stillUrl) {
    const image = document.createElement("img");
    image.className = "stretch-tile__image";
    image.loading = "lazy";
    image.src = spot.stillUrl;
    image.alt = `${spot.name} Surfline still`;
    tile.appendChild(image);
  }

  const body = document.createElement("div");
  body.className = "stretch-tile__body";

  const name = document.createElement("span");
  name.className = "stretch-tile__name";
  name.textContent = spot.name;

  const rating = document.createElement("span");
  rating.className = "stretch-tile__rating";

  const dot = document.createElement("span");
  dot.className = "stretch-tile__rating-dot";
  dot.dataset.tone = ratingTone(spot.conditions?.rating);

  const label = document.createElement("span");
  label.className = "stretch-tile__rating-label";
  label.textContent = ratingLabel(spot.conditions?.rating);

  rating.append(dot, label);
  body.append(name, rating);
  tile.appendChild(body);
  return tile;
}

function createStretchCamTile(camera) {
  const tile = document.createElement("button");
  tile.className = "stretch-tile";
  tile.dataset.kind = "cam";
  tile.type = "button";
  tile.setAttribute("aria-current", String(camera.id === state.selectedExploreCamera?.id));

  const body = document.createElement("div");
  body.className = "stretch-tile__body";

  const name = document.createElement("span");
  name.className = "stretch-tile__name";
  name.textContent = camera.name;

  const label = document.createElement("span");
  label.className = "stretch-tile__meta";
  label.textContent = "MEO cam";

  body.append(name, label);
  tile.appendChild(body);
  tile.addEventListener("click", () => selectExploreCamera(camera, { pan: true, scroll: true }));
  return tile;
}

function createStretchPanel(members) {
  const panel = document.createElement("div");
  panel.className = "stretch-panel";
  panel.setAttribute("aria-label", members.stretchName);

  members.spots.forEach((spot) => {
    panel.appendChild(createStretchSpotTile(spot));
  });

  members.cams.forEach((camera) => {
    panel.appendChild(createStretchCamTile(camera));
  });

  return panel;
}

function renderStretchView(camera) {
  state.stretchPanelEl?.remove();
  state.stretchPanelEl = null;
  state.stretchChipEl?.remove();
  state.stretchChipEl = null;

  const members = camera ? stretchMembers(camera, state.spotData, byId()) : null;
  if (!members) return;

  const chip = document.createElement("button");
  chip.className = "stretch-chip";
  chip.type = "button";
  chip.textContent = `⟷ ${members.stretchName}`;
  chip.setAttribute("aria-expanded", "false");
  chip.addEventListener("click", () => {
    if (state.stretchPanelEl) {
      state.stretchPanelEl.remove();
      state.stretchPanelEl = null;
      chip.setAttribute("aria-expanded", "false");
      return;
    }

    const panel = createStretchPanel(members);
    chip.insertAdjacentElement("afterend", panel);
    state.stretchPanelEl = panel;
    chip.setAttribute("aria-expanded", "true");
  });

  els.detailConditionStrip.insertAdjacentElement("afterend", chip);
  state.stretchChipEl = chip;
}

let spotPlaybookRegionSequence = 0;

function safeAdviceSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function appendAdviceMeta(container, item) {
  const meta = document.createElement("p");
  meta.className = "advice-meta";

  const scope = document.createElement("span");
  scope.className = "advice-scope";
  scope.textContent = item.scopeLabel || "Spot advice";
  meta.appendChild(scope);

  if (item.provenanceLabel && item.provenanceLabel !== item.scopeLabel) {
    const provenance = document.createElement("span");
    provenance.className = "advice-scope advice-scope--observation";
    provenance.textContent = item.provenanceLabel;
    meta.appendChild(provenance);
  }

  const confidence = document.createElement("span");
  confidence.className = "advice-confidence";
  confidence.textContent = `Confidence: ${item.confidence || "unknown"}`;
  meta.appendChild(confidence);

  if (item.consensus === "unresolved") {
    const conflict = document.createElement("span");
    conflict.className = "advice-conflict";
    conflict.textContent = "Guidance differs";
    meta.appendChild(conflict);
  }

  if (item.needsRevalidation || item.revalidateAfter) {
    const expired = document.createElement("span");
    expired.className = "advice-expired";
    expired.hidden = !item.needsRevalidation;
    expired.textContent = item.needsRevalidation ? "Needs revalidation" : "";
    if (item.revalidateAfter) {
      const revalidateAt = Date.parse(`${item.revalidateAfter}T23:59:59.999Z`);
      if (Number.isFinite(revalidateAt)) expired.dataset.revalidateAt = String(revalidateAt);
    }
    meta.appendChild(expired);
  }

  container.appendChild(meta);
}

function createAdviceClaim(claim) {
  const item = document.createElement("article");
  item.className = claim.consensus === "unresolved"
    ? "advice-claim advice-claim--conflict"
    : "advice-claim";

  const summary = document.createElement("p");
  summary.className = "advice-claim__summary";
  summary.textContent = claim.summary;
  item.appendChild(summary);
  appendAdviceMeta(item, claim);
  return item;
}

function createAdviceSource(source) {
  const item = document.createElement("li");
  const url = safeAdviceSourceUrl(source.url);

  if (url) {
    const link = document.createElement("a");
    link.textContent = source.title || "Source";
    link.setAttribute("href", url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    item.appendChild(link);
  } else {
    const title = document.createElement("span");
    title.textContent = source.title || "Source";
    item.appendChild(title);
  }

  if (source.publisher) {
    const publisher = document.createElement("span");
    publisher.className = "advice-source__publisher";
    publisher.textContent = ` · ${source.publisher}`;
    item.appendChild(publisher);
  }
  if (source.supportedClaim) {
    const support = document.createElement("p");
    support.className = "advice-source__support";
    support.textContent = source.supportedClaim;
    item.appendChild(support);
  }
  appendAdviceMeta(item, source);
  return item;
}

function createSpotPlaybook(playbook) {
  const shell = document.createElement("section");
  shell.className = "spot-playbook-shell";

  const safeSubjectId = String(playbook.subjectId || "spot").replace(/[^a-z0-9_-]+/gi, "-");
  const regionId = `spot-playbook-${safeSubjectId}-${spotPlaybookRegionSequence += 1}`;
  const toggle = document.createElement("button");
  toggle.className = "spot-playbook-toggle";
  toggle.type = "button";
  toggle.textContent = "Local playbook";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", regionId);

  const region = document.createElement("div");
  region.className = "spot-playbook";
  region.id = regionId;
  region.hidden = true;
  region.tabIndex = -1;
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", `Local playbook for ${playbook.name}`);

  if (playbook.guideOnly) {
    const guide = document.createElement("p");
    guide.className = "spot-playbook__guide-note";
    guide.textContent = "Guide only · no live camera or conditions";
    region.appendChild(guide);
  }

  if (playbook.conflicts?.length) {
    const conflict = document.createElement("p");
    conflict.className = "advice-conflict advice-conflict--banner";
    conflict.textContent = "Guidance differs · Published sources disagree; compare the alternatives below.";
    region.appendChild(conflict);
  }

  const sectionDefinitions = [
    ["size-here", "Size here"],
    ["best-window", "Best window"],
    ["how-it-breaks", "How it breaks"],
    ["know-before-you-go", "Know before you go"],
    ["why-we-say-this", "Why we say this"]
  ];
  const sectionsById = new Map((playbook.sections || []).map((section) => [section.id, section]));

  sectionDefinitions.forEach(([id, title]) => {
    const data = sectionsById.get(id) || { claims: [], sources: [] };
    const section = document.createElement("section");
    section.className = "spot-playbook__section";

    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);

    (data.claims || []).forEach((claim) => section.appendChild(createAdviceClaim(claim)));
    if (id === "why-we-say-this") {
      const list = document.createElement("ul");
      list.className = "advice-source-list";
      (data.sources || []).forEach((source) => list.appendChild(createAdviceSource(source)));
      section.appendChild(list);
    }
    region.appendChild(section);
  });

  function closePlaybook({ returnFocus = false } = {}) {
    region.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener("click", (event) => {
    const opening = region.hidden;
    if (!opening) {
      closePlaybook({ returnFocus: true });
      return;
    }

    region.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (event.detail === 0) region.focus();
  });

  region.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    closePlaybook({ returnFocus: true });
  });

  shell.append(toggle, region);
  return shell;
}

function renderSpotPlaybook(camera) {
  state.spotPlaybookEl?.remove();
  state.spotPlaybookEl = null;
  if (!camera) return;

  const playbook = formatSpotPlaybook(camera, state.spotData);
  if (!playbook) return;
  const shell = createSpotPlaybook(playbook);
  els.detailConditionStrip.insertAdjacentElement("afterend", shell);
  state.spotPlaybookEl = shell;
}

function updateAdviceExpiryLabel(element, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const revalidateAt = Number(element.dataset.revalidateAt);
  const needsRevalidation = Number.isFinite(nowMs)
    && Number.isFinite(revalidateAt)
    && nowMs > revalidateAt;
  element.hidden = !needsRevalidation;
  element.textContent = needsRevalidation ? "Needs revalidation" : "";
}

function refreshAdviceUiInPlace(now = new Date()) {
  const cameras = new Map(state.cameras.map((camera) => [camera.id, camera]));
  document.querySelectorAll('[data-role="local-lens"][data-camera-id]').forEach((slot) => {
    const camera = cameras.get(slot.dataset.cameraId);
    if (camera) updateLocalLensSlot(slot, camera, now);
  });
  document.querySelectorAll('.advice-expired[data-revalidate-at]').forEach((element) => {
    updateAdviceExpiryLabel(element, now);
  });
}

function startAdviceRefreshScheduler({
  now = () => Date.now(),
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (id) => window.clearTimeout(id),
  refresh = refreshAdviceUiInPlace
} = {}) {
  const generation = state.adviceRefreshGeneration + 1;
  state.adviceRefreshGeneration = generation;
  if (state.adviceRefreshTimerId !== null) clearTimer(state.adviceRefreshTimerId);

  const scheduleNext = () => {
    const nowMs = Number(now());
    const minuteRemainder = ((nowMs % 60_000) + 60_000) % 60_000;
    const delay = Math.max(1_000, 60_000 - minuteRemainder);
    state.adviceRefreshTimerId = setTimer(tick, delay);
  };
  const tick = () => {
    if (state.adviceRefreshGeneration !== generation) return;
    state.adviceRefreshTimerId = null;
    refresh(new Date(Number(now())));
    scheduleNext();
  };
  scheduleNext();

  return () => {
    if (state.adviceRefreshGeneration !== generation) return;
    state.adviceRefreshGeneration += 1;
    if (state.adviceRefreshTimerId !== null) clearTimer(state.adviceRefreshTimerId);
    state.adviceRefreshTimerId = null;
  };
}

function renderExploreConditions(camera) {
  els.detailConditionStrip.textContent = "";
  if (!camera) return;
  const conditionStrip = createConditionStrip(camera);
  renderLocalLens(conditionStrip, camera);
  els.detailConditionStrip.appendChild(conditionStrip);
}

function renderExploreSelection(camera) {
  state.selectedExploreCamera = camera || null;
  renderWaterSummaries();

  if (!camera) {
    els.detailName.textContent = "Select a spot";
    els.detailLocation.textContent = "Choose a marker for details.";
    els.detailFavorite.disabled = true;
    syncFavoriteToggle(els.detailFavorite, null);
    renderSlCamBadge(null);
    renderExploreConditions(null);
    renderStretchView(null);
    renderSpotPlaybook(null);
    renderMarkers();
    state.explorePlayer.clear();
    return;
  }

  els.detailName.textContent = camera.name;
  els.detailLocation.textContent = `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`;
  els.detailFavorite.disabled = false;
  syncFavoriteToggle(els.detailFavorite, camera);
  renderSlCamBadge(camera);
  renderExploreConditions(camera);
  renderStretchView(camera);
  renderSpotPlaybook(camera);
  updateExploreRowSelection(camera.id);
  renderMarkers();
  playExploreCamera(camera);
  requestLiveForecastForSelection(camera);
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
    setupMinutes: formField("setupMinutes").value,
    surfSizeScale: formField("surfSizeScale").value,
    preferOffshore: formField("preferOffshore").checked,
    allowLightWind: formField("allowLightWind").checked
  };
}

function downloadSessionFeedbackExport() {
  const blob = new Blob([exportSessionFeedback()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const action = document.createElement("a");
  action.href = url;
  action.download = `surfcams-session-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(action);
  action.click();
  action.remove();
  URL.revokeObjectURL(url);
  els.sessionFeedbackStatus.textContent = "Session feedback exported.";
}

async function handleSessionFeedbackImport() {
  const file = els.importSessionFeedbackInput.files?.[0];
  if (!file) return;
  try {
    const records = importSessionFeedback(await file.text());
    els.sessionFeedbackStatus.textContent = `Imported ${records.length} total session check-ins.`;
  } catch (error) {
    els.sessionFeedbackStatus.textContent = error.message;
  } finally {
    els.importSessionFeedbackInput.value = "";
  }
}

function markerIcon(camera, active = false) {
  const rating = camera.adviceGuideOnly
    ? { key: "guide" }
    : rateSurfSpot(camera, state.preferences, getConditions(camera));

  return L.divIcon({
    className: "",
    html: `<span class="cam-marker" data-active="${active}" data-favorite="${state.favoriteIds.has(camera.id)}" data-fit="${rating.key}" data-live="${camera.hasStream}" data-promoted="${camera.promoted ? "1" : "0"}"></span>`,
    iconSize: active ? [28, 28] : [20, 20],
    iconAnchor: active ? [14, 14] : [10, 10],
    popupAnchor: [0, -12]
  });
}

function isMightBeGood(camera) {
  if (camera.adviceGuideOnly) return false;
  const resolved = getConditions(camera);
  return inSuggestionFence(camera)
    && resolved.source !== "meo-static"
    && rateSurfSpot(camera, state.preferences, resolved).isRecommended;
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
  renderFavoriteAddFilterOptions();
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

  els.addFavoriteCamera.addEventListener("click", openFavoriteAddDialog);
  els.closeFavoriteAddDialog.addEventListener("click", closeFavoriteAddDialog);
  els.favoriteAddDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeFavoriteAddDialog();
  });
  els.favoriteAddInput.addEventListener("input", renderFavoriteAddResults);
  els.favoriteAddInput.addEventListener("keydown", handleFavoriteAddKeydown);
  els.favoriteAddInput.addEventListener("click", () => {
    if (els.favoriteAddResults.hidden) renderFavoriteAddResults();
  });
  [els.favoriteAddRegion, els.favoriteAddProvider].forEach((select) => {
    select.addEventListener("change", renderFavoriteAddResults);
  });
  els.favoriteUndoButton.addEventListener("click", undoFavoriteRemoval);
  window.addEventListener("pagehide", () => favoriteUndo.cleanup());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearMonitorPlayers();
    } else if (state.activeRoute === "monitor") {
      renderMonitor();
    }
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

  els.exportSessionFeedbackButton.addEventListener("click", downloadSessionFeedbackExport);
  els.importSessionFeedbackInput.addEventListener("change", () => {
    void handleSessionFeedbackImport();
  });
}

async function init() {
  bindEvents();
  const [cameraDb, spotData, tideData] = await Promise.all([
    loadCameraDb(),
    loadSpotData().catch(() => emptySpotData()),
    loadTideData().catch(() => emptyTideData())
  ]);

  const { localStreamOverrides = {}, ...baseCameraDb } = cameraDb;
  state.spotData = spotData;
  state.db = mergeAdviceGuideSubjects(
    mergePromotedSpots(
      applySpotMetadataToCameraDb(baseCameraDb, spotData),
      spotData.promotedDb
    ),
    spotData.advice
  );
  state.tideData = tideData;
  state.cameras = sortCamerasByLatitudeDescending(resolveFeedBackedCameras(
    state.db,
    spotData,
    localStreamOverrides
  ));
  state.favoriteIds = sanitizeFavoriteIds(state.cameras, loadFavoriteIds(state.cameras));
  state.preferences = loadSurfPreferences();
  state.todayForecastStore = createTodayForecastStore({
    fetchForecast: (camera) => fetchLiveForecast(camera)
  });
  state.todayForecastUnsubscribe = state.todayForecastStore.subscribe(() => {
    if (state.monitorMode === "might-be-good") renderMonitorIfActive();
  });

  renderRegions();
  renderConfigure();
  renderFavorites();
  renderExploreList();
  renderExploreSelection(favoriteCameras()[0] || state.cameras[0]);
  setRoute("monitor");
  startAdviceRefreshScheduler();
}

init().catch((error) => {
  els.monitorStatus.hidden = false;
  els.monitorStatus.textContent = error.message;
});
