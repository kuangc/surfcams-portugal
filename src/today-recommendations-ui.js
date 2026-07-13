import { SURFLINE_FRESH_MAX_AGE_HOURS } from "./config.js";

const LISBON_TIME_ZONE = "Europe/Lisbon";
export const BEST_BET_LIMIT = 3;

export function formatRecommendationStatus({
  loading = false,
  readyCount = 0,
  totalCandidates = 0,
  visibleBestBets = 0,
  totalBestBets = 0,
  worthChecking = 0,
  hasFreshAnchor = false
} = {}) {
  if (loading) return `Checking today · ${readyCount}/${totalCandidates} spots ready`;

  const bestBets = totalBestBets > visibleBestBets
    ? `${visibleBestBets} Best bets shown from ${totalBestBets} qualifying breaks`
    : `${visibleBestBets} Best bets`;
  const freshness = hasFreshAnchor
    ? `Surfline local-face anchors updated within ${SURFLINE_FRESH_MAX_AGE_HOURS}h`
    : `no Surfline local-face anchor updated within ${SURFLINE_FRESH_MAX_AGE_HOURS}h`;
  return `${bestBets} · ${worthChecking} Worth checking · ${freshness}`;
}

function timestamp(value) {
  const ms = Number.isFinite(value) ? value : Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

export function formatLisbonTime(value) {
  const ms = timestamp(value);
  if (ms === null) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: LISBON_TIME_ZONE
  }).format(new Date(ms)).replace(/\s/g, "").toLowerCase();
}

export function formatWindowCall(window, now = Date.now()) {
  const start = timestamp(window?.start);
  const end = timestamp(window?.end);
  const nowMs = timestamp(now);
  if (start === null || end === null || nowMs === null) return "";
  const range = `${formatLisbonTime(start)}–${formatLisbonTime(end)}`;
  return start <= nowMs + 15 * 60 * 1000 ? `Go now · ${range}` : `Surf ${range}`;
}

export function formatLeaveCall(window, driveMinutes, now = Date.now()) {
  const start = timestamp(window?.start);
  const nowMs = timestamp(now);
  if (start === null || nowMs === null || !Number.isFinite(driveMinutes)) return null;
  const explicitLeaveAt = timestamp(window?.leaveAt);
  const leaveAt = explicitLeaveAt ?? start - (driveMinutes * 60 * 1000);
  return leaveAt <= nowMs + 5 * 60 * 1000 ? "Leave now" : `Leave by ${formatLisbonTime(leaveAt)}`;
}

function cameraUtility(camera) {
  if (camera?.streamUrl) return 3;
  if (camera?.hasStream) return 2;
  if (camera?.surfline?.pageUrl || camera?.pageUrl) return 1;
  return 0;
}

export function selectRecommendationCameras(cameras, {
  subjectIdFor,
  inFence,
  isFavorite
}) {
  const groups = new Map();
  for (const camera of cameras || []) {
    if (!camera || camera.adviceGuideOnly || !inFence(camera)) continue;
    const subjectId = subjectIdFor(camera);
    if (!subjectId) continue;

    const group = groups.get(subjectId) || { favorite: false, representative: null };
    group.favorite ||= isFavorite(camera);
    if (!group.representative || cameraUtility(camera) > cameraUtility(group.representative)) {
      group.representative = camera;
    }
    groups.set(subjectId, group);
  }

  return [...groups.values()]
    .filter((group) => !group.favorite && group.representative)
    .map((group) => group.representative);
}

export function shortlistBestBets(recommendations, limit = BEST_BET_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : BEST_BET_LIMIT;
  return (recommendations || []).slice(0, safeLimit);
}
