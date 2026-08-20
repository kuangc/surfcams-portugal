import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const db = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));

test("index embeds the same camera database that lives in data", () => {
  const match = html.match(/<script id="embeddedCameraDb" type="application\/json">([\s\S]*?)<\/script>/);

  assert.ok(match, "embeddedCameraDb script tag exists");
  assert.ok(match[1].trim().length > 0, "embeddedCameraDb is populated");
  assert.deepEqual(JSON.parse(match[1]), db);
});

test("index loads the v3 app shell", () => {
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
  assert.match(html, /data-route="monitor"/);
  assert.match(html, /data-route="favorites"/);
  assert.match(html, /data-route="explore"/);
  assert.match(html, /data-route="configure"/);
  assert.match(html, /id="monitorScreen"/);
  assert.match(html, /id="favoritesScreen"/);
  assert.match(html, /id="exploreScreen"/);
  assert.match(html, /id="configureScreen"/);
  assert.doesNotMatch(html, /Copy URL/);
  assert.doesNotMatch(html, /id="streamUrl"/);
});

test("Favorites defaults to saved cameras with one primary add action", () => {
  const favoritesScreen = html.match(/<section class="screen favorites-screen"[\s\S]*?<dialog class="favorite-add-dialog"/)?.[0] || "";

  assert.match(favoritesScreen, /<h1 id="favoritesTitle"[^>]*>Favorites<\/h1>/);
  assert.match(favoritesScreen, /<button[^>]*class="primary-button"[^>]*id="addFavoriteCamera"[^>]*>Add camera<\/button>/);
  assert.match(favoritesScreen, /id="favoritesList"/);
  assert.doesNotMatch(favoritesScreen, /favorite-toolbar/);

  for (const obsoleteId of [
    "favoritesSearchInput",
    "favoritesRegionSelect",
    "favoritesStatusSelect",
    "favoritesStreamSelect",
    "favoritesDistanceSelect",
    "favoritesSortSelect"
  ]) {
    assert.doesNotMatch(favoritesScreen, new RegExp(`id="${obsoleteId}"`));
  }
});

