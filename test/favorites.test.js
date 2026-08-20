import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS, FAVORITE_STORAGE_KEY } from "../src/config.js";
import {
  buildFavoriteIdAliases,
  canonicalFavoriteId,
  commitFavoriteMutation,
  createFavoriteUndo,
  defaultFavoriteSet,
  loadFavoriteIds,
  saveFavoriteIds
} from "../src/favorites.js";
import {
  MEO_CAMERA_ID_RENAMES,
  MEO_FAVORITE_ID_REPLACEMENTS,
  RETIRED_MEO_CAMERA_IDS
} from "../src/meo-camera-identities.js";

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
  assert.equal(favorites.has("surfline-castelo"), false);
});

test("MEO identity changes stay namespaced and preserve Surfline intelligence IDs", () => {
  assert.deepEqual(MEO_CAMERA_ID_RENAMES, {
    "espinho-silvade": "espinho-silvalde",
    espinhosilvadeestatica: "espinhosilvaldeestatica"
  });
  assert.deepEqual(RETIRED_MEO_CAMERA_IDS, ["surfline-castelo"]);
  assert.deepEqual(MEO_FAVORITE_ID_REPLACEMENTS, {
    "espinho-silvade": "espinho-silvalde",
    espinhosilvadeestatica: "espinhosilvaldeestatica",
    "surfline-castelo": "costa-da-caparica-riviera"
  });
});

test("favorite aliases combine promoted links and static MEO identity replacements", () => {
  const aliases = buildFavoriteIdAliases(
    {
      promoted: [
        {
          id: "surfline-alpha",
          linkedCamId: "cam-alpha",
          stretchCamIds: ["cam-stretch-ignored"]
        },
        {
          id: "surfline-stretch",
          linkedCamId: "",
          stretchCamIds: [null, "", "cam-stretch", "cam-stretch-later"]
        },
        { id: "surfline-unlinked", stretchCamIds: [null, " ", 42] },
        { id: "", linkedCamId: "cam-invalid" }
      ]
    },
    MEO_FAVORITE_ID_REPLACEMENTS
  );

  assert.equal(aliases.get("surfline-alpha"), "cam-alpha");
  assert.equal(aliases.get("surfline-stretch"), "cam-stretch");
  assert.equal(aliases.get("surfline-unlinked"), undefined);
  assert.equal(aliases.get("espinho-silvade"), "espinho-silvalde");
  assert.equal(aliases.get("surfline-castelo"), "costa-da-caparica-riviera");
});

test("favorite aliases tolerate malformed promotion rows and explicit replacements win", () => {
  assert.doesNotThrow(() => buildFavoriteIdAliases({ promoted: {} }));
  assert.deepEqual([...buildFavoriteIdAliases({ promoted: {} })], []);

  const aliases = buildFavoriteIdAliases(
    { promoted: [{ id: "surfline-castelo", linkedCamId: "wrong-camera" }] },
    MEO_FAVORITE_ID_REPLACEMENTS
  );

  assert.equal(aliases.get("surfline-castelo"), "costa-da-caparica-riviera");
});

test("favorite canonicalization is exact, one-hop, and lets an available native ID win", () => {
  const aliases = new Map([
    ["old-id", "middle-id"],
    ["middle-id", "new-id"]
  ]);

  assert.equal(canonicalFavoriteId("old-id", new Set(["middle-id", "new-id"]), aliases), "middle-id");
  assert.equal(canonicalFavoriteId("old-id", new Set(["new-id"]), aliases), null);
  assert.equal(canonicalFavoriteId("middle-id", new Set(["middle-id", "new-id"]), aliases), "middle-id");
  assert.equal(canonicalFavoriteId("OLD-ID", new Set(["middle-id"]), aliases), null);
});

test("stored favorites are loaded and unavailable IDs are ignored", () => {
  const storage = storageWith(JSON.stringify(["praia-de-carcavelos", "missing-camera"]));
  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], ["praia-de-carcavelos"]);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.value(), JSON.stringify(["praia-de-carcavelos"]));
});

