import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "../src/config.js";
import {
  commitFavoriteMutation,
  createFavoriteUndo,
  defaultFavoriteSet,
  loadFavoriteIds,
  saveFavoriteIds
} from "../src/favorites.js";

function storageWith(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set(FAVORITE_STORAGE_KEY, initialValue);
  const writes = [];

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    value(key = FAVORITE_STORAGE_KEY) {
      return values.get(key);
    },
    writes
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

test("stored Espinho favorites migrate to available corrected IDs and persist", () => {
  const storage = storageWith(JSON.stringify([
    "espinho-silvade",
    "praia-de-carcavelos",
    "espinhosilvadeestatica"
  ]));
  const migratedCameras = [
    { id: "espinho-silvalde" },
    { id: "praia-de-carcavelos" },
    { id: "espinhosilvaldeestatica" }
  ];

  const favorites = loadFavoriteIds(migratedCameras, storage);

  assert.deepEqual([...favorites], [
    "espinho-silvalde",
    "praia-de-carcavelos",
    "espinhosilvaldeestatica"
  ]);
  assert.deepEqual(storage.writes, [[
    FAVORITE_STORAGE_KEY,
    JSON.stringify([
      "espinho-silvalde",
      "praia-de-carcavelos",
      "espinhosilvaldeestatica"
    ])
  ]]);
});

test("an Espinho favorite remains migrated when the storage rewrite fails", () => {
  const storage = {
    getItem() {
      return JSON.stringify(["espinho-silvade"]);
    },
    setItem() {
      throw new Error("storage quota exceeded");
    }
  };

  const favorites = loadFavoriteIds([{ id: "espinho-silvalde" }], storage);

  assert.deepEqual([...favorites], ["espinho-silvalde"]);
});

test("migrated and already-correct Espinho favorites collapse without changing order", () => {
  const storage = storageWith(JSON.stringify([
    "espinho-silvade",
    "espinho-silvalde",
    "espinhosilvadeestatica",
    "espinhosilvaldeestatica"
  ]));
  const migratedCameras = [
    { id: "espinho-silvalde" },
    { id: "espinhosilvaldeestatica" }
  ];

  const favorites = loadFavoriteIds(migratedCameras, storage);

  assert.deepEqual([...favorites], ["espinho-silvalde", "espinhosilvaldeestatica"]);
  assert.equal(
    storage.value(),
    JSON.stringify(["espinho-silvalde", "espinhosilvaldeestatica"])
  );
});

test("an available legacy Espinho ID remains native until the catalog is renamed", () => {
  const storage = storageWith(JSON.stringify(["espinho-silvade"]));

  const favorites = loadFavoriteIds([
    { id: "espinho-silvade" },
    { id: "espinho-silvalde" }
  ], storage);

  assert.deepEqual([...favorites], ["espinho-silvade"]);
  assert.equal(storage.writes.length, 0);
});

test("invalid stored favorites fall back to defaults", () => {
  const storage = storageWith("{not valid json");
  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
});

test("unavailable storage falls back to default favorites", () => {
  const storage = {
    getItem() {
      const error = new Error("Access to storage is denied");
      error.name = "SecurityError";
      throw error;
    }
  };

  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
});

test("unavailable default localStorage falls back to default favorites", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const testWindow = {};
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    get() {
      const error = new Error("Access to localStorage is denied");
      error.name = "SecurityError";
      throw error;
    }
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: testWindow
  });

  try {
    const favorites = loadFavoriteIds(cameras);

    assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test("favorites save under the current versioned storage key", () => {
  const storage = storageWith();

  saveFavoriteIds(new Set(["lagide-e-baia"]), storage);

  assert.equal(storage.value(), JSON.stringify(["lagide-e-baia"]));
  assert.equal(FAVORITE_STORAGE_KEY, "surfcamFavoriteIds:v3");
});

function timerHarness() {
  const timers = new Map();
  const cleared = [];
  let nextId = 1;

  return {
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      timers.delete(id);
    },
    fire(id) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} exists`);
      timers.delete(id);
      timer.callback();
    },
    timers,
    cleared
  };
}

test("favorite undo keeps one removed camera and can be consumed only once", () => {
  const timers = timerHarness();
  const undo = createFavoriteUndo({
    durationMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const removedCamera = { id: "lagide-e-baia", name: "Lagide" };

  undo.offer(removedCamera);

  assert.equal(undo.consume(), removedCamera);
  assert.equal(undo.consume(), null);
  assert.deepEqual(timers.cleared, [1]);
});

test("favorite undo expires at exactly ten seconds and notifies once", () => {
  const timers = timerHarness();
  const expired = [];
  const undo = createFavoriteUndo({
    durationMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onExpire: (camera) => expired.push(camera)
  });
  const removedCamera = { id: "carcavelos", name: "Carcavelos" };

  undo.offer(removedCamera);
  assert.equal(timers.timers.get(1).delay, 10_000);
  assert.deepEqual(expired, []);

  timers.fire(1);

  assert.deepEqual(expired, [removedCamera]);
  assert.equal(undo.consume(), null);
});

test("offering another favorite undo cancels the previous timer and offer", () => {
  const timers = timerHarness();
  const undo = createFavoriteUndo({
    durationMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const first = { id: "first" };
  const second = { id: "second" };

  undo.offer(first);
  undo.offer(second);

  assert.deepEqual(timers.cleared, [1]);
  assert.equal(timers.timers.has(1), false);
  assert.equal(undo.consume(), second);
});

test("favorite undo cleanup cancels the pending timer and offer", () => {
  const timers = timerHarness();
  const undo = createFavoriteUndo({
    durationMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  undo.offer({ id: "lagide-e-baia" });
  undo.cleanup();

  assert.deepEqual(timers.cleared, [1]);
  assert.equal(undo.consume(), null);
});

test("favorite undo preserves a focus-restoration callback until consume or expiry", () => {
  const timers = timerHarness();
  const restored = [];
  const undo = createFavoriteUndo({
    durationMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const camera = { id: "lagide-e-baia" };
  const restoreFocus = (settledCamera) => restored.push(settledCamera);

  undo.offer(camera, restoreFocus);
  assert.deepEqual(undo.consumeOffer(), { camera, restoreFocus });

  undo.offer(camera, restoreFocus);
  timers.fire(2);
  assert.deepEqual(restored, [camera]);
});

test("commitFavoriteMutation clones, mutates, persists, and returns the clone", () => {
  const current = new Set(["lagide-e-baia", "carcavelos"]);
  const storage = storageWith();

  const next = commitFavoriteMutation(current, (nextFavoriteIds) => {
    nextFavoriteIds.delete("carcavelos");
  }, storage);

  assert.notEqual(next, current);
  assert.deepEqual([...next], ["lagide-e-baia"]);
  assert.deepEqual([...current], ["lagide-e-baia", "carcavelos"]);
  assert.equal(storage.value(), JSON.stringify(["lagide-e-baia"]));
});

test("commitFavoriteMutation propagates persistence failure without changing its input", () => {
  const current = new Set(["lagide-e-baia"]);
  const storage = {
    setItem() {
      throw new Error("storage unavailable");
    }
  };

  assert.throws(() => {
    commitFavoriteMutation(current, (nextFavoriteIds) => {
      nextFavoriteIds.delete("lagide-e-baia");
      nextFavoriteIds.add("carcavelos");
    }, storage);
  }, /storage unavailable/);
  assert.deepEqual([...current], ["lagide-e-baia"]);
});
