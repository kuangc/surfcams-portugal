import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const configSource = fs.readFileSync("src/config.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const packageSource = fs.readFileSync("package.json", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");
const videoSource = fs.readFileSync("src/video-player.js", "utf8");

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
  assert.match(mainSource, /createFavoriteToggle/);
  assert.match(mainSource, /selectExploreCamera/);
  assert.match(mainSource, /renderWaterSummaries/);
  assert.match(mainSource, /formatWaterSummary/);
  assert.match(mainSource, /loadTideData/);
  assert.match(mainSource, /findTideSnapshot/);
  assert.match(mainSource, /tideSnapshot/);
  assert.match(mainSource, /createSurflineControl/);
  assert.match(mainSource, /PROVIDER_ICON_URLS/);
  assert.match(mainSource, /provider-logo/);
  assert.match(mainSource, /external-link-icon/);
  assert.match(mainSource, /placeholder\.textContent\s*=\s*"Nearby"/);
  assert.match(mainSource, /window\.open\(selectedUrl,\s*"_blank"/);
  assert.match(mainSource, /explorePlayer/);
  assert.match(mainSource, /renderConfigure/);
  assert.match(mainSource, /route !== "monitor"[\s\S]*clearMonitorPlayers/);
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
  assert.match(styleSource, /\.surfline-control\s*{/);
  assert.match(styleSource, /\.surfline-control__select\s*{/);
  assert.doesNotMatch(styleSource, /provider-mark/);
  assert.match(styleSource, /\.water-summary\s*{/);
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
