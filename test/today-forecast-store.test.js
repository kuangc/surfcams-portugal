import assert from "node:assert/strict";
import test from "node:test";

import { createTodayForecastStore } from "../src/today-forecast-store.js";

function camera(id, lat, lon) {
  return { id, lat, lon };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("forecast store deduplicates linked coordinates and aliases one result", async () => {
  const calls = [];
  const payload = { fetchedAt: "2026-07-13T09:00:00Z", hours: [{ time: "2026-07-13T09:00:00Z" }] };
  const store = createTodayForecastStore({
    fetchForecast: async (subject) => {
      calls.push(subject.id);
      return payload;
    },
    now: () => Date.parse("2026-07-13T09:15:00Z")
  });
  const a = camera("a", 38.7, -9.3);
  const linked = camera("linked", 38.7, -9.3);

  const summary = await store.load([a, linked]);

  assert.equal(calls.length, 1);
  assert.equal(store.get(a), payload);
  assert.equal(store.get(linked), payload);
  assert.equal(store.status(a), "ready");
  assert.deepEqual(summary, { ready: 2, failed: 0 });
});

test("forecast store respects bounded concurrency and preserves partial success", async () => {
  let active = 0;
  let maxActive = 0;
  const store = createTodayForecastStore({
    concurrency: 2,
    now: () => Date.parse("2026-07-13T09:15:00Z"),
    async fetchForecast(subject) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (subject.id === "bad") throw new Error("offline");
      return { fetchedAt: "2026-07-13T09:00:00Z", hours: [] };
    }
  });
  const subjects = [camera("a", 1, 1), camera("bad", 2, 2), camera("c", 3, 3), camera("d", 4, 4)];

  const summary = await store.load(subjects);

  assert.equal(maxActive, 2);
  assert.deepEqual(summary, { ready: 3, failed: 1 });
  assert.equal(store.status(subjects[0]), "ready");
  assert.equal(store.status(subjects[1]), "error");
  assert.equal(store.get(subjects[1]), null);
});

test("forecast store reuses ready entries for one hour", async () => {
  let currentNow = Date.parse("2026-07-13T09:15:00Z");
  let calls = 0;
  const subject = camera("a", 1, 1);
  const store = createTodayForecastStore({
    now: () => currentNow,
    async fetchForecast() {
      calls += 1;
      return { fetchedAt: new Date(currentNow).toISOString(), hours: [] };
    }
  });

  await store.load([subject]);
  currentNow += 59 * 60 * 1000;
  await store.load([subject]);
  assert.equal(calls, 1);

  currentNow += 2 * 60 * 1000;
  await store.load([subject]);
  assert.equal(calls, 2);
});

test("clear generation prevents a late request from replacing a newer result", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const subject = camera("a", 1, 1);
  const store = createTodayForecastStore({
    now: () => Date.parse("2026-07-13T09:15:00Z"),
    fetchForecast() {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    }
  });

  const oldLoad = store.load([subject]);
  store.clear();
  const newLoad = store.load([subject]);
  second.resolve({ fetchedAt: "new", hours: [{ time: "new" }] });
  await newLoad;
  first.resolve({ fetchedAt: "old", hours: [{ time: "old" }] });
  await oldLoad;

  assert.equal(store.get(subject).fetchedAt, "new");
  assert.equal(store.status(subject), "ready");
});

test("invalid coordinates remain idle and do not call the provider", async () => {
  let calls = 0;
  const invalid = camera("invalid", null, -9.3);
  const store = createTodayForecastStore({
    fetchForecast: async () => {
      calls += 1;
      return {};
    }
  });

  assert.deepEqual(await store.load([invalid]), { ready: 0, failed: 0 });
  assert.equal(calls, 0);
  assert.equal(store.status(invalid), "idle");
});

test("forecast store notifies subscribers as coordinates settle", async () => {
  const updates = [];
  const store = createTodayForecastStore({
    now: () => Date.parse("2026-07-13T09:15:00Z"),
    fetchForecast: async (subject) => ({ fetchedAt: subject.id, hours: [] })
  });
  const unsubscribe = store.subscribe((update) => updates.push(update));

  await store.load([camera("a", 1, 1), camera("b", 2, 2)]);
  unsubscribe();
  await store.load([camera("c", 3, 3)]);

  assert.deepEqual(updates.map((update) => update.status), ["loading", "loading", "ready", "ready"]);
  assert.deepEqual(updates.filter((update) => update.status === "ready").map((update) => update.cameraIds), [["a"], ["b"]]);
});