test("stored promoted and provider-renamed favorites migrate before availability filtering", () => {
  const migratedCameras = [
    { id: "cam-alpha" },
    { id: "cam-stretch" },
    { id: "espinho-silvalde" }
  ];
  const storage = storageWith(JSON.stringify([
    "surfline-alpha",
    "surfline-stretch",
    "surfline-unavailable",
    "espinho-silvade"
  ]));
  const aliases = buildFavoriteIdAliases(
    {
      promoted: [
        { id: "surfline-alpha", linkedCamId: "cam-alpha" },
        { id: "surfline-stretch", stretchCamIds: ["cam-stretch"] },
        { id: "surfline-unavailable", stretchCamIds: ["missing-camera"] }
      ]
    },
    MEO_FAVORITE_ID_REPLACEMENTS
  );

  const favorites = loadFavoriteIds(migratedCameras, storage, aliases);

  assert.deepEqual([...favorites], ["cam-alpha", "cam-stretch", "espinho-silvalde"]);
  assert.equal(storage.value(), JSON.stringify(["cam-alpha", "cam-stretch", "espinho-silvalde"]));
});

test("alias and native duplicates collapse in original order and persist once", () => {
  const storage = storageWith(JSON.stringify(["surfline-alpha", "cam-alpha", "cam-beta"]));
  const aliases = new Map([["surfline-alpha", "cam-alpha"]]);

  const favorites = loadFavoriteIds([{ id: "cam-alpha" }, { id: "cam-beta" }], storage, aliases);

  assert.deepEqual([...favorites], ["cam-alpha", "cam-beta"]);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.value(), JSON.stringify(["cam-alpha", "cam-beta"]));
});

test("an unavailable alias target is dropped without following another alias", () => {
  const storage = storageWith(JSON.stringify(["old-id"]));
  const aliases = new Map([
    ["old-id", "middle-id"],
    ["middle-id", "new-id"]
  ]);

  const favorites = loadFavoriteIds([{ id: "new-id" }], storage, aliases);

  assert.deepEqual([...favorites], []);
  assert.equal(storage.value(), JSON.stringify([]));
});

test("an available native ID is not displaced by an alias with the same source", () => {
  const storage = storageWith(JSON.stringify(["native-id"]));
  const aliases = new Map([["native-id", "replacement-id"]]);

  const favorites = loadFavoriteIds(
    [{ id: "native-id" }, { id: "replacement-id" }],
    storage,
    aliases
  );

  assert.deepEqual([...favorites], ["native-id"]);
  assert.equal(storage.writes.length, 0);
});

test("unchanged stored favorites are not rewritten", () => {
  const storage = storageWith(JSON.stringify(["praia-de-carcavelos"]));

  const favorites = loadFavoriteIds(cameras, storage, new Map());

  assert.deepEqual([...favorites], ["praia-de-carcavelos"]);
  assert.equal(storage.writes.length, 0);
});

test("missing storage key returns defaults without writing", () => {
  const storage = storageWith();

  const favorites = loadFavoriteIds(cameras, storage, new Map());

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
  assert.equal(storage.writes.length, 0);
});

test("a stored empty favorites list remains intentionally empty without writing", () => {
  const storage = storageWith(JSON.stringify([]));

  const favorites = loadFavoriteIds(cameras, storage, new Map());

  assert.deepEqual([...favorites], []);
  assert.equal(storage.writes.length, 0);
});

test("invalid stored favorites fall back to defaults", () => {
  const storage = storageWith("{not valid json");
  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
  assert.equal(storage.writes.length, 0);
});

test("unavailable storage falls back to default favorites", () => {
  let writes = 0;
  const storage = {
    getItem() {
      const error = new Error("Access to storage is denied");
      error.name = "SecurityError";
      throw error;
    },
    setItem() {
      writes += 1;
    }
  };

  const favorites = loadFavoriteIds(cameras, storage);

  assert.deepEqual([...favorites], DEFAULT_FAVORITE_IDS);
  assert.equal(writes, 0);
});

test("favorite migration is best-effort when storage writes fail", () => {
  const storage = {
    getItem() {
      return JSON.stringify(["surfline-alpha"]);
    },
    setItem() {
      throw new Error("quota exceeded");
    }
  };

  const favorites = loadFavoriteIds(
    [{ id: "cam-alpha" }],
    storage,
    new Map([["surfline-alpha", "cam-alpha"]])
  );

  assert.deepEqual([...favorites], ["cam-alpha"]);
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
