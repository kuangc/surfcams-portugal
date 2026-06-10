import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "../src/config.js";
import { defaultFavoriteSet, loadFavoriteIds, saveFavoriteIds } from "../src/favorites.js";

function storageWith(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set(FAVORITE_STORAGE_KEY, initialValue);

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    value(key = FAVORITE_STORAGE_KEY) {
      return values.get(key);
    }
  };
}

const cameras = [
  ...DEFAULT_FAVORITE_IDS.map((id) => ({ id })),
  { id: "praia-de-carcavelos" }
];

test("default favorites include the requested Peniche Lagide camera", () => {
  const availableIds = new Set(cameras.map((camera) => camera.id));
  const favorites = defaultFavoriteSet(availableIds);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
  assert.ok(favorites.has("lagide-e-baia"));
});

test("stored favorites are loaded and unavailable IDs are ignored", () => {
  const storage = storageWith(JSON.stringify(["praia-de-carcavelos", "missing-camera"]));
  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], ["praia-de-carcavelos"]);
});

test("invalid stored favorites fall back to defaults", () => {
  const storage = storageWith("{not valid json");
  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
});

test("favorites save under the current versioned storage key", () => {
  const storage = storageWith();

  saveFavoriteIds(new Set(["lagide-e-baia"]), storage);

  assert.equal(storage.value(), JSON.stringify(["lagide-e-baia"]));
  assert.equal(FAVORITE_STORAGE_KEY, "surfcamFavoriteIds:v3");
});
