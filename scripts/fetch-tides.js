import fs from "node:fs/promises";
import path from "node:path";

import { normalizeGeomarExtremes } from "../src/tide-data.js";

const CAMERA_DB_PATH = "data/beachcam-cameras.json";
const TIDE_CACHE_PATH = "data/portugal-tides.json";
const API_BASE = "https://supportserver1.hidrografico.pt";
const GEOMAR_PLATFORM_URL = "https://geomar.hidrografico.pt/";
const API_KEY = "00b822f3-2207-40b9-b66e-762623932f25";
const TIME_ZONE = "Europe/Lisbon";
const CONCURRENCY = 6;
const NEAREST_STATION_MAX_KM = 60;

const MANUAL_PORTS = {
  12: { portId: "12", portName: "Leixões", gaugeLat: 41.18605, gaugeLon: -8.703056 },
  13: { portId: "13", portName: "Aveiro - Molhe Central da Barra de Aveiro", gaugeLat: 40.643888888888895, gaugeLon: -8.74944444444444 },
  15: { portId: "15", portName: "Cascais", gaugeLat: 38.6916667, gaugeLon: -9.4166667 },
  18: { portId: "18", portName: "Lagos", gaugeLat: 37.0966667, gaugeLon: -8.665000000000001 },
  19: { portId: "19", portName: "Barra de Faro-Olhão", gaugeLat: 36.977777777777796, gaugeLon: -7.86611111111111 },
  20: { portId: "20", portName: "Setúbal-Tróia", gaugeLat: 38.493, gaugeLon: -8.902 },
  21: { portId: "21", portName: "Vila Real de S. António", gaugeLat: 37.195, gaugeLon: -7.416 },
  28: { portId: "28", portName: "Sesimbra", gaugeLat: 38.439722222222194, gaugeLon: -9.11027777777778 },
  29: { portId: "29", portName: "Peniche", gaugeLat: 39.355, gaugeLon: -9.38 },
  43: { portId: "43", portName: "Sines - Posto 3", gaugeLat: 37.9469444444444, gaugeLon: -8.887222222222219 },
  73: { portId: "73", portName: "Figueira da Foz - Cais dos Serviços", gaugeLat: 40.14703, gaugeLon: -8.853249 },
  74: { portId: "74", portName: "Viana do Castelo", gaugeLat: 41.68373, gaugeLon: -8.838689 },
  112: { portId: "112", portName: "Funchal", gaugeLat: 32.64, gaugeLon: -16.91 },
  152: { portId: "152", portName: "Lisboa - Alcântara", gaugeLat: 38.7001389, gaugeLon: -9.1632222 },
  211: { portId: "211", portName: "Ponta Delgada (Ilha de S. Miguel)", gaugeLat: 37.741, gaugeLon: -25.668 }
};

const CAMERA_PORT_OVERRIDES = {
  "costa-da-caparica-riviera": "15",
  "fonte-da-telha": "15",
  "lagide-e-baia": "29",
  "sao-juliao": "15",
  "surfline-castelo": "15"
};

const REGION_PORT_OVERRIDES = {
  almada: "15",
  cascais: "15",
  peniche: "29",
  sesimbra: "28",
  setubal: "20",
  sintra: "15"
};

function isoAtUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateParam(date) {
  return date.toISOString();
}

function isCoordinateCamera(camera) {
  return (camera?.hasStream || camera?.firstClass) && Number.isFinite(camera.lat) && Number.isFinite(camera.lon);
}

function haversineKm(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = (sinLat * sinLat) + Math.cos(lat1) * Math.cos(lat2) * (sinLon * sinLon);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "X-Api-Key": API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Geomar HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, runWorker)
  );

  return results;
}

function tidesByLocationUrl(camera, startDate, endDate) {
  const url = new URL("/geodata/tides/getTidesByLocation", API_BASE);
  url.searchParams.set("lon", String(camera.lon));
  url.searchParams.set("lat", String(camera.lat));
  url.searchParams.set("startDate", formatDateParam(startDate));
  url.searchParams.set("endDate", formatDateParam(endDate));
  return url;
}

function tideExtremesUrl(portId, startDate, endDate) {
  const url = new URL("/geodata/tides/getBmPm", API_BASE);
  url.searchParams.set("startDate", formatDateParam(startDate));
  url.searchParams.set("endDate", formatDateParam(endDate));
  url.searchParams.set("portId", String(portId));
  return url;
}

function stationFromLocationResponse(camera, response) {
  if (!response?.portId) return null;

  return {
    cameraId: camera.id,
    cameraName: camera.name,
    cameraRegion: camera.region,
    cameraLat: camera.lat,
    cameraLon: camera.lon,
    portId: String(response.portId),
    portName: response.portName,
    gaugeLat: response.gaugeLat,
    gaugeLon: response.gaugeLon,
    source: "geomar-getTidesByLocation"
  };
}

function stationFromPort(camera, port, source) {
  if (!port) return null;

  return {
    cameraId: camera.id,
    cameraName: camera.name,
    cameraRegion: camera.region,
    cameraLat: camera.lat,
    cameraLon: camera.lon,
    portId: String(port.portId),
    portName: port.portName,
    gaugeLat: port.gaugeLat,
    gaugeLon: port.gaugeLon,
    source
  };
}

function manualStationForCamera(camera) {
  const portId = CAMERA_PORT_OVERRIDES[camera.id] || REGION_PORT_OVERRIDES[camera.region];
  return stationFromPort(camera, MANUAL_PORTS[portId], "manual-geomar-port-fallback");
}

