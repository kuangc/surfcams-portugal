const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

export function liveForecastCacheKey(cameraId) {
  return `surfcamLiveForecast:v1:${cameraId}`;
}

function currentHourIndex(times, now) {
  const target = new Date(now).toISOString().slice(0, 13);
  const idx = (times || []).findIndex((time) => String(time).startsWith(target));
  return idx >= 0 ? idx : 0;
}

async function fetchJsonWithTimeout(fetchImpl, url) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res.ok) return null;
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchLiveForecast(
  camera,
  { fetchImpl = fetch, storage = globalThis.localStorage, now = Date.now() } = {}
) {
  const key = liveForecastCacheKey(camera.id);
  try {
    const cached = storage?.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (now - Date.parse(parsed.fetchedAt) < TTL_MS) return parsed;
    }
  } catch {
    // Corrupt cache entries should not block a fresh model fetch.
  }

  try {
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${camera.lat}&longitude=${camera.lon}`
      + "&hourly=wave_height,wave_period,wave_direction,swell_wave_direction&timezone=UTC&forecast_days=1";
    const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${camera.lat}&longitude=${camera.lon}`
      + "&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=UTC&forecast_days=1";
    const [marine, wind] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, marineUrl),
      fetchJsonWithTimeout(fetchImpl, windUrl).catch(() => null)
    ]);
    if (!marine?.hourly) return null;

    const mi = currentHourIndex(marine.hourly.time, now);
    const wi = wind?.hourly ? currentHourIndex(wind.hourly.time, now) : 0;
    const waveM = marine.hourly.wave_height?.[mi] ?? null;
    const result = {
      fetchedAt: new Date(now).toISOString(),
      waveMinM: waveM,
      waveMaxM: waveM,
      periodS: marine.hourly.wave_period?.[mi] ?? null,
      swellDirDeg: marine.hourly.swell_wave_direction?.[mi] ?? marine.hourly.wave_direction?.[mi] ?? null,
      windKmh: wind?.hourly?.wind_speed_10m?.[wi] ?? null,
      windDirDeg: wind?.hourly?.wind_direction_10m?.[wi] ?? null
    };
    try {
      storage?.setItem(key, JSON.stringify(result));
    } catch {
      // Storage may be unavailable or full; keep the result in memory only.
    }
    return result;
  } catch {
    return null;
  }
}
