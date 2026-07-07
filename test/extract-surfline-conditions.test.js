import test from "node:test";
import assert from "node:assert/strict";
import * as conditionsModule from "../scripts/extract-surfline-conditions.js";

const { shouldReplace, passesValidityFloor, parseCliArgs } = conditionsModule;

test("shouldReplace: same-kind newer records win for primary and nearby", () => {
  assert.equal(conditionsModule.NEARBY_FRESHNESS_OVERRIDE_HOURS, 6);

  const cases = [
    {
      name: "same-kind primary newer wins",
      existing: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "primary", fetchedAt: "2026-07-06T09:00:00Z" },
      expected: true
    },
    {
      name: "same-kind nearby newer wins",
      existing: { sourceKind: "nearby", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" },
      expected: true
    }
  ];

  for (const { name, existing, candidate, expected } of cases) {
    assert.equal(shouldReplace(existing, candidate), expected, name);
  }
});

test("shouldReplace: same-kind invalid dates do not win", () => {
  const cases = [
    {
      name: "same-kind invalid candidate date does not win",
      existing: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "primary", fetchedAt: "not-a-date" },
      expected: false
    },
    {
      name: "same-kind invalid existing date does not win",
      existing: { sourceKind: "primary", fetchedAt: "not-a-date" },
      candidate: { sourceKind: "primary", fetchedAt: "2026-07-06T09:00:00Z" },
      expected: false
    }
  ];

  for (const { name, existing, candidate, expected } of cases) {
    assert.equal(shouldReplace(existing, candidate), expected, name);
  }
});

test("shouldReplace: primary candidate beats nearby existing at comparable freshness only", () => {
  const cases = [
    {
      name: "primary candidate beats slightly newer nearby (within override window)",
      existing: { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" },
      candidate: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      expected: true
    },
    {
      name: "stale primary does not displace nearby fresher by more than the override window",
      existing: { sourceKind: "nearby", fetchedAt: "2026-07-06T13:00:01Z" },
      candidate: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      expected: false
    },
    {
      name: "weeks-stale primary never displaces a fresh nearby (order independence)",
      existing: { sourceKind: "nearby", fetchedAt: "2026-07-07T12:00:00Z" },
      candidate: { sourceKind: "primary", fetchedAt: "2026-06-11T12:00:00Z" },
      expected: false
    },
    {
      name: "primary with invalid fetchedAt keeps legacy preference",
      existing: { sourceKind: "nearby", fetchedAt: "2026-07-06T09:00:00Z" },
      candidate: { sourceKind: "primary", fetchedAt: "not-a-date" },
      expected: true
    }
  ];

  for (const { name, existing, candidate, expected } of cases) {
    assert.equal(shouldReplace(existing, candidate), expected, name);
  }
});

test("shouldReplace: nearby candidate needs more than six hours freshness over primary", () => {
  const cases = [
    {
      name: "nearby candidate five hours newer than primary is kept out",
      existing: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "nearby", fetchedAt: "2026-07-06T11:00:00Z" },
      expected: false
    },
    {
      name: "nearby candidate seven hours newer than primary wins",
      existing: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "nearby", fetchedAt: "2026-07-06T13:00:00Z" },
      expected: true
    },
    {
      name: "nearby candidate missing fetchedAt does not beat primary",
      existing: { sourceKind: "primary", fetchedAt: "2026-07-06T06:00:00Z" },
      candidate: { sourceKind: "nearby" },
      expected: false
    }
  ];

  for (const { name, existing, candidate, expected } of cases) {
    assert.equal(shouldReplace(existing, candidate), expected, name);
  }
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
