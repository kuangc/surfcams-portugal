import assert from "node:assert/strict";
import test from "node:test";

import {
  addComparisonCamera,
  createMonitorViewState,
  exitMonitorFocus,
  openMonitorFocus,
  removeComparisonCamera,
  replaceFocusedCamera
} from "../src/monitor-view.js";

test("gallery opens one-camera Focus without mutating its prior state", () => {
  const gallery = createMonitorViewState();

  assert.deepEqual(gallery, {
    view: "gallery",
    focusedCameraIds: [],
    galleryScrollY: 0,
    originCameraId: null
  });

  const focused = openMonitorFocus(gallery, "cam-one", {
    scrollY: 384,
    originCameraId: "cam-one"
  });

  assert.deepEqual(focused, {
    view: "focus-one",
    focusedCameraIds: ["cam-one"],
    galleryScrollY: 384,
    originCameraId: "cam-one"
  });
  assert.deepEqual(gallery, createMonitorViewState());
  assert.notStrictEqual(focused, gallery);
});

test("adding one distinct comparison camera produces exactly two panes", () => {
  const focused = openMonitorFocus(createMonitorViewState(), "cam-one", {
    scrollY: 0,
    originCameraId: "cam-one"
  });

  const compared = addComparisonCamera(focused, "cam-two");

  assert.deepEqual(compared, {
    ...focused,
    view: "compare-two",
    focusedCameraIds: ["cam-one", "cam-two"]
  });
  assert.strictEqual(addComparisonCamera(compared, "cam-three"), compared);
});

test("duplicate and blank camera IDs leave Focus transitions unchanged", () => {
  const focused = openMonitorFocus(createMonitorViewState(), "cam-one", {
    scrollY: 0,
    originCameraId: "cam-one"
  });

  assert.strictEqual(addComparisonCamera(focused, "cam-one"), focused);
  assert.strictEqual(addComparisonCamera(focused, ""), focused);
  assert.strictEqual(addComparisonCamera(focused, "   "), focused);
  assert.strictEqual(replaceFocusedCamera(focused, 0, ""), focused);
});

test("pane-local replacement preserves order and rejects duplicates", () => {
  const compared = addComparisonCamera(
    openMonitorFocus(createMonitorViewState(), "cam-one", {
      scrollY: 11,
      originCameraId: "origin"
    }),
    "cam-two"
  );

  const replacedLeft = replaceFocusedCamera(compared, 0, "cam-three");
  const replacedRight = replaceFocusedCamera(replacedLeft, 1, "cam-four");

  assert.deepEqual(replacedLeft.focusedCameraIds, ["cam-three", "cam-two"]);
  assert.deepEqual(replacedRight.focusedCameraIds, ["cam-three", "cam-four"]);
  assert.equal(replacedRight.view, "compare-two");
  assert.deepEqual(compared.focusedCameraIds, ["cam-one", "cam-two"]);
  assert.strictEqual(replaceFocusedCamera(compared, 0, "cam-two"), compared);
  assert.strictEqual(replaceFocusedCamera(compared, 2, "cam-three"), compared);
});

test("removing either comparison pane returns Focus with the remaining camera", () => {
  const compared = addComparisonCamera(
    openMonitorFocus(createMonitorViewState(), "cam-one", {
      scrollY: 25,
      originCameraId: "cam-one"
    }),
    "cam-two"
  );

  assert.deepEqual(removeComparisonCamera(compared, 0), {
    ...compared,
    view: "focus-one",
    focusedCameraIds: ["cam-two"]
  });
  assert.deepEqual(removeComparisonCamera(compared, 1), {
    ...compared,
    view: "focus-one",
    focusedCameraIds: ["cam-one"]
  });
  assert.strictEqual(removeComparisonCamera(compared, -1), compared);
});

test("exit returns gallery while preserving restoration metadata", () => {
  const focused = openMonitorFocus(createMonitorViewState(), "cam-one", {
    scrollY: 912,
    originCameraId: "origin-camera"
  });

  const gallery = exitMonitorFocus(focused);

  assert.deepEqual(gallery, {
    view: "gallery",
    focusedCameraIds: [],
    galleryScrollY: 912,
    originCameraId: "origin-camera"
  });
  assert.deepEqual(focused.focusedCameraIds, ["cam-one"]);
});
