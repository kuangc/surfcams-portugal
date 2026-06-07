const GROUP_MIN_WAVE_M = 0.3;
const GROUP_MAX_WAVE_M = 1.5;

const SOUTH_FACING_REGIONS = new Set([
  "algarve",
  "cascais",
  "oeiras",
  "sesimbra",
  "setubal"
]);

const UNKNOWN_EXPOSURE_REGIONS = new Set([
  "fluviaispiscinas",
  "ilhas",
  "lagos-e-rios"
]);

const WEST_FACING_SPOT_EXPOSURE = {
  key: "west-facing",
  label: "West-facing Atlantic coast",
  shortLabel: "W-facing",
  bearing: 270,
  confidence: "spot"
};

const SPOT_MECHANICS = new Map([
  [
    "praia-sesimbra",
    {
      exposure: {
        key: "sheltered-south-bay",
        label: "Protected south-facing bay",
        shortLabel: "Sheltered bay",
        bearing: 180,
        confidence: "spot"
      },
      offshoreDegrees: [315, 0, 45],
      swellExposure: [
        { direction: 270, factor: 0.28 },
        { direction: 315, factor: 0.28 },
        { direction: 225, factor: 0.45 },
        { direction: 180, factor: 0.9 }
      ],
      shelteredCapScore: 40
    }
  ],
  [
    "portinho-da-arrabida",
    {
      exposure: {
        key: "sheltered-south-cove",
        label: "Protected south-facing cove",
        shortLabel: "Sheltered cove",
        bearing: 180,
        confidence: "spot"
      },
      offshoreDegrees: [315, 0, 45],
      swellExposure: [
        { direction: 270, factor: 0.18 },
        { direction: 315, factor: 0.18 },
        { direction: 225, factor: 0.3 },
        { direction: 180, factor: 0.75 }
      ],
      shelteredCapScore: 35
    }
  ],
  [
    "lagoa-de-albufeira",
    {
      exposure: WEST_FACING_SPOT_EXPOSURE,
      offshoreDegrees: [45, 90, 135]
    }
  ],
  [
    "praia-do-meco",
    {
      exposure: WEST_FACING_SPOT_EXPOSURE,
      offshoreDegrees: [45, 90, 135]
    }
  ],
  [
    "praia-das-bicas",
    {
      exposure: WEST_FACING_SPOT_EXPOSURE,
      offshoreDegrees: [45, 90, 135]
    }
  ]
]);

const RATING_SCALE = [
  {
    key: "very-poor",
    label: "Very Poor",
    barCount: 1,
    minimumSortScore: 0,
    definition: "Unfavorable for this group: little useful surf, poor shape, or strong onshore/unknown conditions."
  },
  {
    key: "poor",
    label: "Poor",
    barCount: 2,
    minimumSortScore: 25,
    definition: "Mostly weak or compromised conditions, with only occasional rideable waves for this group."
  },
  {
    key: "poor-to-fair",
    label: "Poor to Fair",
    barCount: 3,
    minimumSortScore: 45,
    definition: "Mixed conditions: some pieces line up, but wave size, wind, or period still limits the session."
  },
  {
    key: "fair",
    label: "Fair",
    barCount: 4,
    minimumSortScore: 62,
    definition: "Usable, average surf for this group, with mostly rideable waves if the camera looks clean."
  },
  {
    key: "fair-to-good",
    label: "Fair to Good",
    barCount: 5,
    minimumSortScore: 75,
    definition: "Best model match here: in-range waves with offshore or light wind and enough period to investigate."
  }
];

const DIRECTION_DEGREES = {
  north: 0,
  norte: 0,
  northeast: 45,
  nordeste: 45,
  east: 90,
  este: 90,
  leste: 90,
  southeast: 135,
  sudeste: 135,
  south: 180,
  sul: 180,
  southwest: 225,
  sudoeste: 225,
  west: 270,
  oeste: 270,
  northwest: 315,
  noroeste: 315
};

