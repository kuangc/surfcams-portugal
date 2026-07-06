const round1 = (n) => Math.round(n * 10) / 10;

export function feetToMeters(ft) {
  return Number.isFinite(ft) ? round1(ft * 0.3048) : null;
}
export function knotsToKmh(kts) {
  return Number.isFinite(kts) ? round1(kts * 1.852) : null;
}
export function fahrenheitToCelsius(f) {
  return Number.isFinite(f) ? Math.round(((f - 32) * 5) / 9 * 10) / 10 : null;
}

export function parseNextDataState(html) {
  let text = String(html);
  const trimmed = text.trim();
  if (trimmed.startsWith('"')) {
    try { text = JSON.parse(trimmed); } catch { /* keep original */ }
  }
  const match = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1])?.props?.pageProps?.ssrReduxState ?? null;
  } catch {
    return null;
  }
}

export function extractSurflineCams(spotRecord) {
  return (spotRecord?.cameras || [])
    .map((cam) => ({ title: cam.title || cam.alias || null, stillUrl: cam.stillUrl || null }))
    .filter((cam) => cam.title || cam.stillUrl);
}

function ratingValue(rating) {
  const order = ["VERY_POOR", "POOR", "POOR_TO_FAIR", "FAIR", "FAIR_TO_GOOD", "GOOD", "VERY_GOOD", "EPIC"];
  const idx = order.indexOf(String(rating || "").toUpperCase());
  return idx >= 0 ? idx : null;
}

function normalizeRecord(spot, forecast, sourceKind, fetchedAt) {
  const wave = forecast?.waveHeight || spot?.waveHeight || null;
  const wind = forecast?.wind || spot?.wind || null;
  const conditions = forecast?.conditions?.value ?? spot?.conditions?.value ?? null;
  const rating = conditions ? String(conditions).toUpperCase() : null;
  return {
    name: spot?.name ?? null,
    remoteSpotId: spot?._id ?? null,
    sourceKind,
    fetchedAt,
    rating,
    ratingValue: ratingValue(rating),
    surfRawFt: wave ? [wave.min ?? null, wave.max ?? null] : null,
    surfMinM: feetToMeters(wave?.min),
    surfMaxM: feetToMeters(wave?.max),
    windKmh: knotsToKmh(wind?.speed),
    windDirDeg: Number.isFinite(wind?.direction) ? wind.direction : null,
    swells: (forecast?.swells || []).filter((s) => Number.isFinite(s?.height)).map((s) => ({
      hM: feetToMeters(s.height), periodS: s.period ?? null, dirDeg: s.direction ?? null
    })),
    waterTempC: fahrenheitToCelsius(forecast?.waterTemp?.min)
  };
}

export function extractConditionsRecords(state, { fetchedAt, idFor = (name, remoteId) => remoteId } = {}) {
  const out = [];
  const report = state?.spot?.report?.data;
  if (report?.spot) {
    const rec = normalizeRecord(report.spot, report.forecast, "primary", fetchedAt);
    rec.id = idFor(report.spot.name, report.spot._id);
    out.push(rec);
  }
  for (const nearby of state?.spot?.nearby?.data?.spots || []) {
    const rec = normalizeRecord(nearby, null, "nearby", fetchedAt);
    rec.id = idFor(nearby.name, nearby._id);
    out.push(rec);
  }
  return out;
}
