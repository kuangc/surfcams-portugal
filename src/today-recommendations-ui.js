const LISBON_TIME_ZONE = "Europe/Lisbon";

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
  return start <= nowMs + 15 * 60 * 1000 ? `Go now · ${range}` : `Best ${range}`;
}

export function formatLeaveCall(window, driveMinutes, now = Date.now()) {
  const start = timestamp(window?.start);
  const nowMs = timestamp(now);
  if (start === null || nowMs === null || !Number.isFinite(driveMinutes)) return null;
  const leaveAt = start - (driveMinutes * 60 * 1000);
  return leaveAt <= nowMs + 5 * 60 * 1000 ? "Leave now" : `Leave by ${formatLisbonTime(leaveAt)}`;
}
