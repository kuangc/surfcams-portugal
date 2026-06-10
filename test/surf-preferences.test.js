import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SURF_PREFERENCES,
  loadSurfPreferences,
  normalizeSurfPreferences,
  saveSurfPreferences,
  serializeSurfPreferences
} from "../src/surf-preferences.js";
import { SURF_PREFERENCES_STORAGE_KEY } from "../src/config.js";

function storageWith(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set(SURF_PREFERENCES_STORAGE_KEY, initialValue);

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    value(key = SURF_PREFERENCES_STORAGE_KEY) {
      return values.get(key);
    }
  };
}

test("default surf preferences match the group baseline", () => {
  assert.deepEqual(DEFAULT_SURF_PREFERENCES, {
    minSurfHeightM: 0.3,
    maxSurfHeightM: 1.5,
    maxWindSpeedKmh: 18,
    minPeriodSeconds: 5,
    preferOffshore: true,
    allowLightWind: true,
    surfSizeScale: 1
  });
});

test("normalizeSurfPreferences clamps invalid numeric values", () => {
  const result = normalizeSurfPreferences({
    minSurfHeightM: -2,
    maxSurfHeightM: 20,
    maxWindSpeedKmh: -1,
    minPeriodSeconds: 40,
    surfSizeScale: 0
  });

  assert.deepEqual(result, {
    minSurfHeightM: 0,
    maxSurfHeightM: 4,
    maxWindSpeedKmh: 0,
    minPeriodSeconds: 20,
    preferOffshore: true,
    allowLightWind: true,
    surfSizeScale: 0.2
  });
});

test("loadSurfPreferences falls back to defaults for missing or invalid storage", () => {
  assert.deepEqual(loadSurfPreferences(storageWith()), DEFAULT_SURF_PREFERENCES);
  assert.deepEqual(loadSurfPreferences(storageWith("{bad json")), DEFAULT_SURF_PREFERENCES);
});

test("saveSurfPreferences stores normalized preferences", () => {
  const storage = storageWith();

  saveSurfPreferences({ minSurfHeightM: 0.5, maxSurfHeightM: 1.2, preferOffshore: false }, storage);

  assert.equal(
    storage.value(),
    JSON.stringify({
      minSurfHeightM: 0.5,
      maxSurfHeightM: 1.2,
      maxWindSpeedKmh: 18,
      minPeriodSeconds: 5,
      preferOffshore: false,
      allowLightWind: true,
      surfSizeScale: 1
    })
  );
});

test("serializeSurfPreferences returns string values for the configure form", () => {
  assert.deepEqual(serializeSurfPreferences(DEFAULT_SURF_PREFERENCES), {
    minSurfHeightM: "0.3",
    maxSurfHeightM: "1.5",
    maxWindSpeedKmh: "18",
    minPeriodSeconds: "5",
    surfSizeScale: "1",
    preferOffshore: true,
    allowLightWind: true
  });
});
