import { LIVE_MODEL_MAX_AGE_HOURS, SURFLINE_FRESH_MAX_AGE_HOURS } from "./config.js";
import { tidePhase } from "./spot-advice.js";
import { getConditionVectors, SURFLINE_RATING_ORDER, windAlignment } from "./surf-rating.js";

const HOUR_MS = 60 * 60 * 1000;
const MIN_WINDOW_MS = 90 * 60 * 1000;
const MIN_USEFUL_WINDOW_MS = 60 * 60 * 1000;
const SESSION_WINDOW_MS = 2 * HOUR_MS;
const HALF_HOUR_MS = 30 * 60 * 1000;
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
const QUALITY_RANK = { poor: 0, possible: 1, good: 2 };

function timestamp(value) {
  const ms = Number.isFinite(value) ? value : Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function isFresh(fetchedAt, now, maxAgeHours) {
  const fetchedMs = timestamp(fetchedAt);
  const nowMs = timestamp(now);
  if (fetchedMs === null || nowMs === null) return false;
  const age = (nowMs - fetchedMs) / HOUR_MS;
  return age >= 0 && age <= maxAgeHours;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sameUtcHour(a, b) {
  const aMs = timestamp(a);
  const bMs = timestamp(b);
  if (aMs === null || bMs === null) return false;
  return new Date(aMs).toISOString().slice(0, 13) === new Date(bMs).toISOString().slice(0, 13);
}

function validSurflineAnchor(conditions, now) {
  return conditions?.source === "surfline-fresh"
    && Number.isFinite(conditions.providerSpotSurfMinM)
    && Number.isFinite(conditions.providerSpotSurfMaxM)
    && conditions.providerSpotSurfMinM >= 0
    && conditions.providerSpotSurfMaxM >= conditions.providerSpotSurfMinM
    && Number.isFinite(conditions.ageHours)
    && conditions.ageHours >= 0
    && conditions.ageHours <= SURFLINE_FRESH_MAX_AGE_HOURS
    && isFresh(conditions.fetchedAt, now, SURFLINE_FRESH_MAX_AGE_HOURS);
}

export function buildLocalFaceCurve({ forecast, conditions, now = Date.now() }) {
  if (!isFresh(forecast?.fetchedAt, now, LIVE_MODEL_MAX_AGE_HOURS)) return [];
  if (!validSurflineAnchor(conditions, now)) return [];

  const hours = Array.isArray(forecast?.hours) ? forecast.hours : [];
  const anchorHour = hours.find((point) => sameUtcHour(point.time, now));
  if (!Number.isFinite(anchorHour?.offshoreWaveM) || anchorHour.offshoreWaveM <= 0) return [];

  return hours.flatMap((point) => {
    if (!Number.isFinite(point?.offshoreWaveM) || point.offshoreWaveM < 0 || timestamp(point.time) === null) return [];
    const ratio = clamp(point.offshoreWaveM / anchorHour.offshoreWaveM, 0.5, 2);
    return [{
      ...point,
      localFaceMinM: round2(conditions.providerSpotSurfMinM * ratio),
      localFaceMaxM: round2(conditions.providerSpotSurfMaxM * ratio),
      source: "surfline-anchored-model",
      confidence: "medium"
    }];
  });
}

function directionInArc(value, arc) {
  if (!Number.isFinite(value) || !Number.isFinite(arc?.start) || !Number.isFinite(arc?.end)) return false;
  const normalized = ((value % 360) + 360) % 360;
  const start = ((arc.start % 360) + 360) % 360;
  const end = ((arc.end % 360) + 360) % 360;
  return start <= end
    ? normalized >= start && normalized <= end
    : normalized >= start || normalized <= end;
}

function readableNumber(value) {
  return Number.isInteger(value) ? String(value) : String(round2(value));
}

function localFaceReason(localFace) {
  return `${localFace.localFaceMinM.toFixed(1)}–${localFace.localFaceMaxM.toFixed(1)} m local estimate`;
}

function confidenceFor(localFace, advice) {
  let confidence = localFace?.confidence || "low";
  if (!advice?.researched || (advice?.conflicts || []).length) return "low";
  if ((advice.claims || []).some((claim) => claim.scope?.type === "area")) return "low";
  if ((advice.claims || []).some((claim) => claim.scope?.type === "stretch")) {
    confidence = CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK.medium ? "medium" : confidence;
  }
  return confidence;
}

function resultFor({ hour, localFace, advice, tide, conditions, eligibility, quality, confidence, primaryReason, reasons }) {
  return {
    time: hour?.time || null,
    eligibility,
    quality,
    confidence,
    primaryReason,
    reasons: [...new Set(reasons.filter(Boolean))].slice(0, 3),
    localFace: localFace ? {
      minM: localFace.localFaceMinM,
      maxM: localFace.localFaceMaxM,
      source: localFace.source
    } : null,
    offshore: hour ? {
      waveM: hour.offshoreWaveM ?? null,
      primarySwellHeightM: hour.primarySwellHeightM ?? null,
      primarySwellPeriodS: hour.primarySwellPeriodS ?? null,
      primarySwellDirectionDeg: hour.primarySwellDirectionDeg ?? null
    } : null,
    wind: hour ? {
      speedKmh: hour.windKmh ?? null,
      directionDeg: hour.windDirectionDeg ?? null
    } : null,
    tide: tide?.stage ? { stage: tide.stage, direction: tide.direction ?? null } : null,
    provider: {
      rating: conditions?.rating ?? null,
      observed: conditions?.ratingObserved === true,
      fetchedAt: conditions?.fetchedAt ?? null
    }
  };
}

export function evaluateTodayHour({
  camera,
  hour,
  localFace,
  preferences,
  advice,
  tide,
  daylight,
  conditions,
  now = Date.now()
}) {
  const confidence = confidenceFor(localFace, advice);
  const base = { hour, localFace, advice, tide, conditions, confidence };
  if (daylight !== true) {
    const unknown = daylight == null;
    return resultFor({ ...base, eligibility: unknown ? "unknown" : "ineligible", quality: "poor", primaryReason: unknown ? "Daylight window is unknown." : "Outside daylight.", reasons: [] });
  }
  if (!localFace || !Number.isFinite(localFace.localFaceMinM) || !Number.isFinite(localFace.localFaceMaxM)) {
    return resultFor({ ...base, eligibility: "unknown", quality: "poor", confidence: "low", primaryReason: "No fresh local face estimate.", reasons: [] });
  }

  const waveInRange = localFace.localFaceMaxM >= preferences.minSurfHeightM
    && localFace.localFaceMinM <= preferences.maxSurfHeightM;
  if (!waveInRange) {
    const oversized = localFace.localFaceMinM > preferences.maxSurfHeightM;
    const primaryReason = oversized
      ? `Local estimate is above your ${preferences.maxSurfHeightM} m maximum.`
      : `Local estimate is below your ${preferences.minSurfHeightM} m minimum.`;
    return resultFor({ ...base, eligibility: "ineligible", quality: "poor", primaryReason, reasons: [localFaceReason(localFace)] });
  }

  const claims = advice?.claims || [];
  for (const claim of claims.filter((candidate) => candidate.rule?.type === "minimum")) {
    const input = claim.rule.input === "primary-swell-height-m" ? hour?.primarySwellHeightM : null;
    if (!Number.isFinite(input)) {
      return resultFor({ ...base, eligibility: "unknown", quality: "poor", confidence: "low", primaryReason: "Primary swell height is missing for a reviewed local gate.", reasons: [localFaceReason(localFace)] });
    }
    if (input < claim.rule.value) {
      const primaryReason = `Needs ${readableNumber(claim.rule.value)} m primary swell before it works here.`;
      return resultFor({ ...base, eligibility: "ineligible", quality: "poor", primaryReason, reasons: [primaryReason, localFaceReason(localFace)] });
    }
  }

  const rating = String(conditions?.rating || "").toUpperCase();
  const providerPoor = rating === "POOR" || rating === "VERY_POOR";
  const providerApplies = sameUtcHour(hour?.time, now);
  if (providerPoor && conditions?.ratingObserved === true && providerApplies) {
    const primaryReason = `Observed provider report is ${rating.toLowerCase().replaceAll("_", " ")}.`;
    return resultFor({ ...base, eligibility: "ineligible", quality: "poor", primaryReason, reasons: [primaryReason, localFaceReason(localFace)] });
  }

  let quality = "good";
  let primaryReason = "Conditions line up for this hour.";
  const reasons = [localFaceReason(localFace)];
  const tideClaim = claims.find((claim) => claim.rule?.type === "tide-preference");
  if (tideClaim) {
    const matchesStage = tide?.stage === tideClaim.rule.stage;
    const matchesDirection = !tideClaim.rule.direction || tide?.direction === tideClaim.rule.direction;
    if (!matchesStage || !matchesDirection) {
      quality = "possible";
      primaryReason = `${tideClaim.rule.stage[0].toUpperCase()}${tideClaim.rule.stage.slice(1)} tide is the reviewed local window.`;
    } else {
      reasons.push(`${tideClaim.rule.stage[0].toUpperCase()}${tideClaim.rule.stage.slice(1)} tide matches local advice`);
    }
  }

  for (const claim of claims.filter((candidate) => candidate.rule?.type === "direction-preference")) {
    const value = claim.rule.input === "wind-direction-deg"
      ? hour?.windDirectionDeg
      : hour?.primarySwellDirectionDeg;
    const matches = Number.isFinite(value) && (claim.rule.arcs || []).some((arc) => directionInArc(value, arc));
    if (!matches) {
      quality = "possible";
      if (primaryReason === "Conditions line up for this hour.") primaryReason = `${claim.topic === "wind" ? "Wind" : "Swell"} direction is outside the reviewed preference.`;
    }
  }

  const coastBearing = getConditionVectors(camera).coast.bearing;
  const alignment = windAlignment(hour?.windDirectionDeg, coastBearing);
  const lightWind = Number.isFinite(hour?.windKmh) && hour.windKmh <= preferences.maxWindSpeedKmh;
  const windOk = alignment === "offshore" || (preferences.allowLightWind && lightWind);
  if (!windOk) {
    quality = "possible";
    if (primaryReason === "Conditions line up for this hour.") primaryReason = Number.isFinite(hour?.windKmh)
      ? `${readableNumber(hour.windKmh)} km/h ${alignment} wind is marginal.`
      : "Wind is unknown.";
  } else {
    reasons.push(alignment === "offshore" ? "Offshore wind" : "Light wind");
  }

  if (!Number.isFinite(hour?.primarySwellPeriodS) || hour.primarySwellPeriodS < preferences.minPeriodSeconds) {
    quality = "possible";
    if (primaryReason === "Conditions line up for this hour.") primaryReason = Number.isFinite(hour?.primarySwellPeriodS)
      ? `${readableNumber(hour.primarySwellPeriodS)} s period is below your preference.`
      : "Primary swell period is unknown.";
  }

  if (providerPoor && providerApplies) {
    quality = "possible";
    if (primaryReason === "Conditions line up for this hour.") primaryReason = `Modeled provider rating is ${rating.toLowerCase().replaceAll("_", " ")}.`;
  } else if (providerApplies && SURFLINE_RATING_ORDER.indexOf(rating) >= SURFLINE_RATING_ORDER.indexOf("FAIR")) {
    reasons.push(`Surfline ${rating.toLowerCase().replaceAll("_", " ")}`);
  }

  return resultFor({ ...base, eligibility: "eligible", quality, primaryReason, reasons });
}

function lowerConfidence(a, b) {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

function hasReason(evaluation, pattern) {
  return (evaluation?.reasons || []).some((reason) => pattern.test(reason));
}

function compareSessionHours(a, b) {
  const supportingObservationA = a?.provider?.observed === true && hasReason(a, /^Surfline /i);
  const supportingObservationB = b?.provider?.observed === true && hasReason(b, /^Surfline /i);
  const tideMatchA = hasReason(a, /tide matches local advice/i);
  const tideMatchB = hasReason(b, /tide matches local advice/i);
  const offshoreA = hasReason(a, /^Offshore wind$/i);
  const offshoreB = hasReason(b, /^Offshore wind$/i);
  const providerSupportA = hasReason(a, /^Surfline /i);
  const providerSupportB = hasReason(b, /^Surfline /i);
  const windA = Number.isFinite(a?.wind?.speedKmh) ? a.wind.speedKmh : Infinity;
  const windB = Number.isFinite(b?.wind?.speedKmh) ? b.wind.speedKmh : Infinity;
  const periodA = Number.isFinite(a?.offshore?.primarySwellPeriodS) ? a.offshore.primarySwellPeriodS : -Infinity;
  const periodB = Number.isFinite(b?.offshore?.primarySwellPeriodS) ? b.offshore.primarySwellPeriodS : -Infinity;

  return Number(supportingObservationB) - Number(supportingObservationA)
    || Number(tideMatchB) - Number(tideMatchA)
    || Number(offshoreB) - Number(offshoreA)
    || Number(providerSupportB) - Number(providerSupportA)
    || windA - windB
    || periodB - periodA
    || timestamp(a?.time) - timestamp(b?.time);
}

export function buildSurfWindows(evaluations, { now = Date.now(), lastLight = Infinity } = {}) {
  const good = (evaluations || [])
    .filter((evaluation) => evaluation.quality === "good")
    .sort((a, b) => timestamp(a.time) - timestamp(b.time));
  const groups = [];
  for (const evaluation of good) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || timestamp(evaluation.time) - timestamp(previous.time) > HOUR_MS) {
      groups.push([evaluation]);
    } else {
      groups.at(-1).push(evaluation);
    }
  }

  const nowMs = timestamp(now) ?? -Infinity;
  const lastLightMs = timestamp(lastLight) ?? Infinity;
  return groups.flatMap((group) => {
    const rawStart = timestamp(group[0].time) - HALF_HOUR_MS;
    const rawEnd = timestamp(group.at(-1).time) + HALF_HOUR_MS;
    if (rawEnd - rawStart < MIN_WINDOW_MS) return [];
    const start = Math.max(rawStart, nowMs);
    const end = Math.min(rawEnd, lastLightMs);
    if (end <= start) return [];
    const confidence = group.reduce((current, evaluation) => lowerConfidence(current, evaluation.confidence), "high");
    return [{
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      confidence,
      reasons: [...new Set(group.flatMap((evaluation) => evaluation.reasons || []))].slice(0, 3),
      hours: group
    }];
  });
}

function reachableSurfWindow(window, {
  now,
  driveMinutes,
  setupMinutes
}) {
  const conditionStart = timestamp(window?.start);
  const end = timestamp(window?.end);
  const nowMs = timestamp(now);
  if (conditionStart === null || end === null || nowMs === null) return null;

  const hasDriveEstimate = Number.isFinite(driveMinutes) && driveMinutes >= 0;
  const safeSetupMinutes = Number.isFinite(setupMinutes) && setupMinutes >= 0 ? setupMinutes : 15;
  const earliestReachable = hasDriveEstimate
    ? nowMs + ((driveMinutes + safeSetupMinutes) * 60 * 1000)
    : nowMs;
  const availableStart = Math.max(conditionStart, earliestReachable);
  const availableMs = end - availableStart;
  if (availableMs < MIN_USEFUL_WINDOW_MS) return null;

  const reachableHours = (window.hours || []).filter((hour) => {
    const hourMs = timestamp(hour.time);
    return hourMs !== null
      && hourMs + HALF_HOUR_MS >= availableStart
      && hourMs - HALF_HOUR_MS <= end;
  });
  const representativeHour = [...reachableHours].sort(compareSessionHours)[0]
    || (window.hours || []).at(-1)
    || null;
  const sessionMs = Math.min(SESSION_WINDOW_MS, availableMs);
  const latestStart = end - sessionMs;
  const idealStart = timestamp(representativeHour?.time) === null
    ? availableStart
    : timestamp(representativeHour.time) - HOUR_MS;
  const surfStart = clamp(idealStart, availableStart, latestStart);
  const surfEnd = surfStart + sessionMs;
  const selectedHours = (window.hours || []).filter((hour) => {
    const hourMs = timestamp(hour.time);
    return hourMs !== null && hourMs >= surfStart && hourMs <= surfEnd;
  });

  return {
    ...window,
    conditionStart: new Date(conditionStart).toISOString(),
    conditionEnd: new Date(end).toISOString(),
    start: new Date(surfStart).toISOString(),
    end: new Date(surfEnd).toISOString(),
    leaveAt: hasDriveEstimate
      ? new Date(surfStart - ((driveMinutes + safeSetupMinutes) * 60 * 1000)).toISOString()
      : null,
    usefulMinutes: Math.round(sessionMs / (60 * 1000)),
    hours: selectedHours,
    representativeHour,
    reasons: representativeHour?.reasons || window.reasons
  };
}

function compareSurfWindows(a, b) {
  return compareSessionHours(a?.representativeHour, b?.representativeHour)
    || CONFIDENCE_RANK[b?.confidence] - CONFIDENCE_RANK[a?.confidence]
    || timestamp(a?.start) - timestamp(b?.start);
}

function daylightBounds(tide) {
  return {
    firstLight: timestamp(tide?.firstLight?.timeUtc),
    lastLight: timestamp(tide?.lastLight?.timeUtc)
  };
}

function evaluationInDaylight(point, tide) {
  const pointMs = timestamp(point?.time);
  const { firstLight, lastLight } = daylightBounds(tide);
  if (pointMs === null || firstLight === null || lastLight === null) return null;
  return pointMs >= firstLight && pointMs <= lastLight;
}

function primaryExclusion(evaluations) {
  const best = [...evaluations].sort((a, b) => (
    QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]
    || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
    || timestamp(a.time) - timestamp(b.time)
  ))[0];
  if (!best) return "No daylight forecast hours remaining.";
  if (best.quality === "good" && best.confidence === "low") return "Evidence confidence is too low for Best bets.";
  if (best.quality === "good") return "The good signal is too brief to form a trustworthy window.";
  return best.primaryReason;
}

