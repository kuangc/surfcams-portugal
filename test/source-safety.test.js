import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const configSource = fs.readFileSync("src/config.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const packageSource = fs.readFileSync("package.json", "utf8");
const claudeSource = fs.readFileSync("CLAUDE.md", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");
const videoSource = fs.readFileSync("src/video-player.js", "utf8");
const buildSpotDataSource = fs.readFileSync("scripts/build-spot-data.js", "utf8");
const buildMeoSurflineMatchesSource = fs.readFileSync("scripts/build-meo-surfline-matches.js", "utf8");
const buildCoastExposuresSource = fs.readFileSync("scripts/build-coast-exposures.js", "utf8");
const buildSurflineSpotsSource = fs.readFileSync("scripts/build-surfline-spots.js", "utf8");
const buildSpotMetadataEnrichmentSource = fs.readFileSync("scripts/build-spot-metadata-enrichment.js", "utf8");
const buildNeedsReviewSource = fs.existsSync("scripts/build-surfline-needs-review-html.js")
  ? fs.readFileSync("scripts/build-surfline-needs-review-html.js", "utf8")
  : "";
const browserSurflineCacheSource = fs.existsSync("scripts/cache-surfline-browser-cdp.js")
  ? fs.readFileSync("scripts/cache-surfline-browser-cdp.js", "utf8")
  : "";
const cacheSurflineSource = fs.readFileSync("scripts/cache-surfline-pages.js", "utf8");
const surflineRefreshWorkflowSource = fs.readFileSync(".github/workflows/update-surfline-conditions.yml", "utf8");
const conditionsFreshnessSource = fs.readFileSync("scripts/check-conditions-freshness.js", "utf8");

test("main UI avoids selector interpolation from camera IDs", () => {
  assert.doesNotMatch(mainSource, /querySelector\(`\[data-camera-row=/);
  assert.match(mainSource, /row\.dataset\.cameraRow === cameraId/);
});

test("CDN dependencies are pinned to explicit versions", () => {
  assert.doesNotMatch(`${configSource}\n${videoSource}`, /@latest/);
  assert.match(configSource, /hls\.js@1\.6\.4/);
  assert.match(indexSource, /leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="/);
  assert.match(indexSource, /rel="icon"/);
});

test("home screen install metadata points to generated app icons", () => {
  assert.match(indexSource, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(indexSource, /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png">/);
  assert.match(indexSource, /<meta name="theme-color" content="#08756f">/);
  assert.match(packageSource, /"build-pwa-icons":\s*"node scripts\/generate-pwa-icons\.js"/);
  assert.ok(fs.existsSync("manifest.webmanifest"), "manifest.webmanifest exists");

  const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "Surfcams Portugal");
  assert.equal(manifest.short_name, "Surfcams");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#08756f");
  assert.equal(manifest.background_color, "#f7fbfb");

  const iconSizes = new Map(manifest.icons.map((icon) => [icon.src, icon.sizes]));
  assert.equal(iconSizes.get("./icons/icon-192.png"), "192x192");
  assert.equal(iconSizes.get("./icons/icon-512.png"), "512x512");

  for (const [iconPath, expectedSize] of [
    ["icons/icon-192.png", 192],
    ["icons/icon-512.png", 512],
    ["apple-touch-icon.png", 180]
  ]) {
    assert.ok(fs.existsSync(iconPath), `${iconPath} exists`);
    const icon = fs.readFileSync(iconPath);
    assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG", `${iconPath} is a PNG`);
    assert.equal(icon.readUInt32BE(16), expectedSize, `${iconPath} width`);
    assert.equal(icon.readUInt32BE(20), expectedSize, `${iconPath} height`);
  }
});

test("v3 source has monitor-first routing and no v2 monitor overlay", () => {
  assert.match(indexSource, /id="monitorScreen"[^>]*data-active="true"/);
  assert.doesNotMatch(indexSource, /id="monitorDeck"/);
  assert.doesNotMatch(indexSource, /bestTodayTitle/);
});

test("main controller wires v3 screens and keeps might-be-good explicit", () => {
  assert.match(mainSource, /activeRoute:\s*"monitor"/);
  assert.match(mainSource, /loadSpotData/);
  assert.match(mainSource, /findDriveEstimate/);
  assert.match(mainSource, /monitorMode:\s*"favorites"/);
  assert.match(mainSource, /monitorFavoriteCameras/);
  assert.match(mainSource, /recommendTodaySpots/);
  assert.match(mainSource, /renderMonitor/);
  assert.match(mainSource, /renderFavorites/);
  assert.match(mainSource, /renderExploreSelection/);
  assert.match(mainSource, /renderExploreList/);
  assert.match(mainSource, /playExploreCamera/);
  assert.match(mainSource, /createGalleryPreviewSession/);
  assert.match(mainSource, /playableFavoriteCatalog/);
  assert.match(mainSource, /searchFavoriteCatalog/);
  assert.match(mainSource, /addFavorite/);
  assert.match(mainSource, /commitFavoriteMutation/);
  assert.match(mainSource, /createFavoriteUndo/);
  assert.doesNotMatch(mainSource, /favoriteManagerCameras/);
  assert.doesNotMatch(mainSource, /manageSpotCameras/);
  assert.match(mainSource, /resolveFeedBackedCameras/);
  assert.match(mainSource, /const \{ localStreamOverrides = \{\}, \.\.\.baseCameraDb \} = cameraDb/);
  assert.match(mainSource, /state\.cameras\s*=\s*sortCamerasByLatitudeDescending\(\s*resolveFeedBackedCameras\(/s);
  assert.doesNotMatch(mainSource, /state\.db\?\.cameras\s*\|\|\s*state\.cameras/);
  assert.match(mainSource, /sanitizeFavoriteIds\(state\.cameras,\s*loadFavoriteIds\(state\.cameras\)\)/);
  assert.match(mainSource, /createFavoriteToggle/);
  assert.match(mainSource, /selectExploreCamera/);
  assert.match(mainSource, /renderWaterSummaries/);
  assert.match(mainSource, /formatWaterSummary/);
  assert.match(mainSource, /loadTideData/);
  assert.match(mainSource, /findTideSnapshot/);
  assert.match(mainSource, /tideSnapshot/);
  assert.match(mainSource, /PROVIDER_ICON_URLS/);
  assert.match(mainSource, /provider-logo/);
  assert.match(mainSource, /explorePlayer/);
  assert.match(mainSource, /renderConfigure/);
  assert.match(mainSource, /route !== "monitor"[\s\S]*clearMonitorPlayers/);
  assert.doesNotMatch(mainSource, /Showing favorites only\. Empty slots are not auto-filled\./);
  assert.match(mainSource, /renderTodayRecommendations/);
  assert.doesNotMatch(mainSource, /autoFill/i);
});

test("Monitor gallery scopes preview streams to one viewport observer lifecycle", () => {
  assert.equal(mainSource.match(/new (?:window\.)?IntersectionObserver\(/g)?.length, 1);
  assert.match(mainSource, /root:\s*null/);
  assert.match(mainSource, /rootMargin:\s*"0px"/);
  assert.match(mainSource, /state\.monitorSessions\.get\(entry\.target\)[\s\S]*setVisible\(entry\.isIntersecting\)/);
  assert.match(mainSource, /state\.monitorSessions\.set\(tile,\s*session\)/);
  assert.match(mainSource, /state\.monitorObserver\.observe\(tile\)/);

  assert.match(mainSource, /function clearMonitorPlayers\(\)[\s\S]*monitorObserver\?\.disconnect\(\)[\s\S]*session\.clear\(\)[\s\S]*monitorSessions\.clear\(\)/);
  assert.match(mainSource, /function renderMonitor\(\)\s*{\s*clearMonitorPlayers\(\)/);
  assert.match(mainSource, /route !== "monitor"[\s\S]*clearMonitorPlayers\(\)/);
  assert.match(mainSource, /visibilitychange[\s\S]*document\.hidden[\s\S]*clearMonitorPlayers\(\)/);

  assert.match(mainSource, /function createMonitorTile[\s\S]*video\.poster\s*=\s*camera\.image/);
  assert.match(mainSource, /frame\.addEventListener\("click"[\s\S]*session\.restart\(\)/);
  assert.match(mainSource, /retryButton\.addEventListener\("click"[\s\S]*session\.retry\(\)/);
  const galleryTileSource = mainSource.match(/function createMonitorTile[\s\S]*?\n}\n\nfunction recommendationInputs/)?.[0] || "";
  assert.match(galleryTileSource, /let session\s*=\s*null/);
  assert.match(galleryTileSource, /onStateChange:[\s\S]*session\?\.reconcilePlayerState\(playerState\)/);
  assert.doesNotMatch(galleryTileSource, /void player\.play\(camera\)/);
  assert.match(mainSource, /(?:blocked|unavailable)[\s\S]*(?:Play|Retry)/);
  assert.doesNotMatch(mainSource, /scheduleMonitorTile|restartMonitorTile|MONITOR_DURATION_MS|playTimeoutId|350 \+ \(index \* 450\)/);
});

test("Monitor keeps observer-less fallback playback bounded to one explicit preview", () => {
  assert.match(mainSource, /monitorFallbackSession:\s*null/);
  assert.match(mainSource, /function activateFallbackPreview\(session\)/);
  assert.match(mainSource, /state\.monitorFallbackSession\?\.setVisible\(false\)/);
  assert.match(mainSource, /state\.monitorFallbackSession\s*=\s*session[\s\S]*session\.setVisible\(true\)/);
  assert.match(mainSource, /retryButton\.textContent\s*=\s*"Play preview"/);
  assert.match(mainSource, /retryButton\.addEventListener\("click"[\s\S]*activateFallbackPreview\(session\)/);
  assert.match(mainSource, /function clearMonitorPlayers\(\)[\s\S]*monitorFallbackSession\s*=\s*null/);
  assert.doesNotMatch(mainSource, /else\s*{\s*session\.setVisible\(true\);\s*}/);
});

test("Monitor and Favorites share one validated entry point for large Focus playback", () => {
  assert.match(mainSource, /createMonitorViewState/);
  assert.match(mainSource, /monitorView:\s*createMonitorViewState\(\)/);
  assert.match(mainSource, /focusedPlayers:\s*new Map\(\)/);
  assert.match(mainSource, /function enterMonitorFocus\(cameraId,\s*originElement/);
  assert.match(mainSource, /function createMonitorTile[\s\S]*openLarge\.textContent\s*=\s*"Open large"[\s\S]*enterMonitorFocus\(camera\.id,\s*tile\)/);
  assert.match(mainSource, /function createFavoriteCard[\s\S]*openLarge\.textContent\s*=\s*"Open large"[\s\S]*enterMonitorFocus\(camera\.id,\s*card\)/);
  assert.match(mainSource, /function enterMonitorFocus[\s\S]*monitorFavoriteCameras\([\s\S]*window\.scrollY[\s\S]*openMonitorFocus\(/);
});

test("Focus and Compare use direct untimed pane-local players with replacement controls", () => {
  assert.match(mainSource, /function createFocusedPane\(camera,\s*paneIndex/);
  assert.match(mainSource, /function createFocusedPane[\s\S]*createFeedTilePlayer\([\s\S]*focusedPlayers\.set\([\s\S]*player\.play\(camera\)/);
  assert.match(mainSource, /data-focus-action[\s\S]*"replace"/);
  assert.match(mainSource, /data-focus-action[\s\S]*"remove"/);
  assert.match(mainSource, /data-focus-action[\s\S]*"retry"/);
  assert.match(mainSource, /replaceFocusedCamera\(state\.monitorView,\s*paneIndex/);
  assert.match(mainSource, /removeComparisonCamera\(state\.monitorView,\s*paneIndex\)/);
  assert.match(mainSource, /playerState === "blocked"[\s\S]*playerState === "unavailable"[\s\S]*retryButton/);
  assert.match(mainSource, /function createFocusedPane[\s\S]*retryButton\.addEventListener\("click",[\s\S]*player\.state\(\) === "blocked"\s*\?\s*player\.resume\(\)\s*:\s*player\.play\(camera\)/);

  const focusPaneSource = mainSource.match(/function createFocusedPane[\s\S]*?\n}\n\nfunction /)?.[0] || "";
  assert.doesNotMatch(focusPaneSource, /createGalleryPreviewSession|60_000|setTimeout/);
  assert.match(mainSource, /monitorFocusCamera[\s\S]*replaceFocusedCamera\(state\.monitorView,\s*0/);
  assert.match(mainSource, /populateFocusCameraSelect\(\s*els\.monitorFocusCamera,\s*roster\.filter\(\(camera\) => camera\.id === primary\.id \|\| !state\.monitorView\.focusedCameraIds\.includes\(camera\.id\)\)/);
  assert.match(mainSource, /monitorComparePicker[\s\S]*addComparisonCamera\(state\.monitorView/);
});

test("gallery Play delegates synchronous resume and retry to the session lifecycle", () => {
  const tileSource = mainSource.match(/function createMonitorTile[\s\S]*?\n}\n\nfunction recommendationInputs/)?.[0] || "";
  assert.match(
    tileSource,
    /retryButton\.addEventListener\("click"[\s\S]*session\.resume\(\)[\s\S]*session\.retry\(\)/
  );
  assert.doesNotMatch(tileSource, /player\.state\(\) === "blocked"|player\.resume\(\)/);
});

test("Focus playback cleanup, visibility restoration, and gallery origin restoration are explicit", () => {
  assert.match(mainSource, /function clearFocusedPlayers\(\)[\s\S]*player\.clear\(\)[\s\S]*focusedPlayers\.clear\(\)/);
  assert.match(mainSource, /route !== "monitor"[\s\S]*clearFocusedPlayers\(\)/);
  assert.match(mainSource, /mode === "might-be-good"[\s\S]*exitMonitorFocus\(state\.monitorView\)[\s\S]*clearFocusedPlayers\(\)/);
  assert.match(mainSource, /visibilitychange[\s\S]*document\.hidden[\s\S]*clearFocusedPlayers\(\)[\s\S]*renderMonitor\(\)/);
  assert.match(mainSource, /function exitMonitorFocusView[\s\S]*exitMonitorFocus\(state\.monitorView\)[\s\S]*afterNextPaint\([\s\S]*window\.scrollTo/);
  assert.match(mainSource, /function exitMonitorFocusView[\s\S]*runAfterFullscreenExit\(state\.fullscreenController,[\s\S]*clearFocusedPlayers\(\)[\s\S]*exitMonitorFocus\(state\.monitorView\)/);
  assert.doesNotMatch(mainSource, /fullscreenController\.isFullscreen\(\)\) void state\.fullscreenController\.exit\(\)/);
  assert.match(mainSource, /querySelectorAll\("\[data-camera-id\]"\)[\s\S]*\.find\(\(tile\) => tile\.dataset\.cameraId === originCameraId\)[\s\S]*focus\(\)/);
  assert.doesNotMatch(mainSource, /querySelector\(`\[data-camera-id=/);
});

test("Explore playback clears when the document is hidden or the page is left", () => {
  const pagehideSource = mainSource.match(
    /window\.addEventListener\("pagehide", \([^)]*\) => \{[\s\S]*?\n  \}\);/
  )?.[0] || "";
  const visibilitySource = mainSource.match(
    /document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*?\n  \}\);/
  )?.[0] || "";

  assert.match(pagehideSource, /state\.explorePlayer\.clear\(\)/);
  assert.match(visibilitySource, /document\.hidden[\s\S]*state\.explorePlayer\.clear\(\)/);
  assert.match(
    visibilitySource,
    /state\.activeRoute\s*===\s*"explore"[\s\S]*state\.selectedExploreCamera[\s\S]*playExploreCamera\(state\.selectedExploreCamera\)/
  );
});

test("app-owned fullscreen targets the complete Focus composition and reports errors locally", () => {
  assert.match(mainSource, /createFullscreenController\(\{[\s\S]*target:\s*els\.monitorFocusComposition[\s\S]*document[\s\S]*onStateChange[\s\S]*onError/);
  assert.match(mainSource, /monitorFocusFullscreen[\s\S]*fullscreenController\.toggle\(\)/);
  assert.match(mainSource, /monitorFocusStatus\.textContent\s*=\s*"Fullscreen could not be changed\."/);
  assert.match(mainSource, /monitorFocusFullscreen\.disabled\s*=\s*!supported/);
  assert.match(mainSource, /monitorFocusPanes:\s*document\.querySelector\("#monitorFocusPanes"\)/);
  assert.match(mainSource, /function renderMonitorFocus[\s\S]*monitorFocusPanes\.textContent\s*=\s*""[\s\S]*monitorFocusPanes\.appendChild/);
  assert.match(mainSource, /monitorFocusPanes\.children\[paneIndex\]/);
  assert.doesNotMatch(mainSource, /monitorFocusComposition\.textContent\s*=/);
});

test("BFCache pagehide preserves the live fullscreen controller", () => {
  const pagehideSource = mainSource.match(
    /window\.addEventListener\("pagehide",[\s\S]*?\n\s*}\);/
  )?.[0] || "";

  assert.match(pagehideSource, /\(event\)\s*=>/);
  assert.match(
    pagehideSource,
    /if\s*\(!event\.persisted\)\s*state\.fullscreenController\.destroy\(\);/
  );
});

test("BFCache pageshow reactivates the persisted current route", () => {
  const pageshowSource = mainSource.match(
    /window\.addEventListener\("pageshow",\s*\(event\)\s*=>\s*\{[\s\S]*?\n\s*}\);/
  )?.[0] || "";

  assert.match(pageshowSource, /if\s*\(!event\.persisted\)\s*return;/);
  assert.match(
    pageshowSource,
    /state\.activeRoute\s*===\s*"monitor"[\s\S]*renderMonitor\(\)/
  );
  assert.match(
    pageshowSource,
    /state\.activeRoute\s*===\s*"explore"[\s\S]*state\.selectedExploreCamera[\s\S]*playExploreCamera\(state\.selectedExploreCamera\)/
  );
});

test("Focus and Compare styling keeps one useful feed or two equal responsive panes", () => {
  assert.match(styleSource, /\.monitor-grid\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(styleSource, /\.monitor-focus\s*{[\s\S]*container-type:\s*inline-size/);
  assert.match(styleSource, /\.monitor-focus__composition\[data-view="focus-one"\][\s\S]*max-width:/);
  assert.match(styleSource, /@container[\s\S]*min-width:\s*(?:640|654)px[\s\S]*\.monitor-focus__composition\[data-view="compare-two"\]\s+\.monitor-focus__panes[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(320px,\s*1fr\)\)/);
  assert.match(styleSource, /\.monitor-focus__composition:fullscreen/);
  assert.match(styleSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styleSource, /\.monitor-focus[\s\S]*:focus-visible/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.monitor-focus__header\s*{[^}]*flex-direction:\s*column/s);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.monitor-focus__actions\s*{[^}]*width:\s*100%/s);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.monitor-focus__select\s*{[^}]*min-width:\s*0/s);
});

test("main controller loads hourly forecasts only for the Might be good roster", () => {
  assert.match(mainSource, /createTodayForecastStore/);
  assert.match(mainSource, /recommendationGeneration:\s*0/);
  assert.match(mainSource, /function recommendationCameras/);
  assert.match(mainSource, /inSuggestionFence/);
  assert.match(mainSource, /function loadTodayForecasts/);
  assert.match(mainSource, /state\.todayForecastStore\.load\(recommendationCameras\(\)\)/);
  assert.match(mainSource, /mode === "might-be-good"[\s\S]*loadTodayForecasts/);
});

test("explore map refreshes after the visible layout has painted", () => {
  assert.match(mainSource, /function afterNextPaint/);
  assert.match(mainSource, /requestAnimationFrame/);
  assert.match(mainSource, /function refreshExploreMap/);
  assert.match(mainSource, /invalidateSize\(\{\s*pan:\s*false\s*\}\)/);
  assert.match(mainSource, /mapHasInitialFit:\s*false/);
  assert.doesNotMatch(mainSource, /ensureMap\(\);\s*renderExploreList\(\);\s*renderMarkers\(\);\s*state\.map\.invalidateSize\(\);/);
});

test("Explore selection state starts map-first and explicit user choices promote detail", () => {
  assert.match(mainSource, /createExploreViewState/);
  assert.match(mainSource, /exploreView:\s*createExploreViewState\(\)/);
  assert.match(mainSource, /function selectExploreCamera\(camera,\s*\{\s*explicit\s*=\s*false,\s*pan\s*=\s*false,\s*route\s*=\s*false\s*\}\s*=\s*\{\}\)/);
  assert.match(mainSource, /state\.exploreView\s*=\s*selectExploreSpot\(state\.exploreView,\s*camera\.id,\s*\{\s*explicit\s*\}\)/);

  const userSelectionCalls = [...mainSource.matchAll(/selectExploreCamera\(camera,\s*\{([^}]*)\}\)/g)]
    .map((match) => match[1]);
  assert.equal(userSelectionCalls.length, 4, "recommendation, result, stretch, and marker actions select Explore spots");
  userSelectionCalls.forEach((options) => assert.match(options, /explicit:\s*true/));
  assert.doesNotMatch(mainSource, /selectExploreCamera\([^)]*scroll:/);

  const initSource = mainSource.match(/async function init\(\)[\s\S]*?\n}\n\ninit\(\)/)?.[0] || "";
  assert.match(initSource, /initializeExploreSelection\(state\.exploreView,\s*initialExploreCamera\.id\)/);
  assert.doesNotMatch(initSource, /selectExploreCamera\(/);
});

test("explicit Explore selection moves focus to the promoted summary and restores the route top", () => {
  const selectionSource = mainSource.match(
    /function selectExploreCamera\(camera,[\s\S]*?\n}\n\nfunction renderExploreList/
  )?.[0] || "";

  assert.match(selectionSource, /if \(explicit && els\.exploreCameraSummary\)\s*{[\s\S]*exploreCameraSummary\.focus\(\{\s*preventScroll:\s*true\s*}\)/);
  assert.match(selectionSource, /if \(explicit && els\.exploreCameraSummary\)[\s\S]*afterNextPaint\([\s\S]*window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*"auto"\s*}\)/);
  assert.doesNotMatch(selectionSource, /scrollIntoView/);
});

test("Explore emphasis changes resize the same map without changing its viewport", () => {
  const applySource = mainSource.match(
    /function applyExploreEmphasis\(\)[\s\S]*?\n}\n\nfunction openSelectedExploreSpotView/
  )?.[0] || "";
  const expandSource = mainSource.match(
    /function expandExploreMapView\(\)[\s\S]*?\n}/
  )?.[0] || "";

  assert.match(applySource, /exploreLayout\.dataset\.emphasis\s*=\s*state\.exploreView\.emphasis/);
  assert.match(applySource, /openSelectedSpot\.hidden/);
  assert.match(applySource, /expandExploreMap\.hidden/);
  assert.match(applySource, /afterNextPaint\(\(\)\s*=>\s*{/);
  assert.match(applySource, /try\s*{[\s\S]*state\.map\.invalidateSize\(\{\s*pan:\s*false\s*\}\)[\s\S]*}\s*catch\s*\(error\)/);
  assert.match(applySource, /exploreStatus\.textContent/);
  assert.doesNotMatch(applySource, /fitBounds|fitInitialBounds|panTo|ensureMap/);

  assert.match(expandSource, /expandExploreMap\(state\.exploreView\)/);
  assert.match(expandSource, /applyExploreEmphasis\(\)/);
  assert.match(
    expandSource,
    /afterNextPaint\(\(\)\s*=>\s*{[\s\S]*els\.map\.focus\(\{\s*preventScroll:\s*true\s*}\)/
  );
  assert.match(mainSource, /map:\s*document\.querySelector\("#map"\)/);
  assert.doesNotMatch(expandSource, /fitBounds|fitInitialBounds|\.panTo|ensureMap|selectedExploreCamera\s*=|renderExploreSelection/);
  assert.match(mainSource, /openSelectedExploreSpotView[\s\S]*openSelectedExploreSpot\(state\.exploreView\)/);
});

test("Explore map provides a persistent programmatic focus target", () => {
  assert.match(indexSource, /id="map"[^>]*tabindex="-1"/);
});

test("Explore emphasis CSS preserves map and detail mobile reading orders", () => {
  assert.match(styleSource, /\.map-shell\s*{/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="map"\]/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]\s+\.explore-camera-summary\s*{[^}]*order:\s*1/s);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]\s+\.map-shell\s*{[^}]*order:\s*2/s);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]\s+\.spot-panel\s*{[^}]*order:\s*3/s);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]\s+\.browse-panel\s*{[^}]*order:\s*4/s);
  assert.match(styleSource, /@media\s*\(min-width:\s*980px\)[\s\S]*minmax\(480px,[^)]*\)[\s\S]*minmax\(280px,/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\]\s*{[\s\S]*grid-template-columns:\s*minmax\(280px,\s*0\.62fr\)\s+minmax\(480px,\s*1fr\)[\s\S]*"map summary"[\s\S]*"map detail"[\s\S]*"browse detail"/);
  assert.match(styleSource, /\.expand-explore-map\s*{[^}]*top:\s*12px[^}]*right:\s*12px/s);
  assert.doesNotMatch(styleSource, /\.expand-explore-map\s*{[^}]*bottom:/s);
});

