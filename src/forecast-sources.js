import { parseMetricNumber } from "./surf-rating.js";
import { SURFLINE_FRESH_MAX_AGE_HOURS, LIVE_MODEL_MAX_AGE_HOURS } from "./config.js";

function ageHoursSince(iso, now) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? (now - t) / 3600000 : null;
}

function surflineIdFor(camera, spotData) {
  if (camera.promoted || String(camera.id).startsWith("surfline-")) return camera.id;
  const meta = spotData.spotMetadataById?.get(camera.id)?.surfMetadata;
  if (!meta) return null;
  if (meta.reviewStatus === "needs-review" || meta.reviewStatus === "rejected") return null;
  return meta.conditionsSourceSpotId ?? null;
}

export function resolveConditions(camera, spotData, { liveCache = null, now = Date.now() } = {}) {
  const surflineId = surflineIdFor(camera, spotData);
  const entry = surflineId ? spotData.conditionsById?.get(surflineId) : null;
  const entryAge = entry ? ageHoursSince(entry.fetchedAt, now) : null;
  if (entry && entryAge !== null && entryAge >= 0 && entryAge < SURFLINE_FRESH_MAX_AGE_HOURS) {
    const primarySwell = (entry.swells || [])[0] || {};
    return {
      source: "surfline-fresh",
      fetchedAt: entry.fetchedAt,
      ageHours: entryAge,
      waveMinM: entry.surfMinM ?? null,
      waveMaxM: entry.surfMaxM ?? null,
      windKmh: entry.windKmh ?? null,
      windDirDeg: entry.windDirDeg ?? null,
      periodS: primarySwell.periodS ?? null,
      swellDirDeg: primarySwell.dirDeg ?? null,
      rating: entry.rating ?? null
    };
  }
  const live = liveCache?.get(camera.id) || (surflineId ? liveCache?.get(surflineId) : null);
  const liveAge = live ? ageHoursSince(live.fetchedAt, now) : null;
  if (live && liveAge !== null && liveAge >= 0 && liveAge < LIVE_MODEL_MAX_AGE_HOURS) {
    return {
      source: "live-model",
      fetchedAt: live.fetchedAt,
      ageHours: liveAge,
      waveMinM: live.waveMinM ?? null,
      waveMaxM: live.waveMaxM ?? null,
      windKmh: live.windKmh ?? null,
      windDirDeg: live.windDirDeg ?? null,
      periodS: live.periodS ?? null,
      swellDirDeg: live.swellDirDeg ?? null,
      rating: null
    };
  }
  const waveM = parseMetricNumber(camera.forecast?.wave || camera.detailMetrics?.["Ondulação"]);
  return {
    source: "meo-static",
    fetchedAt: null,
    ageHours: null,
    waveMinM: waveM,
    waveMaxM: waveM,
    windKmh: parseMetricNumber(camera.forecast?.wind || camera.detailMetrics?.["Vento"]),
    windDirDeg: null,
    periodS: parseMetricNumber(camera.detailMetrics?.["Período das ondas"]),
    swellDirDeg: null,
    rating: null
  };
}

export function newestConditionsAgeHours(spotData, now = Date.now()) {
  let newest = null;
  for (const entry of spotData.conditionsById?.values() || []) {
    const age = ageHoursSince(entry.fetchedAt, now);
    if (age !== null && (newest === null || age < newest)) newest = age;
  }
  return newest;
}