const DIRECTION_LABELS = {
  north: "N",
  norte: "N",
  northeast: "NE",
  nordeste: "NE",
  east: "E",
  este: "E",
  leste: "E",
  southeast: "SE",
  sudeste: "SE",
  south: "S",
  sul: "S",
  southwest: "SW",
  sudoeste: "SW",
  west: "W",
  oeste: "W",
  northwest: "NW",
  noroeste: "NW"
};

export function parseMetricNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const match = String(value || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const number = Number.parseFloat(match[0]);
  return Number.isFinite(number) ? number : null;
}

function normalizeDirection(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
}

function directionDegrees(value) {
  const direction = normalizeDirection(value);
  return Number.isFinite(DIRECTION_DEGREES[direction]) ? DIRECTION_DEGREES[direction] : null;
}

function directionLabel(value) {
  const direction = normalizeDirection(value);
  return DIRECTION_LABELS[direction] || String(value || "").trim();
}

function circularDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function travelBearing(fromBearing) {
  return Number.isFinite(fromBearing) ? (fromBearing + 180) % 360 : null;
}

function spotMechanics(camera) {
  return SPOT_MECHANICS.get(camera.id) || null;
}

function offshoreDegreesFor(camera) {
  const mechanics = spotMechanics(camera);
  if (mechanics?.offshoreDegrees) return mechanics.offshoreDegrees;
  if (UNKNOWN_EXPOSURE_REGIONS.has(camera.region)) return null;

  return SOUTH_FACING_REGIONS.has(camera.region)
    ? [315, 0, 45]
    : [45, 90, 135];
}

export function describeCoastExposure(camera) {
  const mechanics = spotMechanics(camera);
  if (mechanics?.exposure) return { ...mechanics.exposure };

  if (UNKNOWN_EXPOSURE_REGIONS.has(camera.region)) {
    return {
      key: "unknown",
      label: "Unknown coast exposure",
      shortLabel: "Exposure unknown",
      bearing: null,
      confidence: "unknown"
    };
  }

  if (SOUTH_FACING_REGIONS.has(camera.region)) {
    return {
      key: "south-facing",
      label: "South-facing coast",
      shortLabel: "S-facing",
      bearing: 180,
      confidence: "regional"
    };
  }

  return {
    key: "west-facing",
    label: "West-facing Atlantic coast",
    shortLabel: "W-facing",
    bearing: 270,
    confidence: "regional"
  };
}

function closestSwellExposureRule(rules, swellBearing) {
  if (!Array.isArray(rules) || !Number.isFinite(swellBearing)) return null;

  return rules
    .map((rule) => ({
      ...rule,
      distance: circularDistance(swellBearing, rule.direction)
    }))
    .sort((a, b) => a.distance - b.distance)
    .at(0);
}

function estimateBreakingSurf(camera, rawHeightM, rawSwellDirection) {
  const mechanics = spotMechanics(camera);
  const swellBearing = directionDegrees(rawSwellDirection);
  const exposureRule = closestSwellExposureRule(mechanics?.swellExposure, swellBearing);

  if (!Number.isFinite(rawHeightM) || !exposureRule) {
    return {
      heightM: rawHeightM,
      rawHeightM,
      estimated: false,
      factor: 1,
      capScore: null
    };
  }

  return {
    heightM: Math.round(rawHeightM * exposureRule.factor * 10) / 10,
    rawHeightM,
    estimated: true,
    factor: exposureRule.factor,
    capScore: mechanics.shelteredCapScore || null
  };
}

function windAlignment(camera, windDirection) {
  const degrees = directionDegrees(windDirection);
  if (!Number.isFinite(degrees)) return "unknown";

  const offshoreDegrees = offshoreDegreesFor(camera);
  if (!offshoreDegrees) return "unknown";

  const offshoreDistance = Math.min(...offshoreDegrees.map((offshore) => circularDistance(degrees, offshore)));
  if (offshoreDistance <= 45) return "offshore";

  const onshoreDistance = Math.min(...offshoreDegrees.map((offshore) => circularDistance(degrees, (offshore + 180) % 360)));
  if (onshoreDistance <= 45) return "onshore";

  return "cross";
}

