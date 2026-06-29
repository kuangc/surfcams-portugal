const COMPASS = {
  north: { label: "N", bearing: 0 },
  norte: { label: "N", bearing: 0 },
  northeast: { label: "NE", bearing: 45 },
  nordeste: { label: "NE", bearing: 45 },
  east: { label: "E", bearing: 90 },
  este: { label: "E", bearing: 90 },
  southeast: { label: "SE", bearing: 135 },
  sudeste: { label: "SE", bearing: 135 },
  south: { label: "S", bearing: 180 },
  sul: { label: "S", bearing: 180 },
  southwest: { label: "SW", bearing: 225 },
  sudoeste: { label: "SW", bearing: 225 },
  west: { label: "W", bearing: 270 },
  oeste: { label: "W", bearing: 270 },
  northwest: { label: "NW", bearing: 315 },
  noroeste: { label: "NW", bearing: 315 }
};

const COAST_EXPOSURE = {
  cascais: { label: "West-facing regional estimate", bearing: 270, confidence: "regional" },
  almada: { label: "West-facing regional estimate", bearing: 270, confidence: "regional" },
  oeiras: { label: "South-facing regional estimate", bearing: 180, confidence: "regional" },
  peniche: { label: "West/Northwest exposure estimate", bearing: 300, confidence: "regional" },
  sesimbra: { label: "Sheltered south-facing bay", bearing: 180, confidence: "spot" }
};

const SPOT_EXPOSURE = {
  "praia-de-carcavelos": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "carcavelos-calhau": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "carcavelos-norte-estatica": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "carcavelos-calhau-estatica": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "sao-pedro-do-estoril": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "sao-pedro-do-estoril-bico-estatica": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  parede: { label: "South-facing spot estimate", bearing: 180, confidence: "spot" },
  "parede-estatica": { label: "South-facing spot estimate", bearing: 180, confidence: "spot" }
};

const CONFIDENCE_LABELS = {
  spot: "Spot-calibrated",
  regional: "Regional estimate",
  heuristic: "Heuristic estimate",
  unknown: "Unknown exposure"
};

export function parseMetricNumber(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function formatCompactNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function normalizeDirection(value) {
  const key = String(value || "").trim().toLowerCase();
  return COMPASS[key] || null;
}

function bearingDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function windAlignment(windBearing, coastBearing) {
  if (!Number.isFinite(windBearing) || !Number.isFinite(coastBearing)) return "unknown";
  const diff = bearingDifference(windBearing, coastBearing);
  if (diff <= 45) return "onshore";
  if (diff >= 135) return "offshore";
  return "cross";
}

function formatArrow(bearing) {
  if (!Number.isFinite(bearing)) return "?";
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return arrows[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function compassFromBearing(bearing) {
  if (!Number.isFinite(bearing)) return "unknown";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function normalizeCoastExposure(exposure) {
  if (!exposure || typeof exposure !== "object") return null;
  const bearing = Number(exposure.bearing);
  if (!Number.isFinite(bearing)) return null;

  return {
    label: exposure.label || `${compassFromBearing(bearing)}-facing exposure`,
    bearing,
    confidence: exposure.confidence || "spot",
    source: exposure.source || "metadata"
  };
}

function fallbackCoastExposure(camera) {
  return SPOT_EXPOSURE[camera.id]
    || COAST_EXPOSURE[camera.region]
    || { label: "Unknown exposure", bearing: null, confidence: "unknown", source: "fallback" };
}

export function getConditionVectors(camera) {
  const wind = normalizeDirection(camera.forecast?.windDirection || camera.detailMetrics?.["Direção do vento"]);
  const swell = normalizeDirection(camera.detailMetrics?.["Direção das ondas"]);
  const coast = normalizeCoastExposure(camera.surfMetadata?.coastExposure) || fallbackCoastExposure(camera);
  const windArrowBearing = Number.isFinite(wind?.bearing) ? (wind.bearing + 180) % 360 : null;

  return {
    coast: {
      label: coast.label,
      bearing: coast.bearing,
      compass: compassFromBearing(coast.bearing),
      confidence: coast.confidence,
      source: coast.source || "static"
    },
    wind: {
      compass: wind?.label || "unknown",
      bearing: wind?.bearing ?? null,
      arrowBearing: windArrowBearing,
      arrow: formatArrow(windArrowBearing),
      alignment: windAlignment(wind?.bearing, coast.bearing)
    },
    swell: {
      compass: swell?.label || "unknown",
      bearing: swell?.bearing ?? null
    }
  };
}

export function rateSurfSpot(camera, preferences) {
  const vectors = getConditionVectors(camera);
  const rawWaveM = parseMetricNumber(camera.forecast?.wave || camera.detailMetrics?.Ondulação);
  const waveM = rawWaveM === null ? null : rawWaveM * preferences.surfSizeScale;
  const windSpeedKmh = parseMetricNumber(camera.forecast?.wind || camera.detailMetrics?.Vento);
  const periodSeconds = parseMetricNumber(camera.detailMetrics?.["Período das ondas"]);
  const waveInRange = waveM !== null && waveM >= preferences.minSurfHeightM && waveM <= preferences.maxSurfHeightM;
  const lightWind = windSpeedKmh !== null && windSpeedKmh <= preferences.maxWindSpeedKmh;
  const periodOk = periodSeconds !== null && periodSeconds >= preferences.minPeriodSeconds;
  const windOk = vectors.wind.alignment === "offshore" || (preferences.allowLightWind && lightWind);
  const isRecommended = waveInRange && windOk && periodOk;
  const key = isRecommended ? "good" : waveInRange && (windOk || periodOk) ? "caution" : "poor";

  return {
    key,
    label: key === "good" ? "Good for us" : key === "caution" ? "Caution" : "Poor for us",
    isRecommended,
    reason: waveInRange ? "Check the cam before trusting this model." : "Surf height outside your configured range.",
    wave: {
      meters: waveM,
      label: waveM === null ? "unknown" : `~${waveM.toFixed(1)}m`
    },
    wind: {
      speedKmh: windSpeedKmh,
      label: windSpeedKmh === null ? "unknown wind" : `${formatCompactNumber(windSpeedKmh)}km/h`,
      alignment: vectors.wind.alignment,
      arrow: vectors.wind.arrow
    },
    swell: vectors.swell,
    coast: vectors.coast,
    period: {
      seconds: periodSeconds,
      label: periodSeconds === null ? "unknown" : `${formatCompactNumber(periodSeconds)}s`
    },
    tide: {
      value: camera.forecast?.tide || "",
      state: camera.forecast?.tideState || ""
    },
    confidence: {
      key: vectors.coast.confidence,
      label: CONFIDENCE_LABELS[vectors.coast.confidence] || CONFIDENCE_LABELS.unknown
    }
  };
}