function providerRank(conditions) {
  return SURFLINE_RATING_ORDER.indexOf(String(conditions?.rating || "").toUpperCase());
}

function confirmingObservationRank(recommendation) {
  const representative = recommendation?.bestWindow?.representativeHour;
  return representative?.provider?.observed === true
    && hasReason(representative, /^Surfline /i)
    && providerRank(representative.provider) >= SURFLINE_RATING_ORDER.indexOf("FAIR")
    ? 1
    : 0;
}

function compareRecommendations(a, b) {
  return confirmingObservationRank(b) - confirmingObservationRank(a)
    || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
    || Number(Number.isFinite(b.driveMinutes)) - Number(Number.isFinite(a.driveMinutes))
    || compareSessionHours(a?.bestWindow?.representativeHour, b?.bestWindow?.representativeHour)
    || (b.bestWindow.usefulMinutes || 0) - (a.bestWindow.usefulMinutes || 0)
    || timestamp(a.bestWindow.start) - timestamp(b.bestWindow.start)
    || b.bestWindow.hours.length - a.bestWindow.hours.length
    || (Number.isFinite(a.driveMinutes) ? a.driveMinutes : Infinity) - (Number.isFinite(b.driveMinutes) ? b.driveMinutes : Infinity)
    || String(a.camera.id).localeCompare(String(b.camera.id));
}

