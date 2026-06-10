import { PORTUGAL_TIDES_URL } from "./config.js";

const TIDE_EVENT_LABELS = {
  high: "High",
  low: "Low"
};

function normalizePortId(value) {
  return value === null || value === undefined ? "" : String(value);
}

function parseGeomarDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeType(value) {
  const key = String(value || "").trim().toUpperCase();
  if (key === "PM") return "high";
  if (key === "BM") return "low";
  if (key === "HIGH" || key === "LOW") return key.toLowerCase();
  return "";
}

function normalizeEvent(event) {
  const type = normalizeType(event?.type || event?.tide);
  const date = event?.timeUtc ? parseGeomarDate(event.timeUtc) : parseGeomarDate(event?.date);
  const heightM = Number(event?.heightM ?? event?.height);

  if (!type || !date) return null;

  return {
    type,
    timeUtc: date.toISOString(),
    heightM: Number.isFinite(heightM) ? heightM : null,
    portId: normalizePortId(event?.portId ?? event?.portCode),
    moon: String(event?.moon || "")
  };
}

export function normalizeGeomarExtremes(events = []) {
  return events
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => new Date(a.timeUtc) - new Date(b.timeUtc));
}

export function normalizeTideCache(cache = {}) {
  const cameraStations = cache.cameraStations || {};
  const eventsByPort = cache.eventsByPort || {};

  return {
    ...cache,
    stationsByCameraId: new Map(
      Object.entries(cameraStations).map(([cameraId, station]) => [
        cameraId,
        {
          ...station,
          portId: normalizePortId(station?.portId)
        }
      ])
    ),
    eventsByPortId: new Map(
      Object.entries(eventsByPort).map(([portId, events]) => [
        normalizePortId(portId),
        normalizeGeomarExtremes(events)
      ])
    )
  };
}

export function emptyTideData() {
  return normalizeTideCache();
}

function eventTime(event) {
  return new Date(event.timeUtc).getTime();
}

function inferTideState(events, now) {
  const nowMs = now.getTime();
  const previous = [...events].reverse().find((event) => eventTime(event) <= nowMs);
  const next = events.find((event) => eventTime(event) > nowMs);
  const nearExtremeMs = 45 * 60 * 1000;

  if (previous && nowMs - eventTime(previous) <= nearExtremeMs) {
    return TIDE_EVENT_LABELS[previous.type];
  }

  if (next && eventTime(next) - nowMs <= nearExtremeMs) {
    return TIDE_EVENT_LABELS[next.type];
  }

  if (next) return next.type === "high" ? "Rising" : "Falling";
  if (previous) return previous.type === "high" ? "Falling" : "Rising";
  return "";
}

export function findTideSnapshot(camera, tideData, now = new Date()) {
  const normalized = tideData?.stationsByCameraId ? tideData : normalizeTideCache(tideData);
  const station = normalized.stationsByCameraId.get(camera?.id);
  if (!station) return null;

  const events = normalized.eventsByPortId.get(normalizePortId(station.portId)) || [];
  if (!events.length) return null;

  const nowMs = now.getTime();
  const nextHigh = events.find((event) => event.type === "high" && eventTime(event) > nowMs) || null;

  return {
    station,
    events,
    stateLabel: inferTideState(events, now),
    nextHigh
  };
}

export function formatTideEventTime(event, timeZone = "Europe/Lisbon") {
  const date = parseGeomarDate(event?.timeUtc || event?.date);
  if (!date) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone
  }).format(date).replace(/\s/g, "").toLowerCase();
}

async function fetchJson(fetcher, url) {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to load tide data from ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadTideData({ fetcher = fetch, url = PORTUGAL_TIDES_URL } = {}) {
  return normalizeTideCache(await fetchJson(fetcher, url));
}