function nearestStationForCamera(camera, stations) {
  const nearest = stations
    .filter((station) => Number.isFinite(station.gaugeLat) && Number.isFinite(station.gaugeLon))
    .map((station) => ({
      station,
      distanceKm: haversineKm(
        { lat: camera.lat, lon: camera.lon },
        { lat: station.gaugeLat, lon: station.gaugeLon }
      )
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!nearest || nearest.distanceKm > NEAREST_STATION_MAX_KM) return null;

  return {
    ...stationFromPort(camera, nearest.station, "nearest-geomar-gauge-fallback"),
    fallbackDistanceKm: Number(nearest.distanceKm.toFixed(1))
  };
}

function buildStations(cameraStations) {
  const stations = {};

  Object.values(cameraStations).forEach((station) => {
    const portId = String(station.portId);
    stations[portId] ||= {
      portId,
      portName: station.portName,
      gaugeLat: station.gaugeLat,
      gaugeLon: station.gaugeLon,
      cameraIds: []
    };
    stations[portId].cameraIds.push(station.cameraId);
  });

  Object.values(stations).forEach((station) => {
    station.cameraIds.sort();
  });

  return Object.fromEntries(
    Object.entries(stations).sort(([a], [b]) => Number(a) - Number(b))
  );
}

async function resolveCameraStations(cameras, previousCache, startDate, endDate) {
  const previousStations = previousCache?.cameraStations || {};
  const cameraStations = {};
  const missing = [];

  cameras.forEach((camera) => {
    const previous = previousStations[camera.id];
    if (previous?.portId) {
      cameraStations[camera.id] = {
        ...previous,
        cameraName: camera.name,
        cameraRegion: camera.region,
        cameraLat: camera.lat,
        cameraLon: camera.lon
      };
    } else {
      missing.push(camera);
    }
  });

  if (!missing.length) return cameraStations;

  console.log(`Resolving ${missing.length} camera tide stations from Geomar...`);

  await mapWithConcurrency(missing, async (camera) => {
    try {
      const response = await fetchJson(tidesByLocationUrl(camera, startDate, endDate));
      const station = stationFromLocationResponse(camera, response);
      if (station) cameraStations[camera.id] = station;
    } catch (error) {
      const station = manualStationForCamera(camera);
      if (station) {
        cameraStations[camera.id] = station;
        console.warn(`Using manual tide station for ${camera.id}: ${station.portName}`);
      } else {
        console.warn(`Skipping tide station for ${camera.id}: ${error.message}`);
      }
    }
  });

  const knownStations = Object.values(cameraStations);
  missing.forEach((camera) => {
    if (cameraStations[camera.id]) return;

    const station = nearestStationForCamera(camera, knownStations);
    if (station) {
      cameraStations[camera.id] = station;
      console.warn(`Using nearest tide station for ${camera.id}: ${station.portName} (${station.fallbackDistanceKm}km)`);
    }
  });

  return Object.fromEntries(
    Object.entries(cameraStations).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function fetchEventsByPort(portIds, startDate, endDate) {
  const eventsByPort = {};

  console.log(`Fetching tide extrema for ${portIds.length} official gauges...`);

  await mapWithConcurrency(portIds, async (portId) => {
    const response = await fetchJson(tideExtremesUrl(portId, startDate, endDate));
    eventsByPort[portId] = normalizeGeomarExtremes(response).map((event) => ({
      type: event.type,
      timeUtc: event.timeUtc,
      heightM: event.heightM,
      moon: event.moon
    }));
  });

  return Object.fromEntries(
    Object.entries(eventsByPort).sort(([a], [b]) => Number(a) - Number(b))
  );
}

async function main() {
  const cameraDb = await readJson(CAMERA_DB_PATH);
  const previousCache = await readJson(TIDE_CACHE_PATH, {});
  const cameras = cameraDb.cameras.filter(isCoordinateCamera);
  const now = new Date();
  const stationStartDate = new Date(isoAtUtcMidnight(now));
  const stationEndDate = addDays(stationStartDate, 1);
  const eventStartDate = addDays(stationStartDate, -1);
  const eventEndDate = addDays(stationStartDate, 4);
  const generatedAt = now.toISOString();

  const cameraStations = await resolveCameraStations(
    cameras,
    previousCache,
    stationStartDate,
    stationEndDate
  );
  const stations = buildStations(cameraStations);
  if (!Object.keys(stations).length) {
    throw new Error("No Geomar tide gauges resolved; refusing to write an empty tide cache.");
  }
  const eventsByPort = await fetchEventsByPort(Object.keys(stations), eventStartDate, eventEndDate);

  const cache = {
    schemaVersion: 1,
    generatedAt,
    provider: "instituto-hidrografico-geomar",
    source: {
      name: "Instituto Hidrografico Geomar",
      platformUrl: GEOMAR_PLATFORM_URL,
      apiBase: API_BASE,
      timeZone: TIME_ZONE,
      note: "Generated by a scheduled cache because Geomar's browser API blocks this app origin."
    },
    range: {
      startDate: eventStartDate.toISOString(),
      endDate: eventEndDate.toISOString()
    },
    cameraStations,
    stations,
    eventsByPort
  };

  await fs.mkdir(path.dirname(TIDE_CACHE_PATH), { recursive: true });
  await fs.writeFile(TIDE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);

  console.log(`Wrote ${TIDE_CACHE_PATH} for ${Object.keys(cameraStations).length} cameras and ${Object.keys(stations).length} gauges.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
