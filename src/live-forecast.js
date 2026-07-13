const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

export function liveForecastCacheKey(cameraId) {
  return `surfcamLiveForecast:v2:${cameraId}`;
}

function normalizeUtcHour(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const explicitZone = /(?:Z|[+-]\d\d:\d\d)$/i.test(raw);
  const date = new Date(explicitZone ? raw : `${raw}${raw.length === 16 ? ":00" : ""}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function normalizeHourlyForecast(marine, wind) {
  const marineHourly = marine?.hourly;
  if (!marineHourly) return [];

  const windByTime = new Map();
  for (let index = 0; index < (wind?.hourly?.time || []).length; index += 1) {
    const time = normalizeUtcHour(wind.hourly.time[index]);
    if (!time) continue;
    windByTime.set(time, {
      windKmh: finiteOrNull(wind.hourly.wind_speed_10m?.[index]),
      windDirectionDeg: finiteOrNull(wind.hourly.wind_direction_10m?.[index])
    });
  }

  return (marineHourly.time || []).flatMap((rawTime, index) => {
    const time = normalizeUtcHour(rawTime);
    if (!time) return [];
    const windPoint = windByTime.get(time) || {};
    return [{
      time,
      offshoreWaveM: finiteOrNull(marineHourly.wave_height?.[index]),
      primarySwellHeightM: finiteOrNull(marineHourly.swell_wave_height?.[index]),
      primarySwellPeriodS: finiteOrNull(
        marineHourly.swell_wave_period?.[index] ?? marineHourly.wave_period?.[index]
      ),
      primarySwellDirectionDeg: finiteOrNull(
        marineHourly.swell_wave_direction?.[index] ?? marineHourly.wave_direction?.[index]
      ),
      windKmh: windPoint.windKmh ?? null,
      windDirectionDeg: windPoint.windDirectionDeg ?? null
    }];
  });
}

function currentHour(hours, now) {
  const target = new Date(now).toISOString().slice(0, 13);
  return hours.find((hour) => hour.time.startsWith(target)) || hours[0] || null;
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
      + "&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction&timezone=UTC&forecast_days=1";
    const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${camera.lat}&longitude=${camera.lon}`
      + "&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=UTC&forecast_days=1";
    const [marine, wind] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, marineUrl),
      fetchJsonWithTimeout(fetchImpl, windUrl).catch(() => null)
    ]);
    if (!marine?.hourly) return null;

    const hours = normalizeHourlyForecast(marine, wind);
    const current = currentHour(hours, now);
    if (!current) return null;
    const result = {
      fetchedAt: new Date(now).toISOString(),
      waveMinM: current.offshoreWaveM,
      waveMaxM: current.offshoreWaveM,
      offshoreWaveM: current.offshoreWaveM,
      primarySwellHeightM: current.primarySwellHeightM,
      periodS: current.primarySwellPeriodS,
      swellDirDeg: current.primarySwellDirectionDeg,
      windKmh: current.windKmh,
      windDirDeg: current.windDirectionDeg,
      hours
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
