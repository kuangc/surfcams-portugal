import assert from "node:assert/strict";
import test from "node:test";

import * as exploreEmphasis from "../src/explore-emphasis.js";
import {
  createExploreViewState,
  expandExploreMap,
  initializeExploreSelection,
  openSelectedExploreSpot,
  selectExploreSpot
} from "../src/explore-emphasis.js";

test("initial selection keeps map emphasis and does not mutate the empty state", () => {
  const empty = createExploreViewState();

  assert.deepEqual(empty, {
    emphasis: "map",
    selectedCameraId: null
  });

  const initialized = initializeExploreSelection(empty, "carcavelos");

  assert.deepEqual(initialized, {
    emphasis: "map",
    selectedCameraId: "carcavelos"
  });
  assert.deepEqual(empty, createExploreViewState());
  assert.notStrictEqual(initialized, empty);
});

test("explicit marker or result selection promotes the selected spot to detail", () => {
  const initialized = initializeExploreSelection(createExploreViewState(), "carcavelos");

  const selected = selectExploreSpot(initialized, "guincho", { explicit: true });

  assert.deepEqual(selected, {
    emphasis: "detail",
    selectedCameraId: "guincho"
  });
  assert.deepEqual(initialized, {
    emphasis: "map",
    selectedCameraId: "carcavelos"
  });
});

test("non-explicit selection changes the camera without promoting map emphasis", () => {
  const initialized = initializeExploreSelection(createExploreViewState(), "carcavelos");

  assert.deepEqual(selectExploreSpot(initialized, "guincho", { explicit: false }), {
    emphasis: "map",
    selectedCameraId: "guincho"
  });
});

test("nearby selection swaps cameras while detail remains primary", () => {
  const detailed = selectExploreSpot(createExploreViewState(), "carcavelos", { explicit: true });

  assert.deepEqual(selectExploreSpot(detailed, "guincho", { explicit: true }), {
    emphasis: "detail",
    selectedCameraId: "guincho"
  });
});

test("opening the initialized selection promotes it without changing the camera", () => {
  const initialized = initializeExploreSelection(createExploreViewState(), "carcavelos");

  assert.deepEqual(openSelectedExploreSpot(initialized), {
    emphasis: "detail",
    selectedCameraId: "carcavelos"
  });
});

test("expanding the map retains the selection and opaque map context", () => {
  const mapContext = { center: [38.7, -9.4], zoom: 9 };
  const detailed = {
    ...selectExploreSpot(createExploreViewState(), "carcavelos", { explicit: true }),
    mapContext
  };

  const expanded = expandExploreMap(detailed);

  assert.deepEqual(expanded, {
    emphasis: "map",
    selectedCameraId: "carcavelos",
    mapContext
  });
  assert.strictEqual(expanded.mapContext, mapContext);
  assert.strictEqual(detailed.mapContext, mapContext);
  assert.notStrictEqual(expanded, detailed);
});

test("blank IDs and missing selections leave state unchanged", () => {
  const empty = createExploreViewState();
  const initialized = initializeExploreSelection(empty, "carcavelos");

  assert.strictEqual(initializeExploreSelection(empty, ""), empty);
  assert.strictEqual(initializeExploreSelection(empty, "   "), empty);
  assert.strictEqual(selectExploreSpot(initialized, "", { explicit: true }), initialized);
  assert.strictEqual(selectExploreSpot(initialized, null, { explicit: true }), initialized);
  assert.strictEqual(openSelectedExploreSpot(empty), empty);
  assert.strictEqual(expandExploreMap(empty), empty);
});

test("deferred Explore refreshes stay cancelled while suspended and after restore", () => {
  assert.equal(typeof exploreEmphasis.createExploreRefreshScheduler, "function");

  const deferred = [];
  const refreshes = [];
  let suspended = false;
  const scheduler = exploreEmphasis.createExploreRefreshScheduler({
    defer: (callback) => deferred.push(callback),
    isSuspended: () => suspended
  });

  assert.equal(scheduler.schedule(() => refreshes.push("while-suspended")), true);
  suspended = true;
  scheduler.cancel();
  deferred.shift()();
  assert.deepEqual(refreshes, []);

  suspended = false;
  assert.equal(scheduler.schedule(() => refreshes.push("stale-after-restore")), true);
  suspended = true;
  scheduler.cancel();
  suspended = false;
  refreshes.push("restored");
  deferred.shift()();
  assert.deepEqual(refreshes, ["restored"]);

  suspended = true;
  assert.equal(scheduler.schedule(() => refreshes.push("queued-while-suspended")), false);
  assert.equal(deferred.length, 0);
});