function waveScore(heightM) {
  if (!Number.isFinite(heightM)) return 10;
  if (heightM >= GROUP_MIN_WAVE_M && heightM <= GROUP_MAX_WAVE_M) return 42;
  if (heightM >= 0.2 && heightM < GROUP_MIN_WAVE_M) return 24;
  if (heightM > GROUP_MAX_WAVE_M && heightM <= 1.8) return 24;
  if (heightM > 1.8 && heightM <= 2.2) return 12;
  return 4;
}

function windSpeedScore(speedKmh) {
  if (!Number.isFinite(speedKmh)) return 6;
  if (speedKmh <= 8) return 18;
  if (speedKmh <= 12) return 15;
  if (speedKmh <= 16) return 11;
  if (speedKmh <= 22) return 6;
  return 1;
}

function windDirectionScore(alignment) {
  if (alignment === "offshore") return 22;
  if (alignment === "cross") return 10;
  if (alignment === "onshore") return 2;
  return 7;
}

function periodScore(periodSeconds) {
  if (!Number.isFinite(periodSeconds)) return 5;
  if (periodSeconds >= 10) return 14;
  if (periodSeconds >= 8) return 11;
  if (periodSeconds >= 6) return 7;
  return 3;
}

function roundOne(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${roundOne(value)}m` : "No wave reading";
}

function formatWind(value) {
  return Number.isFinite(value) ? `${roundOne(value)} km/h` : "No wind speed";
}

function ratingLabel(score) {
  return RATING_SCALE
    .filter((rating) => score >= rating.minimumSortScore)
    .at(-1);
}

function capForPeriod(score, periodSeconds) {
  if (!Number.isFinite(periodSeconds)) return score;
  if (periodSeconds < 4) return Math.min(score, 58);
  if (periodSeconds < 6) return Math.min(score, 68);
  return score;
}

function capForWindAlignment(score, alignment) {
  if (alignment === "offshore") return score;
  if (alignment === "cross" || alignment === "unknown") return Math.min(score, 72);
  if (alignment === "onshore") return Math.min(score, 55);
  return score;
}

function capForShelter(score, surfEstimate) {
  if (
    surfEstimate.estimated &&
    Number.isFinite(surfEstimate.capScore) &&
    surfEstimate.factor <= 0.35 &&
    surfEstimate.heightM <= 0.6
  ) {
    return Math.min(score, surfEstimate.capScore);
  }

  return score;
}

function waveReason(surfEstimate) {
  const { heightM, rawHeightM, estimated } = surfEstimate;

  if (!Number.isFinite(heightM)) return "No wave-height reading";
  if (estimated) {
    return `Protected bay: ${formatMeters(rawHeightM)} swell likely breaks closer to ${formatMeters(heightM)} surf`;
  }
  if (heightM >= GROUP_MIN_WAVE_M && heightM <= GROUP_MAX_WAVE_M) {
    return `${formatMeters(heightM)} waves in your 0.3-1.5m window`;
  }
  if (heightM < GROUP_MIN_WAVE_M) return `${formatMeters(heightM)} is below your wave window`;
  return `${formatMeters(heightM)} is above your 1.5m comfort range`;
}

function windReason(alignment, speedKmh, label) {
  const speed = formatWind(speedKmh);
  const direction = label ? ` ${label}` : "";

  if (alignment === "offshore" && Number.isFinite(speedKmh) && speedKmh <= 12) {
    return `Light offshore wind (${speed}${direction})`;
  }
  if (alignment === "offshore") return `Offshore wind, but ${speed} may add texture`;
  if (alignment === "cross") return `Cross-shore wind (${speed}${direction})`;
  if (alignment === "onshore") return `Onshore wind (${speed}${direction})`;
  return "Wind direction unavailable";
}

function periodReason(periodSeconds) {
  if (!Number.isFinite(periodSeconds)) return "No swell-period reading";
  if (periodSeconds >= 10) return `${roundOne(periodSeconds)}s period adds useful push`;
  if (periodSeconds >= 8) return `${roundOne(periodSeconds)}s period is workable`;
  return `${roundOne(periodSeconds)}s period is short, so expect less power`;
}

export function rateSurfSpot(camera) {
  const rawHeightM = parseMetricNumber(camera.forecast?.wave || camera.detailMetrics?.["Ondulação"]);
  const windSpeedKmh = parseMetricNumber(camera.forecast?.wind || camera.detailMetrics?.["Vento"]);
  const periodSeconds = parseMetricNumber(camera.detailMetrics?.["Período das ondas"]);
  const rawWindDirection = camera.forecast?.windDirection || camera.detailMetrics?.["Direção do vento"];
  const rawSwellDirection = camera.detailMetrics?.["Direção das ondas"];
  const surfEstimate = estimateBreakingSurf(camera, rawHeightM, rawSwellDirection);
  const heightM = surfEstimate.heightM;
  const windDirectionLabel = directionLabel(rawWindDirection);
  const alignment = windAlignment(camera, rawWindDirection);

  const rawScore = Math.max(0, Math.min(100, Math.round(
    6 +
    waveScore(heightM) +
    windSpeedScore(windSpeedKmh) +
    windDirectionScore(alignment) +
    periodScore(periodSeconds)
  )));
  const sortScore = capForShelter(capForWindAlignment(capForPeriod(rawScore, periodSeconds), alignment), surfEstimate);
  const rating = ratingLabel(sortScore);
  const inRange = Number.isFinite(heightM) && heightM >= GROUP_MIN_WAVE_M && heightM <= GROUP_MAX_WAVE_M;
  const hasGroupWind = alignment === "offshore" && (!Number.isFinite(windSpeedKmh) || windSpeedKmh <= 18);

  return {
    key: rating.key,
    label: rating.label,
    barCount: rating.barCount,
    definition: rating.definition,
    sortScore,
    isRecommended: sortScore >= 60 && inRange && hasGroupWind,
    wave: {
      heightM,
      rawHeightM,
      inRange,
      estimated: surfEstimate.estimated,
      label: surfEstimate.estimated ? `~${formatMeters(heightM)} surf` : formatMeters(heightM)
    },
    wind: {
      speedKmh: windSpeedKmh,
      direction: normalizeDirection(rawWindDirection),
      directionLabel: windDirectionLabel,
      alignment,
      label: `${formatWind(windSpeedKmh)}${windDirectionLabel ? ` ${windDirectionLabel}` : ""}`
    },
    period: {
      seconds: periodSeconds,
      label: Number.isFinite(periodSeconds) ? `${roundOne(periodSeconds)}s` : "No period"
    },
    reasons: [
      waveReason(surfEstimate),
      windReason(alignment, windSpeedKmh, windDirectionLabel),
      periodReason(periodSeconds)
    ]
  };
}

export function getConditionVectors(camera) {
  const exposure = describeCoastExposure(camera);
  const rawWindDirection = camera.forecast?.windDirection || camera.detailMetrics?.["Direção do vento"];
  const rawSwellDirection = camera.detailMetrics?.["Direção das ondas"];
  const windBearing = directionDegrees(rawWindDirection);
  const swellBearing = directionDegrees(rawSwellDirection);

  return {
    coast: {
      label: exposure.label,
      shortLabel: exposure.shortLabel,
      bearing: exposure.bearing,
      confidence: exposure.confidence
    },
    wind: {
      label: Number.isFinite(windBearing) ? `Wind from ${directionLabel(rawWindDirection)}` : "Wind direction unknown",
      bearing: windBearing,
      arrowBearing: travelBearing(windBearing),
      alignment: windAlignment(camera, rawWindDirection)
    },
    swell: {
      label: Number.isFinite(swellBearing) ? `Swell from ${directionLabel(rawSwellDirection)}` : "Swell direction unknown",
      bearing: swellBearing,
      arrowBearing: travelBearing(swellBearing)
    }
  };
}

export function compareSurfFit(a, b) {
  const scoreDelta = rateSurfSpot(b).sortScore - rateSurfSpot(a).sortScore;
  if (scoreDelta !== 0) return scoreDelta;

  return String(a.name || "").localeCompare(String(b.name || ""));
}