test("Favorites add-camera dialog exposes an accessible combobox and compact filters", () => {
  const dialog = html.match(/<dialog[^>]*id="favoriteAddDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
  const input = dialog.match(/<input[^>]*id="favoriteAddInput"[^>]*>/)?.[0] || "";
  const filters = dialog.match(/<details[^>]*id="favoriteAddFilters"[^>]*>[\s\S]*?<\/details>/)?.[0] || "";

  assert.match(dialog, /^<dialog\b/);
  assert.match(dialog, /id="closeFavoriteAddDialog"/);
  assert.match(input, /role="combobox"/);
  assert.match(input, /aria-autocomplete="list"/);
  assert.match(input, /aria-controls="favoriteAddResults"/);
  assert.match(input, /aria-expanded="false"/);
  assert.match(input, /autocomplete="off"/);
  assert.match(dialog, /id="favoriteAddResults"[^>]*role="listbox"/);

  assert.match(filters, /^<details(?![^>]*\bopen\b)/);
  assert.match(filters, /id="favoriteAddRegion"/);
  assert.match(filters, /id="favoriteAddProvider"/);
  assert.equal((filters.match(/<select\b/g) || []).length, 2);
  assert.doesNotMatch(filters, /status|stream|distance|sort/i);
});

test("Favorites has one dedicated live status and one ten-second Undo toast", () => {
  assert.equal((html.match(/id="favoriteStatusLive"/g) || []).length, 1);
  assert.match(html, /id="favoriteStatusLive"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.equal((html.match(/id="favoriteUndoToast"/g) || []).length, 1);
  assert.match(html, /id="favoriteUndoToast"[^>]*hidden/);
  assert.match(html, /id="favoriteUndoButton"[^>]*>Undo<\/button>/);
});

test("Monitor includes a non-modal Focus and Compare shell beside the gallery", () => {
  const monitorScreen = html.match(/<section class="screen monitor-screen"[\s\S]*?<\/section>\s*<section class="screen favorites-screen"/)?.[0] || "";
  const focus = monitorScreen.match(/<section[^>]*id="monitorFocus"[\s\S]*?<\/section>/)?.[0] || "";
  const composition = focus.match(/<div[^>]*id="monitorFocusComposition"[^>]*>/)?.[0] || "";
  const compositionScope = focus.slice(focus.indexOf(composition));

  assert.match(monitorScreen, /id="monitorGrid"[\s\S]*id="monitorFocus"/);
  assert.match(focus, /^<section\b[^>]*\bhidden\b/);
  assert.match(focus, /id="monitorFocusTitle"/);
  assert.match(focus, /id="monitorFocusCamera"/);
  assert.match(focus, /id="monitorCompareAction"[^>]*>Compare<\/button>/);
  assert.match(focus, /id="monitorComparePicker"/);
  assert.match(focus, /id="monitorExitFocus"[^>]*>Exit Focus<\/button>/);
  assert.ok(composition, "complete Focus composition wrapper exists");
  assert.doesNotMatch(composition, /aria-live/);
  assert.match(compositionScope, /id="monitorFocusFullscreen"[^>]*>Enter fullscreen<\/button>/);
  assert.match(compositionScope, /id="monitorFocusStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(compositionScope, /id="monitorFocusPanes"/);
  assert.match(compositionScope, /id="monitorFocusFullscreen"[\s\S]*id="monitorFocusPanes"/);
});

test("Explore keeps one persistent map between distinct summary and detail regions", () => {
  const exploreScreen = html.match(
    /<section class="screen explore-screen"[\s\S]*?<section class="screen configure-screen"/
  )?.[0] || "";
  const layout = exploreScreen.match(/<div class="map-layout"[\s\S]*?\n\s*<\/div>\n\s*<p[^>]*id="exploreStatus"/)?.[0] || "";
  const spotPanel = exploreScreen.match(/<aside class="spot-panel"[^>]*id="spotPanel"[^>]*>/)?.[0] || "";

  assert.match(layout, /^<div class="map-layout"[^>]*data-emphasis="map"/);
  assert.equal((exploreScreen.match(/id="map"/g) || []).length, 1);
  assert.match(layout, /id="map"[^>]*tabindex="-1"/);
  assert.match(layout, /class="explore-camera-summary"[^>]*id="exploreCameraSummary"[^>]*tabindex="-1"[\s\S]*id="openSelectedSpot"/);
  assert.match(layout, /id="exploreFeedContext"[^>]*aria-live="polite"/);
  assert.match(layout, /class="map-shell"[\s\S]*id="map"[\s\S]*id="expandExploreMap"/);
  assert.match(layout, /id="expandExploreMap"[^>]*\bhidden\b/);
  assert.ok(spotPanel, "longer spot detail wrapper exists");
  assert.doesNotMatch(spotPanel, /aria-live/);

  const summaryIndex = layout.indexOf('id="exploreCameraSummary"');
  const mapIndex = layout.indexOf('id="map"');
  const detailIndex = layout.indexOf('id="spotPanel"');
  const browseIndex = layout.indexOf('class="browse-panel"');
  assert.ok(summaryIndex < mapIndex && mapIndex < detailIndex && detailIndex < browseIndex,
    "detail mobile DOM order is summary, map, longer details, nearby results");

  assert.match(exploreScreen, /id="exploreStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("Explore exposes its dense search controls through a native mobile disclosure", () => {
  const exploreScreen = html.match(
    /<section class="screen explore-screen"[\s\S]*?<section class="screen configure-screen"/
  )?.[0] || "";
  const disclosure = exploreScreen.match(
    /<details[^>]*id="exploreFiltersDisclosure"[^>]*>[\s\S]*?<\/details>/
  )?.[0] || "";

  assert.match(disclosure, /^<details\b[^>]*\bopen\b/);
  assert.match(disclosure, /<summary>Search &amp; filters<\/summary>/);
  assert.match(disclosure, /class="explore-filters"/);
  assert.match(disclosure, /id="searchInput"/);
  assert.match(disclosure, /id="regionSelect"/);
  assert.match(disclosure, /id="favoriteOnly"/);
  assert.match(disclosure, /id="mightBeGoodOnly"/);
});

test("Settings exposes the protected-origin logout action without adding navigation", () => {
  const configureScreen = html.match(
    /<section class="screen configure-screen"[\s\S]*?<\/section>\s*<\/main>/
  )?.[0] || "";
  const accessTools = configureScreen.match(
    /<section class="access-tools"[^>]*aria-labelledby="accessToolsTitle"[\s\S]*?<\/section>/
  )?.[0] || "";

  assert.match(accessTools, /<h2 id="accessToolsTitle">Access<\/h2>/);
  assert.match(accessTools, /Sign out of this private Surfcams session on this device\./);
  assert.match(
    accessTools,
    /<a class="secondary-button access-logout" href="\/cdn-cgi\/access\/logout">Sign out<\/a>/
  );
  assert.ok(
    configureScreen.indexOf('class="feedback-tools"') < configureScreen.indexOf('class="access-tools"'),
    "Access follows the feedback tools"
  );
  assert.ok(
    configureScreen.indexOf('class="access-tools"') < configureScreen.lastIndexOf('class="status-line"'),
    "Access precedes the final status line"
  );
  assert.equal((html.match(/class="nav-button"/g) || []).length, 4);
});
