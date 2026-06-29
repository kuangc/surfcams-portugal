import { PORTUGAL_TIDES_URL } from "./config.js";

const DEFAULT_TIME_ZONE = "Europe/Lisbon";
const CIVIL_TWILIGHT_ZENITH = 96;
const SUNRISE_ZENITH = 90.833;

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

function normalizeIsoTime(value) {
  const date = parseGeomarDate(value);
  return date ? date.toISOString() : "";
}

function normalizeDaylightWindow(window = {}) {
  const firstLightUtc = normalizeIsoTime(window.firstLightUtc || window.civilDawnUtc);
  const lastLightUtc = normalizeIsoTime(window.lastLightUtc || window.civilDuskUtc);

  if (!firstLightUtc || !lastLightUtc) return null;

  return {
    ...window,
    firstLightUtc,
    lastLightUtc,
    sunriseUtc: normalizeIsoTime(window.sunriseUtc) || undefined,
    sunsetUtc: normalizeIsoTime(window.sunsetUtc) || undefined
  };
}

function normalizeDaylightByPort(daylightByPort = {}) {
  return new Map(
    Object.entries(daylightByPort).map(([portId, windowsByDate]) => [
      normalizePortId(portId),
      Object.fromEntries(
        Object.entries(windowsByDate || {})
          .map(([dateKey, window]) => [dateKey, normalizeDaylightWindow(window)])
          .filter(([, window]) => window)
      )
    ])
  );
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
    ),
    daylightByPortId: normalizeDaylightByPort(cache.daylightByPort)
  };
}

export function emptyTideData() {
  return normalizeTideCache();
}

function eventTime(event) {
  return new Date(event.timeUtc).getTime();
}

function timeZoneDateKey(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function dayOfYear({ year, month, day }) {
  const start = Date.UTC(year, 0, 0);
  const current = Date.UTC(year, month - 1, day);
  return Math.floor((current - start) / 86400000);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function solarEventUtc(dateKey, lat, lon, zenith, isRise) {
  const parsed = parseDateKey(dateKey);
  if (!parsed || !Number.isFinite(lat) || !Number.isFinite(lon)) return "";

  const longitudeHour = lon / 15;
  const eventHour = isRise ? 6 : 18;
  const approximateDay = dayOfYear(parsed) + ((eventHour - longitudeHour) / 24);
  const meanAnomaly = (0.9856 * approximateDay) - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly
    + (1.916 * Math.sin(toRadians(meanAnomaly)))
    + (0.020 * Math.sin(toRadians(2 * meanAnomaly)))
    + 282.634
  );

  let rightAscension = normalizeDegrees(
    toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))))
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(toRadians(zenith))
    - (sinDeclination * Math.sin(toRadians(lat)))
  ) / (cosDeclination * Math.cos(toRadians(lat)));

  if (cosHourAngle > 1 || cosHourAngle < -1) return "";

  const hourAngle = (isRise
    ? 360 - toDegrees(Math.acos(cosHourAngle))
    : toDegrees(Math.acos(cosHourAngle))) / 15;
  const localMeanTime = hourAngle + rightAscension - (0.06571 * approximateDay) - 6.622;
  const utcHours = localMeanTime - longitudeHour;
  const normalizedUtcHours = ((utcHours % 24) + 24) % 24;
  const eventMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day)
    + Math.round(normalizedUtcHours * 60 * 60 * 1000);

  return new Date(eventMs).toISOString();
}

export function buildDaylightWindow(dateKey, lat, lon) {
  const firstLightUtc = solarEventUtc(dateKey, lat, lon, CIVIL_TWILIGHT_ZENITH, true);
  const lastLightUtc = solarEventUtc(dateKey, lat, lon, CIVIL_TWILIGHT_ZENITH, false);
  if (!firstLightUtc || !lastLightUtc) return null;

  return {
    firstLightUtc,
    lastLightUtc,
    sunriseUtc: solarEventUtc(dateKey, lat, lon, SUNRISE_ZENITH, true) || undefined,
    sunsetUtc: solarEventUtc(dateKey, lat, lon, SUNRISE_ZENITH, false) || undefined,
    calculation: "noaa-civil-twilight"
  };
}

export function buildDaylightByPort(stations = {}, startDate = new Date(), endDate = new Date(), { timeZone = DEFAULT_TIME_ZONE } = {}) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return {};

  const daylightByPort = {};

  Object.values(stations).forEach((station) => {
    if (!Number.isFinite(station?.gaugeLat) || !Number.isFinite(station?.gaugeLon)) return;

    const windows = {};
    for (
      let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      cursor < end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const dateKey = utcDateKey(cursor);
      const window = buildDaylightWindow(dateKey, station.gaugeLat, station.gaugeLon);
      if (window) {
        windows[dateKey] = {
          ...window,
          timeZone
        };
      }
    }

    if (Object.keys(windows).length) {
      daylightByPort[normalizePortId(station.portId)] = windows;
    }
  });

  return Object.fromEntries(
    Object.entries(daylightByPort).sort(([a], [b]) => Number(a) - Number(b))
  );
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

function daylightEvent(window, key, type) {
  const timeUtc = window?.[key];
  return timeUtc ? { type, timeUtc } : null;
}

function daylightWindowForDate(normalized, station, date, timeZone) {
  const portId = normalizePortId(station.portId);
  const dateKey = timeZoneDateKey(date, timeZone);
  const cachedWindow = normalized.daylightByPortId?.get(portId)?.[dateKey];

  return cachedWindow || buildDaylightWindow(dateKey, station.gaugeLat, station.gaugeLon);
}

function isEventDuringDaylight(event, daylightWindow) {
  if (!event || !daylightWindow) return false;
  const ms = eventTime(event);
  const firstLightMs = new Date(daylightWindow.firstLightUtc).getTime();
  const lastLightMs = new Date(daylightWindow.lastLightUtc).getTime();

  return Number.isFinite(ms)
    && Number.isFinite(firstLightMs)
    && Number.isFinite(lastLightMs)
    && ms >= firstLightMs
    && ms <= lastLightMs;
}

export function findTideSnapshot(camera, tideData, now = new Date()) {
  const normalized = tideData?.stationsByCameraId ? tideData : normalizeTideCache(tideData);
  const station = normalized.stationsByCameraId.get(camera?.id);
  if (!station) return null;

  const events = normalized.eventsByPortId.get(normalizePortId(station.portId)) || [];
  if (!events.length) return null;

  const timeZone = normalized.source?.timeZone || DEFAULT_TIME_ZONE;
  const nowMs = now.getTime();
  const nextHigh = events.find((event) => event.type === "high" && eventTime(event) > nowMs) || null;
  const daylight = daylightWindowForDate(normalized, station, now, timeZone);
  const nextDaylightHigh = events.find((event) => (
    event.type === "high"
    && eventTime(event) > nowMs
    && isEventDuringDaylight(event, daylightWindowForDate(normalized, station, new Date(event.timeUtc), timeZone))
  )) || null;

  return {
    station,
    events,
    stateLabel: inferTideState(events, now),
    nextHigh,
    nextDaylightHigh,
    firstLight: daylightEvent(daylight, "firstLightUtc", "first-light"),
    lastLight: daylightEvent(daylight, "lastLightUtc", "last-light")
  };
}

export function formatTideEventTime(event, timeZone = DEFAULT_TIME_ZONE) {
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
