import test from "node:test";
import assert from "node:assert/strict";
import { shouldReplace, passesValidityFloor, parseCliArgs } from "../scripts/extract-surfline-conditions.js";

test("shouldReplace: primary always beats nearby, regardless of age", () => {
  const existingNearbyNewer = { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" };
  const candidatePrimaryOlder = { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" };
  assert.equal(shouldReplace(existingNearbyNewer, candidatePrimaryOlder), true);
});

test("shouldReplace: nearby never displaces an existing primary, even when newer", () => {
  const existingPrimaryOlder = { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" };
  const candidateNearbyNewer = { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" };
  assert.equal(shouldReplace(existingPrimaryOlder, candidateNearbyNewer), false);
});

test("shouldReplace: same kind, newer wins (primary vs primary)", () => {
  const existingPrimaryOlder = { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" };
  const candidatePrimaryNewer = { sourceKind: "primary", fetchedAt: "2026-07-06T09:00:00Z" };
  assert.equal(shouldReplace(existingPrimaryOlder, candidatePrimaryNewer), true);
});

test("shouldReplace: same kind, newer wins (nearby vs nearby)", () => {
  const existingNearbyOlder = { sourceKind: "nearby", fetchedAt: "2026-07-06T06:00:00Z" };
  const candidateNearbyNewer = { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" };
  assert.equal(shouldReplace(existingNearbyOlder, candidateNearbyNewer), true);
});

test("passesValidityFloor: 8/10 pages parsed with conditions passes", () => {
  assert.equal(passesValidityFloor(8, 10, 5), true);
});

test("passesValidityFloor: 4/10 pages parsed fails the ratio floor", () => {
  assert.equal(passesValidityFloor(4, 10, 5), false);
});

test("passesValidityFloor: zero conditions fails even with all pages parsed", () => {
  assert.equal(passesValidityFloor(10, 10, 0), false);
});

test("parseCliArgs: forms, dangling values, unknown flags", () => {
  assert.deepEqual(parseCliArgs(["--out=/tmp/x.json"]).values, { "--out": "/tmp/x.json" });
  assert.deepEqual(parseCliArgs(["--out", "/tmp/x.json"]).values, { "--out": "/tmp/x.json" });
  assert.deepEqual(parseCliArgs(["--out"]).errors, ["Missing value for --out"]);
  assert.deepEqual(parseCliArgs(["--out="]).errors, ["Missing value for --out"]);
  const swallowed = parseCliArgs(["--cache-dir", "--out", "/tmp/x.json"]);
  assert.ok(swallowed.errors.includes("Missing value for --cache-dir"));
  assert.deepEqual(swallowed.values, { "--out": "/tmp/x.json" });
  assert.deepEqual(parseCliArgs(["--bogus", "x"]).errors, ["Unknown argument: --bogus", "Unexpected argument: x"]);
});
