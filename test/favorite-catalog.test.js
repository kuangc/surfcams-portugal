import assert from "node:assert/strict";
import test from "node:test";

import {
  addFavorite,
  favoriteFeedRecord,
  playableFavoriteCatalog,
  searchFavoriteCatalog,
  uniquePlayableCameras
} from "../src/favorite-catalog.js";

function camera(id, overrides = {}) {
  return {
    id,
    name: id,
    location: "Lisboa",
    region: "lisboa",
    streamSource: "meo",
    hasStream: true,
    streamUrl: `https://example.com/${id}.m3u8`,
    ...overrides
  };
}

function ids(records) {
  return records.map(({ camera: item }) => item.id);
}

test("playableFavoriteCatalog returns only non-guide cameras with configured HTTPS streams", () => {
  const catalog = playableFavoriteCatalog([
    camera("playable"),
    camera("no-stream", { hasStream: false }),
    camera("missing-url", { streamUrl: "" }),
    camera("http-url", { streamUrl: "http://example.com/http-url.m3u8" }),
    camera("invalid-url", { streamUrl: "not a URL" }),
    camera("guide", { adviceGuideOnly: true })
  ]);

  assert.deepEqual(ids(catalog), ["playable"]);
});

test("playableFavoriteCatalog keeps one stable choice per playable feed", () => {
  const catalog = playableFavoriteCatalog([
    camera("native", { name: "Carcavelos", streamUrl: "https://example.com/shared.m3u8" }),
    camera("promoted", { name: "Carcavelos", streamUrl: "https://example.com/shared.m3u8" }),
    camera("distinct", { streamUrl: "https://example.com/distinct.m3u8" })
  ]);

  assert.deepEqual(ids(catalog), ["native", "distinct"]);
});

test("uniquePlayableCameras prefers the saved alias for a duplicate feed", () => {
  const cameras = [
    camera("native", { streamUrl: "https://example.com/shared.m3u8" }),
    camera("promoted", { streamUrl: "https://example.com/shared.m3u8" })
  ];

  assert.deepEqual(uniquePlayableCameras(cameras, new Set(["promoted"])).map(({ id }) => id), ["promoted"]);
});

test("playableFavoriteCatalog marks a feed saved when any duplicate alias is saved", () => {
  const catalog = playableFavoriteCatalog([
    camera("native", { streamUrl: "https://example.com/shared.m3u8" }),
    camera("promoted", { streamUrl: "https://example.com/shared.m3u8" })
  ], new Set(["promoted"]));

  assert.deepEqual(catalog.map(({ camera: item, saved }) => [item.id, saved]), [["promoted", true]]);
});

test("addFavorite replaces saved feed aliases with the catalog representative", () => {
  const catalog = playableFavoriteCatalog([
    camera("native", { streamUrl: "https://example.com/shared.m3u8" }),
    camera("promoted", { streamUrl: "https://example.com/shared.m3u8" })
  ]);

  assert.deepEqual([...addFavorite(new Set(["promoted"]), "native", catalog)], ["native"]);
});

test("favoriteFeedRecord resolves any playable alias to the shared saved feed", () => {
  const cameras = [
    camera("native", { streamUrl: "https://example.com/shared.m3u8" }),
    camera("promoted", { streamUrl: "https://example.com/shared.m3u8" })
  ];
  const catalog = playableFavoriteCatalog(cameras, new Set(["native"]));

  assert.deepEqual(favoriteFeedRecord(catalog, cameras[1]), catalog[0]);
  assert.equal(favoriteFeedRecord(catalog, camera("missing")), null);
});

test("searchFavoriteCatalog folds accents so Sao Juliao matches São Julião", () => {
  const catalog = playableFavoriteCatalog([
    camera("sao-juliao", { name: "São Julião" }),
    camera("carcavelos", { name: "Carcavelos" })
  ]);

  assert.deepEqual(ids(searchFavoriteCatalog(catalog, { query: "Sao Juliao" })), ["sao-juliao"]);
});

test("searchFavoriteCatalog matches name, location, and region case-insensitively", () => {
  const catalog = playableFavoriteCatalog([
    camera("fixture", {
      name: "Praia da Rainha",
      location: "CASCAIS",
      region: "Grande Lisboa"
    })
  ]);

  assert.deepEqual(ids(searchFavoriteCatalog(catalog, { query: "PRAIA" })), ["fixture"]);
  assert.deepEqual(ids(searchFavoriteCatalog(catalog, { query: "cAsCaIs" })), ["fixture"]);
  assert.deepEqual(ids(searchFavoriteCatalog(catalog, { query: "LISBOA" })), ["fixture"]);
});

test("searchFavoriteCatalog does not index missing fields as undefined or null", () => {
  const catalog = playableFavoriteCatalog([
    camera("fixture", { name: "Fixture", location: undefined, region: null })
  ]);

  assert.deepEqual(
    ["undefined", "null"].map((query) => ids(searchFavoriteCatalog(catalog, { query }))),
    [[], []]
  );
});

test("searchFavoriteCatalog composes query, region, and provider filters", () => {
  const catalog = playableFavoriteCatalog([
    camera("match", { name: "Praia Norte", region: "lisboa", streamSource: "meo" }),
    camera("wrong-provider", { name: "Praia Sul", region: "lisboa", streamSource: "surfline-raw" }),
    camera("wrong-region", { name: "Praia Centro", region: "porto", streamSource: "meo" }),
    camera("wrong-query", { name: "Baía", region: "lisboa", streamSource: "meo" })
  ]);

  const results = searchFavoriteCatalog(catalog, {
    query: "praia",
    region: "LISBOA",
    provider: "MEO"
  });

  assert.deepEqual(ids(results), ["match"]);
});

test("catalog records expose saved state and addFavorite never duplicates IDs", () => {
  const favoriteIds = new Set(["saved"]);
  const catalog = playableFavoriteCatalog([
    camera("saved"),
    camera("available"),
    camera("not-playable", { hasStream: false })
  ], favoriteIds);

  assert.equal(searchFavoriteCatalog(catalog, { query: "saved" })[0].saved, true);

  const duplicate = addFavorite(favoriteIds, "saved", catalog);
  assert.notEqual(duplicate, favoriteIds);
  assert.deepEqual([...duplicate], ["saved"]);

  const unavailable = addFavorite(favoriteIds, "not-playable", catalog);
  assert.notEqual(unavailable, favoriteIds);
  assert.deepEqual([...unavailable], ["saved"]);

  assert.deepEqual([...addFavorite(favoriteIds, "available", catalog)], ["saved", "available"]);
});

test("searchFavoriteCatalog preserves input order when the query is empty", () => {
  const catalog = playableFavoriteCatalog([
    camera("zebra", { name: "Zebra" }),
    camera("alpha", { name: "Alpha" }),
    camera("middle", { name: "Middle" })
  ]);

  assert.deepEqual(ids(searchFavoriteCatalog(catalog)), ["zebra", "alpha", "middle"]);
});

test("query results sort exact normalized names before partials, then by base-sensitive name", () => {
  const catalog = playableFavoriteCatalog([
    camera("zebra", { name: "Zebra Reef" }),
    camera("exact", { name: "REEF" }),
    camera("alpha", { name: "alpha reef" })
  ]);

  assert.deepEqual(
    ids(searchFavoriteCatalog(catalog, { query: "reef" })),
    ["exact", "alpha", "zebra"]
  );
});
