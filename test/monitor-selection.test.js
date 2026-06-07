import assert from "node:assert/strict";
import test from "node:test";

import { createMonitorSelection } from "../src/monitor-selection.js";

test("createMonitorSelection toggles selected ids in insertion order", () => {
  const selection = createMonitorSelection(6);

  assert.deepEqual(selection.selectedIds(), []);
  assert.equal(selection.toggle("a").added, true);
  assert.equal(selection.toggle("b").added, true);
  assert.equal(selection.toggle("a").added, false);

  assert.deepEqual(selection.selectedIds(), ["b"]);
  assert.equal(selection.has("a"), false);
  assert.equal(selection.has("b"), true);
  assert.equal(selection.count(), 1);
});

test("createMonitorSelection caps selection at the configured max", () => {
  const selection = createMonitorSelection(3);

  assert.equal(selection.toggle("a").added, true);
  assert.equal(selection.toggle("b").added, true);
  assert.equal(selection.toggle("c").added, true);
  assert.deepEqual(selection.toggle("d"), {
    added: false,
    removed: false,
    rejected: true,
    reason: "limit"
  });
  assert.deepEqual(selection.selectedIds(), ["a", "b", "c"]);
  assert.equal(selection.isFull(), true);
});

test("createMonitorSelection removes and clears ids", () => {
  const selection = createMonitorSelection(6);

  selection.toggle("a");
  selection.toggle("b");
  selection.remove("a");
  assert.deepEqual(selection.selectedIds(), ["b"]);

  selection.clear();
  assert.deepEqual(selection.selectedIds(), []);
  assert.equal(selection.isFull(), false);
});

test("createMonitorSelection ignores duplicate adds", () => {
  const selection = createMonitorSelection(6);

  assert.equal(selection.add("a").added, true);
  assert.equal(selection.add("a").added, false);
  assert.deepEqual(selection.selectedIds(), ["a"]);
});
