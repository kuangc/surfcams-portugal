import { formatRegion, formatTideState } from "./format.js";
import { getConditionVectors, rateSurfSpot } from "./surf-rating.js";

const WAVE_COUNT_SLANG = [
  "So many mondo sick tubes, brahh",
  "Sets for days",
  "A suspicious number of party waves",
  "Enough to make your shoulders file a complaint",
  "Cooking with frothy little runners",
  "Proper yeehaw foam traffic"
];

function roundOne(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${roundOne(value)}m` : "No wave reading";
}

function hashString(value) {
  return [...String(value || "")].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function confidenceFromVectors(vectors) {
  if (vectors.coast.confidence === "spot") {
    return {
      label: "High",
      reason: "Spot-calibrated exposure"
    };
  }

  if (vectors.coast.confidence === "regional") {
    return {
      label: "Medium",
      reason: "Regional coast estimate"
    };
  }

  return {
    label: "Low",
    reason: "Unknown coast exposure"
  };
}

export function abilityFit(rating) {
  const height = rating.wave?.heightM;
  const wind = rating.wind?.speedKmh;
  const period = rating.period?.seconds;

  if (
    (Number.isFinite(height) && height >= 1.35) ||
    (Number.isFinite(wind) && wind > 16) ||
    (Number.isFinite(period) && period > 10)
  ) {
    return "experienced";
  }

  if (
    Number.isFinite(height) &&
    height >= 0.5 &&
    height <= 0.9 &&
    (!Number.isFinite(wind) || wind <= 10) &&
    (!Number.isFinite(period) || period < 8)
  ) {
    return "mellow";
  }

  return "mixed";
}

export function waveCountSlang(camera) {
  return WAVE_COUNT_SLANG[hashString(camera?.id || camera?.name) % WAVE_COUNT_SLANG.length];
}

function verdictFor(rating, fit) {
  if (!rating.isRecommended) return "Skip for mixed group";
  if (fit === "experienced") return "Caution";
  if (rating.key === "fair-to-good") return "Best bet";
  return "Caution";
}

function decisionReason(rating, fit) {
  const concerns = [];

  if (Number.isFinite(rating.wave.heightM) && rating.wave.heightM >= 1.35) {
    concerns.push("near max size");
  }
  if (Number.isFinite(rating.wind.speedKmh) && rating.wind.speedKmh > 12) {
    concerns.push("breezy wind");
  }
  if (Number.isFinite(rating.period.seconds) && rating.period.seconds < 8) {
    concerns.push("short period");
  }
  if (rating.wind.alignment !== "offshore") {
    concerns.push(`${rating.wind.alignment} wind`);
  }
  if (fit === "experienced" && concerns.length === 0) {
    concerns.push("more power");
  }

  return concerns.length ? `Watch for ${concerns.join(", ")}` : rating.reasons[0];
}

function tideLabel(camera) {
  const tideState = formatTideState(camera.forecast?.tideState);
  return [tideState, camera.forecast?.tide].filter(Boolean).join(" ") || "No tide";
}

function swellLabel(vectors) {
  return vectors.swell.label.replace("Swell from ", "");
}

export function surfDecision(camera, index = 0) {
  const rating = rateSurfSpot(camera);
  const vectors = getConditionVectors(camera);
  const fit = abilityFit(rating);
  const confidence = confidenceFromVectors(vectors);

  return {
    id: camera.id,
    rank: index + 1,
    name: camera.name,
    location: `${camera.location || "Unknown"} / ${formatRegion(camera.region)}`,
    rating,
    verdict: verdictFor(rating, fit),
    abilityFit: fit,
    confidence,
    wave: rating.wave.estimated
      ? `${rating.wave.label} (${formatMeters(rating.wave.rawHeightM)} source)`
      : rating.wave.label,
    tide: tideLabel(camera),
    wind: rating.wind.label,
    swell: swellLabel(vectors),
    period: rating.period.label,
    reason: decisionReason(rating, fit),
    waveCount: waveCountSlang(camera)
  };
}

export function monitorTileData(camera, index = 0) {
  const decision = surfDecision(camera, index);

  return {
    id: camera.id,
    rank: decision.rank,
    name: camera.name,
    location: decision.location,
    streamUrl: camera.streamUrl || "",
    poster: camera.image || "",
    verdict: decision.verdict,
    wave: decision.wave,
    wind: decision.wind,
    tide: decision.tide,
    period: decision.period,
    confidence: decision.confidence.label,
    waveCount: decision.waveCount
  };
}

export function buildGroupSummary(cameras) {
  const lines = ["Surf monitor shortlist"];

  cameras.forEach((camera, index) => {
    const decision = surfDecision(camera, index);
    lines.push(
      `#${decision.rank} ${decision.name}: ${decision.verdict}. ${decision.wave}, ${decision.wind}, ${decision.period}. ${decision.reason}. Confidence: ${decision.confidence.label}. Wave count: ${decision.waveCount}.`
    );
  });

  return lines.join("\n");
}
