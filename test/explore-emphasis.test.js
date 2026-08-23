import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import * as exploreEmphasis from "../src/explore-emphasis.js";
import {
  createExploreViewState,
  expandExploreMap,
  initializeExploreSelection,
  openSelectedExploreSpot,
  selectExploreSpot
} from "../src/explore-emphasis.js";

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

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

test("cancelling a deferred Explore refresh invalidates only the queued work", () => {
  assert.equal(typeof exploreEmphasis.createExploreRefreshScheduler, "function");

  const deferred = [];
  const refreshes = [];
  const scheduler = exploreEmphasis.createExploreRefreshScheduler({
    defer: (callback) => deferred.push(callback)
  });

  assert.equal(scheduler.schedule(() => refreshes.push("stale")), true);
  scheduler.cancel();
  deferred.shift()();
  assert.deepEqual(refreshes, []);

  assert.equal(scheduler.schedule(() => refreshes.push("fresh")), true);
  deferred.shift()();
  assert.deepEqual(refreshes, ["fresh"]);
});

test("suspended Explore refreshes are neither queued nor delivered", () => {
  const deferred = [];
  const refreshes = [];
  let suspended = true;
  const scheduler = exploreEmphasis.createExploreRefreshScheduler({
    defer: (callback) => deferred.push(callback),
    isSuspended: () => suspended
  });

  assert.equal(scheduler.schedule(() => refreshes.push("queued while suspended")), false);
  assert.equal(deferred.length, 0);

  suspended = false;
  assert.equal(scheduler.schedule(() => refreshes.push("delivered while suspended")), true);
  suspended = true;
  deferred.shift()();
  assert.deepEqual(refreshes, []);
});

test("the main controller cancels and requeues Explore-map refreshes across page suspension", () => {
  const setRouteSource = mainSource.match(
    /function setRoute\(route\)[\s\S]*?\n}\n\nfunction favoriteOrder/
  )?.[0] || "";
  const pagehideSource = mainSource.match(
    /window\.addEventListener\("pagehide"[\s\S]*?\n  }\);/
  )?.[0] || "";
  const pageshowSource = mainSource.match(
    /window\.addEventListener\("pageshow"[\s\S]*?\n  }\);/
  )?.[0] || "";
  const visibilitySource = mainSource.match(
    /document\.addEventListener\("visibilitychange"[\s\S]*?\n  }\);/
  )?.[0] || "";

  assert.match(mainSource, /createExploreRefreshScheduler/);
  assert.match(
    mainSource,
    /createExploreRefreshScheduler\(\{[\s\S]*?defer:\s*afterNextPaint[\s\S]*?isSuspended:/
  );
  assert.match(
    mainSource,
    /function scheduleExploreMapRefresh\(\{\s*fit\s*=\s*false,\s*replaySelected\s*=\s*true,\s*recenterSelected\s*=\s*true\s*}\s*=\s*{}\)[\s\S]*?exploreRefreshScheduler\.schedule[\s\S]*?refreshExploreMap\(\{\s*fit,\s*replaySelected,\s*recenterSelected\s*}\)/
  );
  assert.match(
    mainSource,
    /function refreshExploreMap\(\{\s*fit\s*=\s*false,\s*replaySelected\s*=\s*true,\s*recenterSelected\s*=\s*true\s*}\s*=\s*{}\)[\s\S]*?recenterSelected\s*&&[\s\S]*?if\s*\(replaySelected\s*&&\s*state\.selectedExploreCamera\)/
  );
  assert.match(
    setRouteSource,
    /scheduleExploreMapRefresh\(\{\s*fit:\s*!state\.mapHasInitialFit\s*}\)/
  );
  assert.doesNotMatch(
    setRouteSource,
    /afterNextPaint\(\(\)\s*=>\s*{[\s\S]*?refreshExploreMap/
  );
  assert.match(pagehideSource, /exploreRefreshScheduler\.cancel\(\)/);
  assert.match(pageshowSource, /exploreRefreshScheduler\.cancel\(\)/);
  assert.match(
    pageshowSource,
    /scheduleExploreMapRefresh\(\{[\s\S]*?fit:\s*!state\.mapHasInitialFit,[\s\S]*?replaySelected:\s*false,[\s\S]*?recenterSelected:\s*false[\s\S]*?}\)/
  );
  assert.match(visibilitySource, /exploreRefreshScheduler\.cancel\(\)/);
  assert.match(
    visibilitySource,
    /scheduleExploreMapRefresh\(\{[\s\S]*?fit:\s*!state\.mapHasInitialFit,[\s\S]*?replaySelected:\s*false,[\s\S]*?recenterSelected:\s*false[\s\S]*?}\)/
  );
});
