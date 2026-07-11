import { SURFLINE_FRESH_MAX_AGE_HOURS } from "./config.js";
import { findTideSnapshot } from "./tide-data.js";

const TIDE_CACHE_MAX_AGE_HOURS = 48;
const TIDE_TARGET_MAX_HOURS = 6;
const LISBON_TIME_ZONE = "Europe/Lisbon";

const TOPIC_PRIORITY = new Map([
  ["size-translation", 0],
  ["tide", 1],
  ["wind", 2],
  ["swell", 2],
  ["mechanics", 3]
]);
const SCOPE_RANK = new Map([["spot", 2], ["stretch", 1], ["area", 0]]);
const CONFIDENCE_RANK = new Map([["high", 2], ["medium", 1], ["low", 0]]);

function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function readOnlyMap(entries = []) {
  const map = new Map(entries);
  const reject = () => {
    throw new TypeError("This map is read-only");
  };
  Object.defineProperties(map, {
    set: { value: reject },
    delete: { value: reject },
    clear: { value: reject }
  });
  return Object.freeze(map);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeSpotAdviceRuntime(payload = {}) {
  const cloned = deepClone(payload && typeof payload === "object" ? payload : {});
  const subjectEntries = Object.entries(cloned.subjects || {}).map(([id, subject]) => {
    const normalized = deepFreeze({
      ...subject,
      id: subject?.id || id,
      claims: safeArray(subject?.claims),
      decisiveClaims: safeArray(subject?.decisiveClaims),
      conflicts: safeArray(subject?.conflicts),
      overriddenClaimIds: safeArray(subject?.overriddenClaimIds),
      topicIndex: subject?.topicIndex && typeof subject.topicIndex === "object" ? subject.topicIndex : {}
    });
    return [id, normalized];
  });
  const identityReport = deepFreeze({
    selectedSurflineIds: safeArray(cloned.identityReport?.selectedSurflineIds),
    defaultFavoriteIds: safeArray(cloned.identityReport?.defaultFavoriteIds),
    adviceBearingCameraIds: safeArray(cloned.identityReport?.adviceBearingCameraIds),
    byCameraId: cloned.identityReport?.byCameraId && typeof cloned.identityReport.byCameraId === "object"
      ? cloned.identityReport.byCameraId
      : {}
  });

  return Object.freeze({
    schemaVersion: cloned.schemaVersion ?? null,
    sourceDigest: typeof cloned.sourceDigest === "string" ? cloned.sourceDigest : "",
    subjectsById: readOnlyMap(subjectEntries),
    identityByCameraId: readOnlyMap(Object.entries(identityReport.byCameraId)),
    identityReport
  });
}

function runtimeAdvice(spotData) {
  return spotData?.advice?.subjectsById instanceof Map
    ? spotData.advice
    : normalizeSpotAdviceRuntime();
}

export function adviceSubjectIdFor(camera, spotData) {
  const cameraId = typeof camera === "string" ? camera : camera?.id;
  if (!cameraId) return null;
  const advice = runtimeAdvice(spotData);

  if (advice.subjectsById.has(cameraId)) return cameraId;
  const trustedSubjectId = advice.identityByCameraId.get(cameraId);
  return trustedSubjectId && advice.subjectsById.has(trustedSubjectId) ? trustedSubjectId : null;
}

export function resolveAdviceTideCameraId(camera, subject, spotData) {
  const cameraId = typeof camera === "string" ? camera : camera?.id;
  if (!cameraId || !subject || subject.guideOnly) return null;
  if (adviceSubjectIdFor(camera, spotData) !== subject.id) return null;

  if (cameraId !== subject.id) return cameraId;

  const promoted = spotData?.promotedById?.get(cameraId);
  if (promoted?.linkedCamId) return promoted.linkedCamId;
  if (subject.tideCameraId) return subject.tideCameraId;
  return null;
}

function validDateMs(value) {
  const ms = Number.isFinite(value)
    ? value
    : value instanceof Date
      ? value.getTime()
      : Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function ageHours(iso, nowMs) {
  const timestamp = validDateMs(iso);
  return timestamp === null ? null : (nowMs - timestamp) / 3600000;
}

export function tidePhase(events = [], now = new Date()) {
  const nowMs = validDateMs(now);
  if (nowMs === null) return null;
  const normalized = safeArray(events)
    .map((event) => ({ ...event, ms: validDateMs(event?.timeUtc || event?.date) }))
    .filter((event) => event.ms !== null && (event.type === "high" || event.type === "low"))
    .sort((a, b) => a.ms - b.ms);
  const previous = [...normalized].reverse().find((event) => event.ms <= nowMs);
  const next = normalized.find((event) => event.ms > nowMs);
  if (!previous || !next || previous.type === next.type || next.ms <= previous.ms) return null;

  const rawProgress = (nowMs - previous.ms) / (next.ms - previous.ms);
  const progress = Number(rawProgress.toFixed(6));
  const stage = progress < 0.2
    ? previous.type
    : progress > 0.8
      ? next.type
      : "mid";
  return {
    stage,
    direction: next.type === "high" ? "rising" : "falling",
    progress
  };
}

export function findAdviceTideSnapshot(camera, spotData, tideData, now = new Date()) {
  const nowMs = validDateMs(now);
  if (nowMs === null) return null;
  const cacheAge = ageHours(tideData?.generatedAt, nowMs);
  if (cacheAge === null || cacheAge < 0 || cacheAge > TIDE_CACHE_MAX_AGE_HOURS) return null;

  const subjectId = adviceSubjectIdFor(camera, spotData);
  const subject = subjectId ? runtimeAdvice(spotData).subjectsById.get(subjectId) : null;
  const tideCameraId = resolveAdviceTideCameraId(camera, subject, spotData);
  if (!tideCameraId) return null;

  const snapshot = findTideSnapshot({ id: tideCameraId }, tideData, new Date(nowMs));
  if (!snapshot) return null;
  const phase = tidePhase(snapshot.events, new Date(nowMs));
  return phase ? deepFreeze({ ...deepClone(snapshot), phase: deepClone(phase) }) : null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function adviceConditionSnapshot(resolved) {
  const source = resolved && typeof resolved === "object" ? resolved : {};
  return deepFreeze({
    sourceSpotId: typeof source.sourceSpotId === "string" ? source.sourceSpotId : null,
    fetchedAt: typeof source.fetchedAt === "string" ? source.fetchedAt : null,
    ageHours: finiteOrNull(source.ageHours),
    providerSpotSurfMinM: finiteOrNull(source.providerSpotSurfMinM),
    providerSpotSurfMaxM: finiteOrNull(source.providerSpotSurfMaxM),
    primarySwellHeightM: finiteOrNull(source.primarySwellHeightM),
    primarySwellPeriodS: finiteOrNull(source.primarySwellPeriodS),
    primarySwellDirectionDeg: finiteOrNull(source.primarySwellDirectionDeg),
    windKmh: finiteOrNull(source.windKmh),
    windDirectionDeg: finiteOrNull(source.windDirectionDeg ?? source.windDirDeg),
    tide: source.tide && typeof source.tide === "object" ? deepClone(source.tide) : null
  });
}

function isFreshConditionSnapshot(snapshot, nowMs) {
  const fetchedAge = ageHours(snapshot?.fetchedAt, nowMs);
  return Number.isFinite(snapshot?.ageHours)
    && snapshot.ageHours >= 0
    && snapshot.ageHours < SURFLINE_FRESH_MAX_AGE_HOURS
    && fetchedAge !== null
    && fetchedAge >= 0
    && fetchedAge < SURFLINE_FRESH_MAX_AGE_HOURS;
}

function isExpired(claim, nowMs) {
  if (!claim?.revalidateAfter) return false;
  const expiryMs = Date.parse(`${claim.revalidateAfter}T23:59:59.999Z`);
  return Number.isFinite(expiryMs) && nowMs > expiryMs;
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

export function evaluateAdviceRule(claim, snapshot, now = Date.now()) {
  const nowMs = validDateMs(now);
  if (nowMs === null || !claim?.rule || claim.consensus === "unresolved" || isExpired(claim, nowMs)) return "unknown";
  const rule = claim.rule;

  if (rule.type === "minimum") {
    if (!isFreshConditionSnapshot(snapshot, nowMs)) return "unknown";
    const input = rule.input === "primary-swell-height-m" ? snapshot.primarySwellHeightM : null;
    if (!Number.isFinite(input) || !Number.isFinite(rule.value)) return "unknown";
    if (input < rule.value) return rule.effectBelow ? "triggered" : "not-triggered";
    return rule.effectAtOrAbove ? "triggered" : "not-triggered";
  }

  if (rule.type === "direction-preference") {
    if (!isFreshConditionSnapshot(snapshot, nowMs)) return "unknown";
    const input = rule.input === "wind-direction-deg"
      ? snapshot.windDirectionDeg
      : rule.input === "primary-swell-direction-deg"
        ? snapshot.primarySwellDirectionDeg
        : null;
    if (!Number.isFinite(input) || !safeArray(rule.arcs).length) return "unknown";
    return rule.arcs.some((arc) => directionInArc(input, arc)) ? "triggered" : "not-triggered";
  }

  if (rule.type === "tide-preference") {
    if (!snapshot?.tide?.stage) return "unknown";
    const stageMatches = snapshot.tide.stage === rule.stage;
    const directionMatches = !rule.direction || snapshot.tide.direction === rule.direction;
    return stageMatches && directionMatches ? "triggered" : "not-triggered";
  }

  return rule.type === "qualitative" ? "not-triggered" : "unknown";
}

function effectForMinimum(claim, snapshot) {
  const input = snapshot?.primarySwellHeightM;
  if (!Number.isFinite(input) || !Number.isFinite(claim?.rule?.value)) return null;
  return input < claim.rule.value ? claim.rule.effectBelow || null : claim.rule.effectAtOrAbove || null;
}

function readableEffect(effect) {
  const labels = {
    "likely-flat": "likely flat here",
    "may-start-working": "may start working"
  };
  return labels[effect] || String(effect || "").replaceAll("-", " ");
}

function scopeLabel(scope) {
  if (scope?.type === "stretch") return "Stretch pattern";
  if (scope?.type === "area") return "Area pattern";
  return "Spot advice";
}

function compareClaims(a, b) {
  const scopeDelta = (SCOPE_RANK.get(b.scope?.type) ?? -1) - (SCOPE_RANK.get(a.scope?.type) ?? -1);
  if (scopeDelta) return scopeDelta;
  const confidenceDelta = (CONFIDENCE_RANK.get(b.confidence) ?? -1) - (CONFIDENCE_RANK.get(a.confidence) ?? -1);
  if (confidenceDelta) return confidenceDelta;
  const reviewedDelta = (validDateMs(b.reviewedAt) ?? 0) - (validDateMs(a.reviewedAt) ?? 0);
  if (reviewedDelta) return reviewedDelta;
  return String(a.id).localeCompare(String(b.id));
}

function formatLisbonTime(timeMs) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: LISBON_TIME_ZONE
  }).format(new Date(timeMs)).replace(/\s/g, "").toLowerCase();
}

function formatCountdown(deltaMs) {
  const totalMinutes = Math.max(0, Math.round(deltaMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `in ${minutes}m`;
  return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
}

function eventMs(event) {
  return validDateMs(event?.timeUtc || event?.date);
}

function nextTideTarget(rule, tideSnapshot, nowMs) {
  const events = safeArray(tideSnapshot?.events)
    .map((event) => ({ ...event, ms: eventMs(event) }))
    .filter((event) => event.ms !== null && (event.type === "high" || event.type === "low"))
    .sort((a, b) => a.ms - b.ms);
  const candidates = [];

  if (rule.stage === "high" || rule.stage === "low") {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.type !== rule.stage) continue;
      const previous = events[index - 1];
      const direction = previous && previous.type !== event.type
        ? event.type === "high" ? "rising" : "falling"
        : null;
      candidates.push({ ms: event.ms, direction });
    }
  } else if (rule.stage === "mid") {
    for (let index = 0; index < events.length - 1; index += 1) {
      const previous = events[index];
      const next = events[index + 1];
      if (previous.type === next.type) continue;
      candidates.push({
        ms: previous.ms + ((next.ms - previous.ms) / 2),
        direction: next.type === "high" ? "rising" : "falling"
      });
    }
  }

  return candidates.find((candidate) => (
    candidate.ms > nowMs
    && candidate.ms - nowMs <= TIDE_TARGET_MAX_HOURS * 3600000
    && (!rule.direction || rule.direction === candidate.direction)
  )) || null;
}

function targetIsAfterDark(targetMs, tideSnapshot) {
  const firstLight = eventMs(tideSnapshot?.firstLight);
  const lastLight = eventMs(tideSnapshot?.lastLight);
  if (firstLight === null || lastLight === null) return false;
  return targetMs < firstLight || targetMs > lastLight;
}

function lensTextFor(candidate, conditionSnapshot) {
  if (candidate.effect) {
    return `${conditionSnapshot.primarySwellHeightM.toFixed(1)} m primary swell → ${readableEffect(candidate.effect)}`;
  }
  if (candidate.currentTide) {
    const stage = candidate.claim.rule.stage;
    return `${stage[0].toUpperCase()}${stage.slice(1)} tide suits this ${candidate.claim.scope?.type === "spot" ? "spot" : candidate.claim.scope?.type}`;
  }
  return candidate.claim.summary;
}

export function selectLocalLens(camera, spotData, snapshot, tideSnapshot, now = Date.now()) {
  const nowMs = validDateMs(now);
  if (nowMs === null) return null;
  const subjectId = adviceSubjectIdFor(camera, spotData);
  const subject = subjectId ? runtimeAdvice(spotData).subjectsById.get(subjectId) : null;
  if (!subject) return null;

  const conditionSnapshot = adviceConditionSnapshot({
    ...snapshot,
    tide: tideSnapshot?.phase || snapshot?.tide || null
  });
  const candidates = [];
  const decisiveClaims = safeArray(subject.decisiveClaims);

  for (const claim of decisiveClaims) {
    if (!claim?.rule || claim.consensus === "unresolved" || isExpired(claim, nowMs)) continue;
    const result = evaluateAdviceRule(claim, conditionSnapshot, nowMs);
    const topicPriority = TOPIC_PRIORITY.get(claim.topic);
    if (claim.topic === "size-translation" && result === "triggered") {
      candidates.push({ claim, priority: 0, effect: effectForMinimum(claim, conditionSnapshot) });
    } else if (claim.topic === "tide") {
      if (result === "triggered") {
        candidates.push({ claim, priority: 1, currentTide: true });
      } else {
        const target = nextTideTarget(claim.rule, tideSnapshot, nowMs);
        if (target) candidates.push({ claim, priority: 1, target });
      }
    } else if ((claim.topic === "wind" || claim.topic === "swell") && result === "triggered") {
      candidates.push({ claim, priority: 2 });
    } else if (claim.topic === "mechanics" && claim.scope?.type === "spot") {
      candidates.push({ claim, priority: 3 });
    } else if (claim.scope?.type !== "spot" && Number.isFinite(topicPriority)) {
      candidates.push({ claim, priority: 4 });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || compareClaims(a.claim, b.claim));
  const selected = candidates[0];
  if (!selected) return null;

  let text = lensTextFor(selected, conditionSnapshot);
  let targetTimeLabel = null;
  let afterDark = false;
  let countdown = null;
  if (selected.target) {
    targetTimeLabel = formatLisbonTime(selected.target.ms);
    countdown = formatCountdown(selected.target.ms - nowMs);
    afterDark = targetIsAfterDark(selected.target.ms, tideSnapshot);
    text = `${selected.claim.summary} · ${countdown} · ${targetTimeLabel}${afterDark ? " · after dark" : ""}`;
  }

  return deepFreeze({
    subjectId,
    claimId: selected.claim.id,
    topic: selected.claim.topic,
    scope: selected.claim.scope,
    scopeLabel: scopeLabel(selected.claim.scope),
    effect: selected.effect || null,
    text,
    countdown,
    targetTimeLabel,
    afterDark
  });
}

function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function playbookSectionId(topic) {
  if (topic === "size-translation") return "size-here";
  if (["tide", "swell", "wind", "period-energy", "season"].includes(topic)) return "best-window";
  if (topic === "mechanics") return "how-it-breaks";
  return "know-before-you-go";
}

function formatPlaybookClaim(claim, nowMs) {
  return deepFreeze({
    id: claim.id,
    topic: claim.topic,
    summary: claim.summary,
    scope: claim.scope,
    scopeLabel: scopeLabel(claim.scope),
    confidence: claim.confidence,
    reviewedAt: claim.reviewedAt || null,
    revalidateAfter: claim.revalidateAfter || null,
    needsRevalidation: isExpired(claim, nowMs),
    consensus: claim.consensus,
    conflictGroupId: claim.conflictGroupId || null,
    position: claim.position || null,
    provenanceLabel: safeArray(claim.evidence).some((evidence) => evidence.kind === "user-observed")
      ? "Your observation"
      : scopeLabel(claim.scope)
  });
}

export function formatSpotPlaybook(camera, spotData) {
  const subjectId = adviceSubjectIdFor(camera, spotData);
  const subject = subjectId ? runtimeAdvice(spotData).subjectsById.get(subjectId) : null;
  if (!subject) return null;
  const nowMs = Date.now();
  const sectionDefinitions = [
    ["size-here", "Size here"],
    ["best-window", "Best window"],
    ["how-it-breaks", "How it breaks"],
    ["know-before-you-go", "Know before you go"]
  ];
  const formattedClaims = safeArray(subject.claims).map((claim) => ({
    sectionId: playbookSectionId(claim.topic),
    claim: formatPlaybookClaim(claim, nowMs)
  }));
  const sources = [];
  for (const claim of safeArray(subject.claims)) {
    for (const evidence of safeArray(claim.evidence)) {
      sources.push(deepFreeze({
        claimId: claim.id,
        title: evidence.title || "Source",
        publisher: evidence.publisher || "",
        url: safeExternalUrl(evidence.url),
        accessedAt: evidence.accessedAt || null,
        supportedClaim: evidence.supportedClaim || "",
        kind: evidence.kind || "",
        scopeLabel: scopeLabel(claim.scope),
        confidence: claim.confidence,
        needsRevalidation: isExpired(claim, nowMs)
      }));
    }
  }

  const sections = sectionDefinitions.map(([id, title]) => deepFreeze({
    id,
    title,
    claims: formattedClaims.filter((entry) => entry.sectionId === id).map((entry) => entry.claim)
  }));
  sections.push(deepFreeze({ id: "why-we-say-this", title: "Why we say this", claims: [], sources }));

  return deepFreeze({
    subjectId,
    name: subject.name,
    guideOnly: Boolean(subject.guideOnly),
    sections,
    conflicts: deepClone(safeArray(subject.conflicts))
  });
}
