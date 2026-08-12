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

  assert.match(favoritesScreen, /<h1 id="favoritesTitle">Favorites<\/h1>/);
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
