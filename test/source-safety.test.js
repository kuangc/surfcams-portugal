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
  assert.match(mainSource, /restartMonitorTile/);
  assert.match(mainSource, /favoriteManagerCameras/);
  assert.match(mainSource, /manageSpotCameras/);
  assert.match(mainSource, /resolveFeedBackedCameras/);
  assert.match(mainSource, /const \{ localStreamOverrides = \{\}, \.\.\.baseCameraDb \} = cameraDb/);
  assert.match(mainSource, /state\.cameras\s*=\s*sortCamerasByLatitudeDescending\(\s*resolveFeedBackedCameras\(/s);
  assert.match(mainSource, /function manageSpotCameras\(\)\s*\{\s*return state\.cameras/s);
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
