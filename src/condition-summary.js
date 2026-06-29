import { formatTideState } from "./format.js";
import { rateSurfSpot } from "./surf-rating.js";
import { formatTideEventTime } from "./tide-data.js";

function shortFitLabel(key) {
  if (key === "good") return "Good";
  if (key === "caution") return "Caution";
  if (key === "poor") return "Poor";
  return "Unknown";
}

function formatCompactNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatWindSpeed(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : null;
}

function formatArrow(bearing) {
  if (!Number.isFinite(bearing)) return "•";
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return arrows[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function formatCoastIcon(bearing) {
  if (!Number.isFinite(bearing)) return "⋯";
  const shorelineIcons = ["━", "╲", "┃", "╱", "━", "╲", "┃", "╱"];
  return shorelineIcons[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

function formatSource(camera) {
  if (camera.surfline?.pageUrl || camera.surfline?.forecast) {
    return {
      key: "surfline",
      label: "SL",
      detail: "Surfline forecast"
    };
  }

  if (String(camera.pageUrl || "").includes("beachcam.meo.pt")) {
    return {
      key: "meo",
      label: "MEO",
      detail: "Beachcam/MEO forecast"
    };
  }

  return {
    key: "unknown",
    label: "SRC",
    detail: "Forecast source unknown"
  };
}

function coastTone(confidence) {
  if (confidence === "spot") return "good";
  if (confidence === "regional") return "neutral";
  return "muted";
}

function formatSeaTemperature(value) {
  return String(value || "").trim().replace("º", "°") || "unknown";
}

function currentTideIcon(value) {
  const tideState = formatTideState(value).toLowerCase();
  if (tideState === "low") return "↓";
  if (tideState === "high") return "↑";
  if (tideState === "rising") return "↗";
  if (tideState === "falling") return "↘";
  return "≈";
}

export function formatWaterSummary(camera, { tideSnapshot = null, timeZone = "Europe/Lisbon" } = {}) {
  const tideNow = tideSnapshot?.stateLabel || formatTideState(camera?.forecast?.tideState);
  const tideMetrics = [
    {
      key: "sea-temp",
      label: "Sea temp",
      value: formatSeaTemperature(camera?.detailMetrics?.["Temp. do mar"]),
      icon: "≋",
      tone: "caution"
    },
    {
      key: "tide-now",
      label: "Tide now",
      value: tideNow || "unknown",
      icon: currentTideIcon(tideNow || camera?.forecast?.tideState),
      tone: "neutral",
      detail: tideSnapshot?.station?.portName ? `${tideSnapshot.station.portName} tide gauge` : ""
    }
  ];

  if (tideSnapshot?.nextDaylightHigh) {
    tideMetrics.push(
      {
        key: "next-high",
        label: "Daylight high",
        value: formatTideEventTime(tideSnapshot.nextDaylightHigh, timeZone),
        icon: "⇡",
        tone: "good",
        detail: tideSnapshot?.station?.portName ? `${tideSnapshot.station.portName} tide gauge` : ""
      }
    );
  }

  if (tideSnapshot?.firstLight) {
    tideMetrics.push({
      key: "first-light",
      label: "First light",
      value: formatTideEventTime(tideSnapshot.firstLight, timeZone),
      icon: "☀",
      tone: "caution",
      detail: "Civil dawn"
    });
  }

  if (tideSnapshot?.lastLight) {
    tideMetrics.push({
      key: "last-light",
      label: "Last light",
      value: formatTideEventTime(tideSnapshot.lastLight, timeZone),
      icon: "◐",
      tone: "neutral",
      detail: "Civil dusk"
    });
  }

  return tideMetrics;
}

export function formatConditionLine(camera, preferences) {
  const rating = rateSurfSpot(camera, preferences);
  const source = formatSource(camera);
  const swell = rating.swell.compass === "unknown" ? "swell ?" : rating.swell.compass;
  const period = rating.period.seconds === null ? "?s" : `${formatCompactNumber(rating.period.seconds)}s`;
  const wind = rating.wind.speedKmh === null ? "wind ?" : `wind ${rating.wind.arrow} ${formatCompactNumber(rating.wind.speedKmh)}km/h ${rating.wind.alignment}`;
  const coast = rating.coast.compass === "unknown" ? "coast ?" : `coast ${rating.coast.compass}`;

  return `${shortFitLabel(rating.key)} · ${source.label} · ${rating.wave.label} · ${swell} ${period} · ${wind} · ${coast}`;
}

export function formatConditionChips(camera, preferences, { driveEstimate = null } = {}) {
  const rating = rateSurfSpot(camera, preferences);
  const source = formatSource(camera);
  const swell = rating.swell.compass === "unknown" ? "swell ?" : rating.swell.compass;
  const period = rating.period.seconds === null ? "?s" : `${formatCompactNumber(rating.period.seconds)}s`;
  const swellIcon = Number.isFinite(rating.swell.bearing) ? formatArrow((rating.swell.bearing + 180) % 360) : "≈";
  const windSpeed = formatWindSpeed(rating.wind.speedKmh);
  const wind = windSpeed === null ? "wind ?" : `${windSpeed}km/h ${rating.wind.alignment}`;
  const coast = rating.coast.compass === "unknown" ? "coast ?" : `${rating.coast.compass} facing`;

  return [
    {
      key: "fit",
      label: shortFitLabel(rating.key),
      detail: rating.confidence.label,
      icon: "●",
      tone: rating.key
    },
    {
      key: "source",
      label: source.label,
      detail: source.detail,
      icon: source.label,
      source: source.key,
      tone: "neutral"
    },
    {
      key: "wave",
      label: rating.wave.label,
      detail: "surf",
      icon: "≈",
      tone: "neutral"
    },
    {
      key: "swell",
      label: `${swell} ${period}`,
      detail: "swell",
      icon: swellIcon,
      tone: "neutral"
    },
    {
      key: "wind",
      label: wind,
      detail: rating.wind.alignment,
      icon: rating.wind.arrow,
      tone: rating.wind.alignment === "offshore" ? "good" : rating.wind.alignment === "onshore" ? "poor" : "neutral"
    },
    {
      key: "coast",
      label: coast,
      detail: `${rating.confidence.label} coast exposure`,
      icon: formatCoastIcon(rating.coast.bearing),
      tone: coastTone(rating.coast.confidence)
    },
    driveEstimate && {
      key: "drive",
      label: driveEstimate.distanceLabel || driveEstimate.label,
      detail: `Estimated route distance from ${driveEstimate.origin?.label || "Central Lisbon"}`,
      icon: "↦",
      tone: "neutral"
    }
  ].filter(Boolean);
}

export function formatSpotMetadata(camera, preferences) {
  const rating = rateSurfSpot(camera, preferences);

  return [
    { label: "Surf", value: rating.wave.label },
    { label: "Swell", value: rating.swell.compass },
    { label: "Period", value: rating.period.label },
    { label: "Wind", value: `${rating.wind.arrow} ${rating.wind.label} ${rating.wind.alignment}` },
    { label: "Coast", value: `${rating.coast.compass} exposure` }
  ].filter(Boolean);
}
