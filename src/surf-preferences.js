import { SURF_PREFERENCES_STORAGE_KEY } from "./config.js";

export const DEFAULT_SURF_PREFERENCES = {
  minSurfHeightM: 0.3,
  maxSurfHeightM: 1.5,
  maxWindSpeedKmh: 18,
  minPeriodSeconds: 5,
  preferOffshore: true,
  allowLightWind: true,
  surfSizeScale: 1
};

function numberInRange(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeSurfPreferences(raw = {}) {
  const minSurfHeightM = numberInRange(raw.minSurfHeightM, DEFAULT_SURF_PREFERENCES.minSurfHeightM, 0, 4);
  const maxSurfHeightM = numberInRange(raw.maxSurfHeightM, DEFAULT_SURF_PREFERENCES.maxSurfHeightM, 0, 4);

  return {
    minSurfHeightM: Math.min(minSurfHeightM, maxSurfHeightM),
    maxSurfHeightM: Math.max(minSurfHeightM, maxSurfHeightM),
    maxWindSpeedKmh: numberInRange(raw.maxWindSpeedKmh, DEFAULT_SURF_PREFERENCES.maxWindSpeedKmh, 0, 80),
    minPeriodSeconds: numberInRange(raw.minPeriodSeconds, DEFAULT_SURF_PREFERENCES.minPeriodSeconds, 0, 20),
    preferOffshore: typeof raw.preferOffshore === "boolean" ? raw.preferOffshore : DEFAULT_SURF_PREFERENCES.preferOffshore,
    allowLightWind: typeof raw.allowLightWind === "boolean" ? raw.allowLightWind : DEFAULT_SURF_PREFERENCES.allowLightWind,
    surfSizeScale: numberInRange(raw.surfSizeScale, DEFAULT_SURF_PREFERENCES.surfSizeScale, 0.2, 2)
  };
}

export function loadSurfPreferences(storage = window.localStorage) {
  const stored = storage.getItem(SURF_PREFERENCES_STORAGE_KEY);
  if (!stored) return DEFAULT_SURF_PREFERENCES;

  try {
    return normalizeSurfPreferences(JSON.parse(stored));
  } catch (_error) {
    return DEFAULT_SURF_PREFERENCES;
  }
}

export function saveSurfPreferences(preferences, storage = window.localStorage) {
  const normalized = normalizeSurfPreferences(preferences);
  storage.setItem(SURF_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function serializeSurfPreferences(preferences) {
  const normalized = normalizeSurfPreferences(preferences);
  return {
    minSurfHeightM: String(normalized.minSurfHeightM),
    maxSurfHeightM: String(normalized.maxSurfHeightM),
    maxWindSpeedKmh: String(normalized.maxWindSpeedKmh),
    minPeriodSeconds: String(normalized.minPeriodSeconds),
    surfSizeScale: String(normalized.surfSizeScale),
    preferOffshore: normalized.preferOffshore,
    allowLightWind: normalized.allowLightWind
  };
}
