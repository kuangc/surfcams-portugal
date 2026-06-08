import { formatTideState } from "./format.js";
import { rateSurfSpot } from "./surf-rating.js";

function shortFitLabel(key) {
  if (key === "good") return "Good";
  if (key === "caution") return "Caution";
  if (key === "poor") return "Poor";
  return "Unknown";
}

function formatCompactNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatConditionLine(camera, preferences) {
  const rating = rateSurfSpot(camera, preferences);
  const tideState = formatTideState(camera.forecast?.tideState).toLowerCase();
  const tide = [tideState, camera.forecast?.tide].filter(Boolean).join(" ");
  const swell = rating.swell.compass === "unknown" ? "swell ?" : rating.swell.compass;
  const period = rating.period.seconds === null ? "?s" : `${formatCompactNumber(rating.period.seconds)}s`;
  const wind = rating.wind.speedKmh === null ? "wind ?" : `wind ${rating.wind.arrow} ${formatCompactNumber(rating.wind.speedKmh)}km/h`;

  return `${shortFitLabel(rating.key)} · ${rating.wave.label} · ${swell} ${period} · ${wind}${tide ? ` · ${tide}` : ""}`;
}

export function formatConditionChips(camera, preferences) {
  const rating = rateSurfSpot(camera, preferences);
  const tideState = formatTideState(camera.forecast?.tideState).toLowerCase();
  const tide = [tideState, camera.forecast?.tide].filter(Boolean).join(" ");
  const swell = rating.swell.compass === "unknown" ? "swell ?" : rating.swell.compass;
  const period = rating.period.seconds === null ? "?s" : `${formatCompactNumber(rating.period.seconds)}s`;
  const wind = rating.wind.speedKmh === null ? "wind ?" : `${rating.wind.arrow} ${formatCompactNumber(rating.wind.speedKmh)}km/h`;

  return [
    {
      key: "fit",
      label: shortFitLabel(rating.key),
      detail: rating.confidence.label,
      tone: rating.key
    },
    {
      key: "wave",
      label: rating.wave.label,
      detail: "surf",
      tone: "neutral"
    },
    {
      key: "swell",
      label: `${swell} ${period}`,
      detail: "swell",
      tone: "neutral"
    },
    {
      key: "wind",
      label: wind,
      detail: rating.wind.alignment,
      tone: rating.wind.alignment === "offshore" ? "good" : rating.wind.alignment === "onshore" ? "poor" : "neutral"
    },
    {
      key: "tide",
      label: tide || "tide ?",
      detail: "tide",
      tone: "neutral"
    }
  ];
}

export function formatSpotMetadata(camera, preferences) {
  const rating = rateSurfSpot(camera, preferences);
  const tideState = formatTideState(camera.forecast?.tideState);
  const tide = [tideState, camera.forecast?.tide].filter(Boolean).join(" ");

  return [
    { label: "Surf", value: rating.wave.label },
    { label: "Swell", value: rating.swell.compass },
    { label: "Period", value: rating.period.label },
    { label: "Wind", value: `${rating.wind.arrow} ${rating.wind.label} ${rating.wind.alignment}` },
    { label: "Tide", value: tide || "unknown" },
    { label: "Coast", value: rating.confidence.label },
    camera.detailMetrics?.["Temp. do mar"] ? { label: "Sea Temp", value: camera.detailMetrics["Temp. do mar"] } : null
  ].filter(Boolean);
}
