import test from "node:test";
import assert from "node:assert/strict";
import { waitForHydratedReport, fetchValidatedPages } from "../scripts/lib/surfline-cdp-reliability.js";

test("waitForHydratedReport waits until the Surfline report has data", async () => {
  const states = [
    { title: "Just a moment...", hasNextData: false },
    { title: "Praia da Cruz Quebrada Surf Report", hasNextData: true }
  ];
  const observed = [];
  const state = await waitForHydratedReport({
    readState: async () => states.shift(),
    sleep: async (ms) => observed.push(ms),
    maxAttempts: 2,
    intervalMs: 3000
  });
  assert.equal(state.title, "Praia da Cruz Quebrada Surf Report");
  assert.deepEqual(observed, [3000]);
});

test("waitForHydratedReport reports a blocked landing page after a bounded wait", async () => {
  await assert.rejects(
    waitForHydratedReport({
      readState: async () => ({ title: "Just a moment...", hasNextData: false }),
      sleep: async () => {},
      maxAttempts: 2,
      intervalMs: 3000
    }),
    /Surfline report did not hydrate.*Just a moment/
  );
});

test("waitForHydratedReport tolerates a transient CDP context error during navigation", async () => {
  let calls = 0;
  const state = await waitForHydratedReport({
    readState: async () => {
      calls += 1;
      if (calls === 1) throw new Error("Execution context was destroyed");
      return { title: "Surf Report", hasNextData: true };
    },
    sleep: async () => {},
    maxAttempts: 2,
    intervalMs: 3000
  });
  assert.equal(state.hasNextData, true);
});

test("fetchValidatedPages retries only the page blocked by a temporary 403", async () => {
  const calls = [];
  const waits = [];
  const result = await fetchValidatedPages({
    spots: [{ id: "a" }, { id: "b" }],
    fetchBatch: async (spots) => {
      calls.push(spots.map((spot) => spot.id));
      return spots.map((spot) => ({ ...spot, status: spot.id === "b" && calls.length === 1 ? 403 : 200 }));
    },
    validate: (page) => page.status === 200 ? null : `HTTP ${page.status}`,
    sleep: async (ms) => waits.push(ms),
    retryDelayMs: 15000
  });
  assert.deepEqual(calls, [["a", "b"], ["b"]]);
  assert.deepEqual(waits, [15000]);
  assert.deepEqual(result.pages.map((page) => page.id), ["a", "b"]);
  assert.deepEqual(result.failures, []);
});

test("fetchValidatedPages keeps a persistent 403 as a failure", async () => {
  const result = await fetchValidatedPages({
    spots: [{ id: "a" }],
    fetchBatch: async (spots) => spots.map((spot) => ({ ...spot, status: 403 })),
    validate: (page) => `HTTP ${page.status}`,
    sleep: async () => {},
    retryDelayMs: 15000
  });
  assert.deepEqual(result.pages, []);
  assert.deepEqual(result.failures, ["a: HTTP 403"]);
});