test("explore list follows the visible map bounds and pins expose hover names", () => {
  assert.match(mainSource, /function exploreVisibleCameras/);
  assert.match(mainSource, /camerasInBounds\(exploreCameras\(\),\s*state\.map\.getBounds\(\)\)/);
  assert.match(mainSource, /state\.map\.on\("moveend zoomend"/);
  assert.match(mainSource, /function exploreMarkerLabel\(camera/);
  assert.match(mainSource, /title:\s*markerLabel/);
  assert.match(mainSource, /alt:\s*markerLabel/);
  assert.match(mainSource, /marker\.bindTooltip\(camera\.name/);
});

test("v3 styles are monitor-first and responsive without the old side panels", () => {
  assert.match(styleSource, /\.app-shell\s*{/);
  assert.match(styleSource, /\.app-nav\s*{/);
  assert.match(styleSource, /\.monitor-grid\s*{/);
  assert.match(styleSource, /\.browse-panel\s*{/);
  assert.match(styleSource, /\.explore-video-shell\s*{/);
  assert.match(styleSource, /\.favorite-add-dialog\s*{/);
  assert.match(styleSource, /\.favorite-add-results\s*{/);
  assert.match(styleSource, /\.favorite-undo-toast\s*{/);
  assert.match(styleSource, /\.favorite-toggle\s*{/);
  assert.match(styleSource, /\.spot-panel__header\s*{/);
  assert.match(styleSource, /\.condition-chip\s*{/);
  assert.match(styleSource, /\.condition-chip__icon\s*{/);
  assert.match(styleSource, /\.condition-strip__top\s*{/);
  assert.match(styleSource, /\.condition-strip__metrics\s*{/);
  assert.match(styleSource, /\.condition-strip__route\s*{/);
  assert.match(styleSource, /\.provider-logo\s*{/);
  assert.doesNotMatch(styleSource, /provider-mark/);
  assert.match(styleSource, /\.water-summary\s*{/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(112px,\s*1fr\)\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.water-summary\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.water-summary\s*{[\s\S]*gap:\s*8px/);
  assert.doesNotMatch(styleSource.match(/\.water-metric__value\s*{[^}]*}/)?.[0] || "", /font-size:\s*0\.[0-9]+rem/);
  assert.match(indexSource, /id="monitorWaterSummary"/);
  assert.match(indexSource, /id="favoritesWaterSummary"/);
  assert.match(indexSource, /id="detailWaterSummary"/);
  assert.match(indexSource, /id="addFavoriteCamera"/);
  assert.match(indexSource, /id="favoriteAddDialog"/);
  assert.match(indexSource, /aria-label="Toggle favorite"/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="map"\][\s\S]*grid-template-areas:/);
  assert.match(styleSource, /\.map-layout\[data-emphasis="detail"\][\s\S]*grid-template-areas:/);
  assert.match(styleSource, /@media\s*\(max-width:\s*900px\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.favorite-add-dialog\s*{[\s\S]*inset:\s*auto\s+0\s+0/s);
  assert.match(styleSource, /:focus-visible/);
  assert.doesNotMatch(mainSource, /danger-button/);
  assert.match(indexSource, /id="favoriteUndoButton"[^>]*>Undo<\/button>/);
  assert.doesNotMatch(styleSource, /\.sidebar\b/);
  assert.doesNotMatch(styleSource, /\.detail\b/);
});

test("Favorites renderer shows saved cameras with poster, source status, and labeled removal", () => {
  assert.match(mainSource, /function favoriteCameras\(\)\s*{[\s\S]*monitorFavoriteCameras\(/);
  assert.match(mainSource, /function renderFavorites\(\)[\s\S]*favoriteCameras\(\)/);
  assert.match(mainSource, /favorite-poster/);
  assert.match(mainSource, /poster\.src\s*=\s*camera\.image/);
  assert.match(mainSource, /poster\.alt\s*=\s*`Poster frame for \$\{camera\.name\}`/);
  assert.match(mainSource, /favoriteSourceLabel\(camera\)/);
  assert.match(mainSource, /favoriteFeedStatus\(camera\)/);
  assert.match(mainSource, /removeButton\.textContent\s*=\s*"Remove"/);
  assert.match(mainSource, /removeButton\.setAttribute\("aria-label",\s*`Remove \$\{camera\.name\} from favorites`\)/);
});

test("Favorites combobox owns text-only options and implements APG keyboard behavior", () => {
  assert.match(mainSource, /function openFavoriteAddDialog/);
  assert.match(mainSource, /favoriteAddDialog\.showModal\(\)/);
  assert.match(mainSource, /favoriteAddInput\.focus\(\)/);
  assert.match(mainSource, /function closeFavoriteAddDialog/);
  assert.match(mainSource, /addFavoriteCamera\.focus\(\)/);
  assert.match(mainSource, /favoriteAddInput\.addEventListener\("keydown"/);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) {
    assert.match(mainSource, new RegExp(`case "${key}"`));
  }
  assert.match(mainSource, /aria-activedescendant/);
  assert.match(mainSource, /document\.createElement\("div"\)/);
  assert.match(mainSource, /option\.setAttribute\("role",\s*"option"\)/);
  assert.match(mainSource, /option\.setAttribute\("aria-disabled",\s*"true"\)/);
  assert.doesNotMatch(mainSource, /favorite-add-option[^\n]*(?:button|checkbox)/);
});

test("Favorites mutations persist before state assignment and expose one ten-second undo", () => {
  assert.match(mainSource, /durationMs:\s*10_000/);
  assert.match(mainSource, /favoriteUndo\.offer\(removedCamera\)/);
  assert.match(mainSource, /favoriteUndo\.consume\(\)/);
  assert.match(mainSource, /favoriteUndo\.cancel\(\)/);
  assert.match(mainSource, /const nextFavoriteIds = commitFavoriteMutation\(state\.favoriteIds/);
  assert.match(mainSource, /state\.favoriteIds = nextFavoriteIds/);
  assert.match(mainSource, /try\s*{[\s\S]*commitFavoriteMutation[\s\S]*}\s*catch \(error\)\s*{[\s\S]*announceFavoriteStatus/s);
  assert.match(mainSource, /renderMonitorIfActive\(\)[\s\S]*renderFavorites\(\)[\s\S]*renderExploreList\(\)[\s\S]*renderMarkers\(\)/);
  assert.match(mainSource, /playableFavoriteCatalog\(state\.cameras,\s*state\.favoriteIds\)/);
  assert.match(mainSource, /function favoriteRecordForCamera[\s\S]*favoriteFeedRecord\(/);
  assert.match(mainSource, /function syncFavoriteToggle[\s\S]*favoriteRecordForCamera\(camera\)[\s\S]*record\?\.saved/);
  assert.match(mainSource, /function createFavoriteToggle[\s\S]*toggleFavorite\(camera,\s*!favoriteRecordForCamera\(camera\)\?\.saved\)/);
  assert.match(mainSource, /detailFavorite\.addEventListener[\s\S]*toggleFavorite\(camera,\s*!favoriteRecordForCamera\(camera\)\?\.saved\)/);
  assert.match(mainSource, /function isFavoriteCamera[\s\S]*favoriteRecordForCamera\(camera\)\?\.saved/);
  assert.match(mainSource, /function exploreCameras[\s\S]*favoriteIds:\s*feedAwareFavoriteIds\(state\.cameras\)/);
  assert.match(mainSource, /function markerIcon[\s\S]*data-favorite="\$\{isFavoriteCamera\(camera\)\}"/);
});

test("contextual Explore drill-in moves focus to the promoted summary", () => {
  const openSource = mainSource.match(
    /function openSelectedExploreSpotView\(\)[\s\S]*?\n}/
  )?.[0] || "";

  assert.match(openSource, /exploreCameraSummary\.focus\(\{\s*preventScroll:\s*true\s*}\)/);
  assert.match(openSource, /afterNextPaint\([\s\S]*window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*"auto"\s*}\)/);
});

test("Favorites cancel an old undo offer only after a new mutation commits", () => {
  const addSource = mainSource.match(
    /function addFavoriteCamera\(cameraId\)\s*{([\s\S]*?)\n}\n\nfunction removeFavoriteCamera/
  )?.[1] || "";
  const removeSource = mainSource.match(
    /function removeFavoriteCamera\(camera\)\s*{([\s\S]*?)\n}\n\nfunction undoFavoriteRemoval/
  )?.[1] || "";

  const addCommitIndex = addSource.indexOf("state.favoriteIds = nextFavoriteIds;");
  const addCancelIndex = addSource.indexOf("cancelFavoriteUndoOffer();");
  assert.ok(addCommitIndex >= 0, "add assigns only the successfully persisted Set");
  assert.ok(addCancelIndex > addCommitIndex, "add preserves pending undo through no-op and failure exits");
  assert.equal(addSource.lastIndexOf("cancelFavoriteUndoOffer();"), addCancelIndex);

  const removeCommitIndex = removeSource.indexOf("state.favoriteIds = nextFavoriteIds;");
  const removeCancelIndex = removeSource.indexOf("cancelFavoriteUndoOffer();");
  const removeOfferIndex = removeSource.indexOf("favoriteUndo.offer(removedCamera);");
  assert.ok(removeCommitIndex >= 0, "remove assigns only the successfully persisted Set");
  assert.ok(removeCancelIndex > removeCommitIndex, "remove preserves pending undo through no-op and failure exits");
  assert.ok(removeOfferIndex > removeCancelIndex, "a committed remove replaces the prior offer with the new camera");
  assert.equal(removeSource.lastIndexOf("cancelFavoriteUndoOffer();"), removeCancelIndex);
});

test("Favorites navigation opens results before deriving Home, End, and arrow targets", () => {
  const openForNavigationSource = mainSource.match(
    /function openFavoriteAddResultsForNavigation\(\)\s*{([\s\S]*?)\n}/
  )?.[1] || "";
  const renderIndex = openForNavigationSource.indexOf("renderFavoriteAddResults();");
  const countIndex = openForNavigationSource.indexOf("return favoriteAddRecords.length;");

  assert.ok(renderIndex >= 0, "navigation opens a hidden result popup");
  assert.ok(countIndex > renderIndex, "navigation derives the result count after rendering");

  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    const caseSource = mainSource.match(new RegExp(`case "${key}":[\\s\\S]*?break;`))?.[0] || "";
    assert.match(
      caseSource,
      /openFavoriteAddResultsForNavigation\(\)/,
      `${key} navigates only after the listbox is visible and current`
    );
  }
});

test("camera surfaces contain no report substitutes while advice evidence links remain safe", () => {
  const cameraSurfaceSource = `${mainSource}\n${styleSource}\n${indexSource}`;
  for (const forbidden of [
    "Open Surfline report",
    "isReportOnlyCamera",
    "createReportFrame",
    "createSurflineControl",
    "renderReportLink",
    "explore-report-link",
    "report-frame",
    "surfline-control",
    "external-link-icon"
  ]) {
    assert.doesNotMatch(cameraSurfaceSource, new RegExp(forbidden));
  }

  assert.match(mainSource, /function createAdviceSource/);
  assert.match(mainSource, /safeAdviceSourceUrl\(source\.url\)/);
  assert.match(mainSource, /link\.setAttribute\("target", "_blank"\)/);
  assert.match(mainSource, /link\.setAttribute\("rel", "noopener noreferrer"\)/);
});

test("official tide cache has a scheduled refresh path", () => {
  const workflowSource = fs.readFileSync(".github/workflows/update-tides.yml", "utf8");

  assert.match(packageSource, /"fetch-tides":\s*"node scripts\/fetch-tides\.js"/);
  assert.match(workflowSource, /cron:/);
  assert.match(workflowSource, /npm run fetch-tides/);
  assert.match(workflowSource, /data\/portugal-tides\.json/);
});

test("spot advice operator scripts are exposed and local review artifacts stay ignored", () => {
  for (const [scriptName, command] of [
    ["build-spot-advice", "node scripts/build-spot-advice.js"],
    ["check-spot-advice", "node scripts/build-spot-advice.js --check"],
    ["build-spot-advice-review", "node scripts/build-spot-advice-review-html.js"],
    ["apply-spot-advice-feedback", "node scripts/apply-spot-advice-feedback.js"],
    ["check-spot-advice-links", "node scripts/check-spot-advice-links.js"]
  ]) {
    assert.match(packageSource, new RegExp(`"${scriptName}":\\s*"${command.replaceAll(".", "\\.")}`));
  }

  const gitignoreSource = fs.readFileSync(".gitignore", "utf8");
  assert.match(gitignoreSource, /^\.local\/$/m);
});

test("spot advice operator docs separate review preparation from the post-export workflow", () => {
  const spotAdviceDocs = claudeSource.match(/## Spot Advice Research and Review[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
  const commandBlocks = [...spotAdviceDocs.matchAll(/```sh\n([\s\S]*?)\n```/g)]
    .map((match) => match[1].split("\n").filter(Boolean));
  const preparationCommands = commandBlocks.find((commands) => commands.includes("npm run build-spot-advice-review"));
  const postExportCommands = commandBlocks.find((commands) => commands.some((command) => command.startsWith("npm run apply-spot-advice-feedback -- ")));

  assert.deepEqual(preparationCommands, [
    "npm run build-spot-advice",
    "npm run check-spot-advice",
    "npm run build-spot-advice-review"
  ]);
  assert.deepEqual(postExportCommands, [
    "npm run apply-spot-advice-feedback -- .local/spot-advice-feedback.json",
    "npm run build-spot-advice",
    "npm run check-spot-advice"
  ]);
  assert.match(spotAdviceDocs, /apply command[^.]*does not rebuild the runtime artifact/i);
  assert.doesNotMatch(spotAdviceDocs, /apply command[^.]*then rebuilds the runtime artifact/i);
});

test("every external workflow action is commit-pinned and weekly updates stay enabled", () => {
  const workflowSources = fs.readdirSync(".github/workflows")
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(`.github/workflows/${name}`, "utf8"));
  const dependabot = fs.readFileSync(".github/dependabot.yml", "utf8");
  const workflows = workflowSources.join("\n");

  const externalUses = workflows.split("\n")
    .filter((line) => /\buses:\s*(?!\.\/)/.test(line));
  assert.ok(externalUses.length > 0);
  for (const line of externalUses) {
    assert.match(line, /uses:\s*[^\s@]+@[0-9a-f]{40}\s+# v\d+(?:\.\d+){0,2}\s*$/);
  }
  assert.ok(externalUses.some((line) => line.includes("actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0")));
  assert.ok(externalUses.some((line) => line.includes("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0")));
  assert.ok(externalUses.some((line) => line.includes("actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0")));
  assert.match(dependabot, /package-ecosystem:\s*"github-actions"/);
  assert.match(dependabot, /interval:\s*"weekly"/);
});

test("Surfline refresh coverage matches the six-hour recommendation freshness contract", () => {
  const crons = [...surflineRefreshWorkflowSource.matchAll(/cron:\s*"([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(crons, ["17 5 * * *", "17 11 * * *", "17 17 * * *"]);
  assert.match(conditionsFreshnessSource, /MAX_AGE_HOURS\s*=\s*Number\(process\.env\.MAX_AGE_HOURS\s*\|\|\s*6\)/);
});

test("spot data build can refresh road distances from a directions table API", () => {
  assert.match(buildSpotDataSource, /ROUTING_PROVIDER/);
  assert.match(buildSpotDataSource, /router\.project-osrm\.org\/table\/v1\/driving/);
  assert.match(buildSpotDataSource, /annotations=distance,duration/);
  assert.match(buildSpotDataSource, /routeDistanceMeters/);
  assert.match(buildSpotDataSource, /durationSeconds/);
});

test("coast exposure build preserves manually curated exposure entries", () => {
  assert.match(buildCoastExposuresSource, /readExistingCuratedExposures/);
  assert.match(buildCoastExposuresSource, /reviewStatus === "curated"/);
  assert.match(buildCoastExposuresSource, /source === "manual"/);
  assert.match(buildCoastExposuresSource, /collectSurflineMetadataExposures/);
  assert.match(buildCoastExposuresSource, /source:\s*"surfline-metadata"/);
  assert.doesNotMatch(buildCoastExposuresSource, /__NEXT_DATA__/);
});

test("surfline spot build normalizes cached provider metadata within Lisbon radius", () => {
  assert.match(buildSurflineSpotsSource, /LISBON_RADIUS_KM = 100/);
  assert.match(buildSurflineSpotsSource, /travelDetails/);
  assert.match(buildSurflineSpotsSource, /coastExposure/);
  assert.match(buildSurflineSpotsSource, /distanceFromLisbonKm/);
});

test("MEO Surfline remap preserves curated and rejected joins before generated nearest joins", () => {
  assert.match(packageSource, /"build-meo-surfline-matches":\s*"node scripts\/build-meo-surfline-matches\.js"/);
  assert.match(buildMeoSurflineMatchesSource, /preservedByMeoId/);
  assert.match(buildMeoSurflineMatchesSource, /isPreservedMatch/);
  assert.match(buildMeoSurflineMatchesSource, /reviewStatus === "rejected"/);
  assert.match(buildMeoSurflineMatchesSource, /source === "curated"/);
  assert.match(buildMeoSurflineMatchesSource, /generated-nearest/);
  assert.match(buildMeoSurflineMatchesSource, /needs-review/);
  assert.match(buildMeoSurflineMatchesSource, /MAX_PRIMARY_DISTANCE_KM/);
});

test("spot metadata enrichment stays MEO-keyed and compact", () => {
  assert.match(packageSource, /"build-spot-metadata-enrichment":\s*"node scripts\/build-spot-metadata-enrichment\.js"/);
  assert.match(buildSpotMetadataEnrichmentSource, /spot-metadata-enrichment\.json/);
  assert.match(buildSpotMetadataEnrichmentSource, /reviewStatus === "needs-review"/);
  assert.match(buildSpotMetadataEnrichmentSource, /metadataScore/);
  assert.match(buildSpotMetadataEnrichmentSource, /sourceSpotId/);
  assert.match(buildSpotMetadataEnrichmentSource, /breakType/);
  assert.match(buildSpotMetadataEnrichmentSource, /abilityLevels/);
  assert.match(buildSpotMetadataEnrichmentSource, /coastExposure/);
});

test("Surfline needs-review feedback HTML is generated from mapping evidence", () => {
  assert.match(packageSource, /"build-surfline-needs-review":\s*"node scripts\/build-surfline-needs-review-html\.js"/);
  assert.match(buildNeedsReviewSource, /surfline-needs-review\.html/);
  assert.match(buildNeedsReviewSource, /reviewStatus === "needs-review"/);
  assert.match(buildNeedsReviewSource, /weightedMatchScore/);
  assert.match(buildNeedsReviewSource, /namePoints/);
  assert.match(buildNeedsReviewSource, /distancePoints/);
  assert.match(buildNeedsReviewSource, /exportJson/);
  assert.match(buildNeedsReviewSource, /localStorage/);
  assert.match(buildNeedsReviewSource, /Export feedback/);
  assert.doesNotMatch(buildNeedsReviewSource, /manualValue/);
  assert.doesNotMatch(buildNeedsReviewSource, /URL\.createObjectURL/);
});

test("surfline direct cache refresh does not generate placeholder HTML for blocked provider pages", () => {
  assert.doesNotMatch(cacheSurflineSource, /buildGeneratedSnapshotHtml/);
  assert.match(cacheSurflineSource, /!cached\.html\.includes\("x-surfcams-cache-kind"\)/);
  assert.doesNotMatch(cacheSurflineSource, /cacheStatus:\s*"generated-provider-snapshot"/);
  assert.match(cacheSurflineSource, /throw error/);
  assert.match(cacheSurflineSource, /fetchError/);
});

test("browser surfline cache fetches real provider HTML through Chrome CDP", () => {
  assert.match(packageSource, /"cache-surfline-browser":\s*"node scripts\/cache-surfline-browser-cdp\.js"/);
  assert.match(browserSurflineCacheSource, /Runtime\.evaluate/);
  assert.match(browserSurflineCacheSource, /credentials:\s*"include"/);
  assert.match(browserSurflineCacheSource, /__NEXT_DATA__/);
  assert.match(browserSurflineCacheSource, /cacheStatus:\s*"browser-fetched"/);
  assert.match(browserSurflineCacheSource, /source:\s*"chrome-cdp"/);
  assert.doesNotMatch(browserSurflineCacheSource, /generated-provider-snapshot/);
});
