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

test("manage spots exposes practical filter and sort controls", () => {
  assert.match(html, /id="favoritesSearchInput"/);
  assert.match(html, /id="favoritesRegionSelect"/);
  assert.match(html, /id="favoritesStatusSelect"/);
  assert.match(html, /id="favoritesStreamSelect"/);
  assert.match(html, /id="favoritesSortSelect"/);
  assert.match(html, /<label class="filter-field" for="favoritesSortSelect">[\s\S]*<span>Sort<\/span>/);
  assert.match(html, /<option value="favorites">Favorites first<\/option>/);
  assert.match(html, /<option value="fit">Best conditions<\/option>/);
  assert.match(html, /<option value="wave">Wave height<\/option>/);
  assert.match(html, /<option value="popular">Most viewed<\/option>/);
});
