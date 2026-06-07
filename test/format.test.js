import assert from "node:assert/strict";
import test from "node:test";

import { formatTideState } from "../src/format.js";

test("formatTideState translates Beachcam tide states to English", () => {
  assert.equal(formatTideState("Baixa-mar"), "Low tide");
  assert.equal(formatTideState("Preia-mar"), "High tide");
  assert.equal(formatTideState("Preamar"), "High tide");
});

test("formatTideState preserves unknown tide labels", () => {
  assert.equal(formatTideState("Meia-maré"), "Meia-maré");
  assert.equal(formatTideState(""), "");
});