export function recommendTodaySpots(candidates, preferences, { now = Date.now() } = {}) {
  const bestBets = [];
  const worthChecking = [];
  const nowMs = timestamp(now);
  const currentHourStart = nowMs === null ? -Infinity : Date.parse(new Date(nowMs).toISOString().slice(0, 13) + ":00:00.000Z");

  for (const candidate of candidates || []) {
    const curve = buildLocalFaceCurve({ forecast: candidate.forecast, conditions: candidate.conditions, now });
    if (!curve.length) {
      const staleForecast = !isFresh(candidate.forecast?.fetchedAt, now, LIVE_MODEL_MAX_AGE_HOURS);
      worthChecking.push({
        ...candidate,
        quality: "poor",
        confidence: "low",
        evaluations: [],
        primaryReason: staleForecast ? "No fresh hourly forecast." : "No fresh local face estimate."
      });
      continue;
    }

    const { lastLight } = daylightBounds(candidate.tide);
    const evaluations = curve
      .filter((point) => {
        const pointMs = timestamp(point.time);
        return pointMs !== null
          && pointMs >= currentHourStart
          && (lastLight === null || pointMs <= lastLight);
      })
      .map((point) => evaluateTodayHour({
        camera: candidate.camera,
        hour: point,
        localFace: point,
        preferences,
        advice: candidate.advice,
        tide: tidePhase(candidate.tide?.events || [], new Date(point.time)),
        daylight: evaluationInDaylight(point, candidate.tide),
        conditions: candidate.conditions,
        now
      }));
    const windows = buildSurfWindows(evaluations, { now, lastLight });
    const reachableWindows = windows.flatMap((window) => {
      const reachable = reachableSurfWindow(window, {
        now,
        driveMinutes: candidate.driveMinutes,
        setupMinutes: preferences.setupMinutes
      });
      return reachable ? [reachable] : [];
    });
    const qualifying = reachableWindows
      .filter((window) => ["high", "medium"].includes(window.confidence))
      .sort(compareSurfWindows);

    if (qualifying.length) {
      const bestWindow = qualifying[0];
      bestBets.push({
        ...candidate,
        quality: "good",
        confidence: bestWindow.confidence,
        reasons: bestWindow.reasons,
        evaluations,
        windows: qualifying,
        bestWindow
      });
    } else {
      const bestEvaluation = [...evaluations].sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])[0];
      worthChecking.push({
        ...candidate,
        quality: bestEvaluation?.quality || "poor",
        confidence: bestEvaluation?.confidence || "low",
        evaluations,
        primaryReason: windows.length && !reachableWindows.length
          ? "The remaining good window is too short after the drive."
          : primaryExclusion(evaluations)
      });
    }
  }

  bestBets.sort(compareRecommendations);
  worthChecking.sort((a, b) => (
    QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]
    || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
    || (Number.isFinite(a.driveMinutes) ? a.driveMinutes : Infinity) - (Number.isFinite(b.driveMinutes) ? b.driveMinutes : Infinity)
    || String(a.camera.id).localeCompare(String(b.camera.id))
  ));
  return { bestBets, worthChecking };
}
