import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const configSource = fs.readFileSync("src/config.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const packageSource = fs.readFileSync("package.json", "utf8");
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

test("v3 source has monitor-first routing and no v2 monitor overlay", () => {
  assert.match(indexSource, /id="monitorScreen"[^>]*data-active="true"/);
  assert.doesNotMatch(indexSource, /id="monitorDeck"/);
  assert.doesNotMatch(indexSource, /bestTodayTitle/);
});

test("main controller wires v3 screens and keeps might-be-good explicit", () => {
  assert.match(mainSource, /activeRoute:\s*"monitor"/);
  assert.match(mainSource, /loadSpotData/);
  assert.match(mainSource, /findDriveEstimate/);
  assert.match(mainSource, /findSurflineMatches/);
  assert.match(mainSource, /monitorMode:\s*"favorites"/);
  assert.match(mainSource, /monitorCameraSlots/);
  assert.match(mainSource, /mightBeGoodCameras/);
  assert.match(mainSource, /renderMonitor/);
  assert.match(mainSource, /renderFavorites/);
  assert.match(mainSource, /renderExploreSelection/);
  assert.match(mainSource, /renderExploreList/);
  assert.match(mainSource, /playExploreCamera/);
  assert.match(mainSource, /restartMonitorTile/);
  assert.match(mainSource, /favoriteManagerCameras/);
  assert.match(mainSource, /manageSpotCameras/);
  assert.match(mainSource, /state\.db\?\.cameras/);
  assert.match(mainSource, /createFavoriteToggle/);
  assert.match(mainSource, /selectExploreCamera/);
  assert.match(mainSource, /renderWaterSummaries/);
  assert.match(mainSource, /formatWaterSummary/);
  assert.match(mainSource, /loadTideData/);
  assert.match(mainSource, /findTideSnapshot/);
  assert.match(mainSource, /tideSnapshot/);
  assert.match(mainSource, /createSurflineControl/);
  assert.match(mainSource, /isReportOnlyCamera/);
  assert.match(mainSource, /createReportFrame/);
  assert.match(mainSource, /Open Surfline report/);
  assert.match(mainSource, /PROVIDER_ICON_URLS/);
  assert.match(mainSource, /provider-logo/);
  assert.match(mainSource, /external-link-icon/);
  assert.match(mainSource, /placeholder\.textContent\s*=\s*"Nearby"/);
  assert.match(mainSource, /window\.open\(selectedUrl,\s*"_blank"/);
  assert.match(mainSource, /explorePlayer/);
  assert.match(mainSource, /renderConfigure/);
  assert.match(mainSource, /route !== "monitor"[\s\S]*clearMonitorPlayers/);
  assert.doesNotMatch(mainSource, /Showing favorites only\. Empty slots are not auto-filled\./);
  assert.match(mainSource, /monitorStatus\.hidden\s*=\s*state\.monitorMode === "favorites"/);
  assert.doesNotMatch(mainSource, /autoFill/i);
});

test("explore map refreshes after the visible layout has painted", () => {
  assert.match(mainSource, /function afterNextPaint/);
  assert.match(mainSource, /requestAnimationFrame/);
  assert.match(mainSource, /function refreshExploreMap/);
  assert.match(mainSource, /invalidateSize\(\{\s*pan:\s*false\s*\}\)/);
  assert.match(mainSource, /mapHasInitialFit:\s*false/);
  assert.doesNotMatch(mainSource, /ensureMap\(\);\s*renderExploreList\(\);\s*renderMarkers\(\);\s*state\.map\.invalidateSize\(\);/);
});

test("explore list follows the visible map bounds and pins expose hover names", () => {
  assert.match(mainSource, /function exploreVisibleCameras/);
  assert.match(mainSource, /camerasInBounds\(exploreCameras\(\),\s*state\.map\.getBounds\(\)\)/);
  assert.match(mainSource, /state\.map\.on\("moveend zoomend"/);
  assert.match(mainSource, /title:\s*camera\.name/);
  assert.match(mainSource, /alt:\s*camera\.name/);
  assert.match(mainSource, /marker\.bindTooltip\(camera\.name/);
});

test("v3 styles are monitor-first and responsive without the old side panels", () => {
  assert.match(styleSource, /\.app-shell\s*{/);
  assert.match(styleSource, /\.app-nav\s*{/);
  assert.match(styleSource, /\.monitor-grid\s*{/);
  assert.match(styleSource, /\.browse-panel\s*{/);
  assert.match(styleSource, /\.explore-video-shell\s*{/);
  assert.match(styleSource, /\.favorite-toolbar\s*{/);
  assert.match(styleSource, /\.favorite-toggle\s*{/);
  assert.match(styleSource, /\.spot-panel__header\s*{/);
  assert.match(styleSource, /\.condition-chip\s*{/);
  assert.match(styleSource, /\.condition-chip__icon\s*{/);
  assert.match(styleSource, /\.condition-strip__top\s*{/);
  assert.match(styleSource, /\.condition-strip__metrics\s*{/);
  assert.match(styleSource, /\.condition-strip__route\s*{/);
  assert.match(styleSource, /\.provider-logo\s*{/);
  assert.match(styleSource, /\.report-frame\s*{/);
  assert.match(styleSource, /\.report-frame__action\s*{/);
  assert.match(styleSource, /\.surfline-control\s*{/);
  assert.match(styleSource, /\.surfline-control__select\s*{/);
  assert.doesNotMatch(styleSource, /provider-mark/);
  assert.match(styleSource, /\.water-summary\s*{/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(112px,\s*1fr\)\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.water-summary\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)[\s\S]*\.water-summary\s*{[\s\S]*gap:\s*8px/);
  assert.doesNotMatch(styleSource.match(/\.water-metric__value\s*{[^}]*}/)?.[0] || "", /font-size:\s*0\.[0-9]+rem/);
  assert.match(indexSource, /id="monitorWaterSummary"/);
  assert.match(indexSource, /id="favoritesWaterSummary"/);
  assert.match(indexSource, /id="detailWaterSummary"/);
  assert.match(indexSource, /id="favoritesSearchInput"/);
  assert.match(indexSource, /aria-label="Toggle favorite"/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /grid-template-areas:\s*"map detail"\s*"browse detail"/);
  assert.match(styleSource, /@media\s*\(max-width:\s*900px\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*640px\)/);
  assert.doesNotMatch(mainSource, /danger-button/);
  assert.doesNotMatch(indexSource, />Remove favorite</);
  assert.doesNotMatch(styleSource, /\.sidebar\b/);
  assert.doesNotMatch(styleSource, /\.detail\b/);
});

test("official tide cache has a scheduled refresh path", () => {
  const workflowSource = fs.readFileSync(".github/workflows/update-tides.yml", "utf8");

  assert.match(packageSource, /"fetch-tides":\s*"node scripts\/fetch-tides\.js"/);
  assert.match(workflowSource, /cron:/);
  assert.match(workflowSource, /npm run fetch-tides/);
  assert.match(workflowSource, /data\/portugal-tides\.json/);
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

test("MEO Surfline remap preserves curated joins before generated nearest joins", () => {
  assert.match(packageSource, /"build-meo-surfline-matches":\s*"node scripts\/build-meo-surfline-matches\.js"/);
  assert.match(buildMeoSurflineMatchesSource, /curatedByMeoId/);
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
