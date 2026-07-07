import assert from "node:assert/strict";
import test from "node:test";

import { fetchLiveForecast, liveForecastCacheKey } from "../src/live-forecast.js";

const NOW = Date.parse("2026-07-07T15:30:00Z");
const CURRENT_HOUR = "2026-07-07T15:00";

function fakeStorage(initial = []) {
  const items = new Map(initial);
  return {
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      items.set(key, String(value));
    },
    item(key) {
      return items.get(key);
    }
  };
}

function forecastBodies() {
  return {
    marine: {
      hourly: {
        time: ["2026-07-07T14:00", CURRENT_HOUR],
        wave_height: [0.8, 1.2],
        wave_period: [7, 9],
        wave_direction: [280, 285],
        swell_wave_direction: [295, 300]
      }
    },
    wind: {
      hourly: {
        time: ["2026-07-07T14:00", CURRENT_HOUR],
        wind_speed_10m: [14, 22],
        wind_direction_10m: [330, 345]
      }
    }
  };
}

function cannedFetch({ marine = forecastBodies().marine, wind = forecastBodies().wind } = {}) {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const body = String(url).includes("marine-api.open-meteo.com") ? marine : wind;
    return {
      ok: true,
      async json() {
        return body;
      }
    };
  };
  return {
    fetchImpl,
    calls() {
      return calls;
    }
  };
}

test("fetchLiveForecast merges marine + wind and caches", async () => {
  const camera = { id: "cam-live", lat: 38.7, lon: -9.4 };
  const storage = fakeStorage();
  const fetcher = cannedFetch();

  const first = await fetchLiveForecast(camera, { fetchImpl: fetcher.fetchImpl, storage, now: NOW });
  const second = await fetchLiveForecast(camera, { fetchImpl: fetcher.fetchImpl, storage, now: NOW + 10 * 60 * 1000 });

  assert.equal(first.waveMinM, 1.2);
  assert.equal(first.waveMaxM, 1.2);
  assert.equal(first.windKmh, 22);
  assert.equal(first.periodS, 9);
  assert.equal(second.waveMinM, 1.2);
  assert.equal(fetcher.calls(), 2);
});

test("failure returns null without throwing", async () => {
  const camera = { id: "cam-failure", lat: 38.7, lon: -9.4 };
  const storage = fakeStorage();
  const fetchImpl = async () => {
    throw new Error("offline");
  };

  const result = await fetchLiveForecast(camera, { fetchImpl, storage, now: NOW });

  assert.equal(result, null);
});

test("malformed cached JSON refetches", async () => {
  const camera = { id: "cam-corrupt", lat: 38.7, lon: -9.4 };
  const key = liveForecastCacheKey(camera.id);
  const storage = fakeStorage([[key, "{not-json"]]);
  const fetcher = cannedFetch();

  const result = await fetchLiveForecast(camera, { fetchImpl: fetcher.fetchImpl, storage, now: NOW });

  assert.equal(result.waveMinM, 1.2);
  assert.equal(fetcher.calls(), 2);
  assert.notEqual(storage.item(key), "{not-json");
  assert.equal(JSON.parse(storage.item(key)).windKmh, 22);
});

test("marine missing hourly -> null, nothing cached", async () => {
  const camera = { id: "cam-no-hourly", lat: 38.7, lon: -9.4 };
  const key = liveForecastCacheKey(camera.id);
  const storage = fakeStorage();
  const fetcher = cannedFetch({ marine: { latitude: 38.7 }, wind: forecastBodies().wind });

  const result = await fetchLiveForecast(camera, { fetchImpl: fetcher.fetchImpl, storage, now: NOW });

  assert.equal(result, null);
  assert.equal(storage.getItem(key), null);
});

test("wind endpoint rejection degrades to marine-only result", async () => {
  const bodies = forecastBodies();
  const storage = fakeStorage();
  const fetchImpl = async (url) => {
    if (url.includes("marine-api")) {
      return { ok: true, json: async () => bodies.marine };
    }
    throw new Error("wind endpoint down");
  };
  const result = await fetchLiveForecast({ id: "cam-w", lat: 38.7, lon: -9.3 }, { fetchImpl, storage, now: NOW });
  assert.ok(result, "marine-only result expected despite wind rejection");
  assert.equal(result.waveMinM, 1.2);
  assert.equal(result.windKmh, null);
  assert.equal(result.windDirDeg, null);
});
