import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import {
  buildDaylightWindow,
  findNearestTideSnapshot,
  findTideSnapshot,
  formatTideEventTime,
  normalizeGeomarExtremes,
  normalizeTideCache
} from "../src/tide-data.js";

const rawCascaisExtremes = [
  {
    date: "2026-06-08T10:00:00.000+0000",
    height: null,
    portCode: null,
    tide: null,
    moon: "QM"
  },
  {
    date: "2026-06-10T03:48:00.000+0000",
    height: 1.22,
    portCode: 15,
    tide: "BM",
    moon: ""
  },
  {
    date: "2026-06-10T10:09:00.000+0000",
    height: 2.85,
    portCode: 15,
    tide: "PM",
    moon: ""
  },
  {
    date: "2026-06-10T16:13:00.000+0000",
    height: 1.32,
    portCode: 15,
    tide: "BM",
    moon: ""
  },
  {
    date: "2026-06-10T22:27:00.000+0000",
    height: 3,
    portCode: 15,
    tide: "PM",
    moon: ""
  },
  {
    date: "2026-06-11T04:46:00.000+0000",
    height: 1.11,
    portCode: 15,
    tide: "BM",
    moon: ""
  },
  {
    date: "2026-06-11T11:05:00.000+0000",
    height: 3.01,
    portCode: 15,
    tide: "PM",
    moon: ""
  }
];

test("normalizeGeomarExtremes keeps only official high and low tide events", () => {
  const events = normalizeGeomarExtremes(rawCascaisExtremes);

  assert.deepEqual(events.map((event) => event.type), ["low", "high", "low", "high", "low", "high"]);
  assert.deepEqual(events.map((event) => event.heightM), [1.22, 2.85, 1.32, 3, 1.11, 3.01]);
  assert.equal(events[1].timeUtc, "2026-06-10T10:09:00.000Z");
});

test("findTideSnapshot infers current tide state and next high tide from cached official events", () => {
  const cache = normalizeTideCache({
    generatedAt: "2026-06-10T10:00:00.000Z",
    cameraStations: {
      "sao-pedro-do-estoril": {
        portId: 15,
        portName: "Cascais",
        gaugeLat: 38.6916667,
        gaugeLon: -9.4166667
      }
    },
    eventsByPort: {
      15: normalizeGeomarExtremes(rawCascaisExtremes)
    },
    daylightByPort: {
      15: {
        "2026-06-10": {
          firstLightUtc: "2026-06-10T04:38:00.000Z",
          lastLightUtc: "2026-06-10T20:37:00.000Z"
        },
        "2026-06-11": {
          firstLightUtc: "2026-06-11T04:38:00.000Z",
          lastLightUtc: "2026-06-11T20:38:00.000Z"
        }
      }
    }
  });

  const snapshot = findTideSnapshot(
    { id: "sao-pedro-do-estoril" },
    cache,
    new Date("2026-06-10T12:00:00+01:00")
  );

  assert.equal(snapshot.station.portName, "Cascais");
  assert.equal(snapshot.stateLabel, "Falling");
  assert.equal(snapshot.nextHigh.timeUtc, "2026-06-10T22:27:00.000Z");
  assert.equal(formatTideEventTime(snapshot.nextHigh, "Europe/Lisbon"), "11:27pm");
  assert.equal(snapshot.nextDaylightHigh.timeUtc, "2026-06-11T11:05:00.000Z");
  assert.equal(formatTideEventTime(snapshot.nextDaylightHigh, "Europe/Lisbon"), "12:05pm");
  assert.equal(formatTideEventTime(snapshot.firstLight, "Europe/Lisbon"), "5:38am");
  assert.equal(formatTideEventTime(snapshot.lastLight, "Europe/Lisbon"), "9:37pm");
});

test("findTideSnapshot returns null when a camera has no cached official station", () => {
  const cache = normalizeTideCache();

  assert.equal(findTideSnapshot({ id: "unknown" }, cache, new Date("2026-06-10T12:00:00+01:00")), null);
});

test("findNearestTideSnapshot borrows only a nearby mapped official station", () => {
  const cache = normalizeTideCache({
    generatedAt: "2026-06-10T10:00:00.000Z",
    cameraStations: {
      "paco-de-arcos": {
        cameraLat: 38.695,
        cameraLon: -9.292,
        portId: 15,
        portName: "Cascais",
        gaugeLat: 38.6916667,
        gaugeLon: -9.4166667
      }
    },
    eventsByPort: { 15: normalizeGeomarExtremes(rawCascaisExtremes) },
    daylightByPort: {
      15: {
        "2026-06-10": {
          firstLightUtc: "2026-06-10T04:38:00.000Z",
          lastLightUtc: "2026-06-10T20:37:00.000Z"
        }
      }
    }
  });
  const caxias = { id: "surfline-praia-de-caxias", lat: 38.6985, lon: -9.2796 };
  const farAway = { id: "far-away", lat: 41.15, lon: -8.6 };

  assert.equal(
    findNearestTideSnapshot(caxias, cache, new Date("2026-06-10T12:00:00+01:00")).station.portName,
    "Cascais"
  );
  assert.equal(findNearestTideSnapshot(farAway, cache, new Date("2026-06-10T12:00:00+01:00")), null);
});

test("buildDaylightWindow keeps civil dusk on the requested local day", () => {
  const window = buildDaylightWindow("2026-06-10", 38.6916667, -9.4166667);

  assert.match(window.firstLightUtc, /^2026-06-10T04:/);
  assert.match(window.lastLightUtc, /^2026-06-10T20:/);
});

test("Portugal tide cache maps default favorites to official station events", () => {
  const cache = JSON.parse(fs.readFileSync("data/portugal-tides.json", "utf8"));

  assert.equal(cache.provider, "instituto-hidrografico-geomar");
  assert.match(cache.source.platformUrl, /geomar\.hidrografico\.pt/);

  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(cache.cameraStations[id], `${id} has an official tide station`);
    const portId = cache.cameraStations[id].portId;
    const daylightWindows = cache.daylightByPort?.[portId] || {};
    assert.ok(
      Object.values(daylightWindows).some((window) => window.firstLightUtc && window.lastLightUtc),
      `${id} has first and last light windows`
    );
  }

  const events = Object.values(cache.eventsByPort).flat();
  assert.ok(events.some((event) => event.type === "high"), "cache contains high tide events");
  assert.ok(events.some((event) => event.type === "low"), "cache contains low tide events");
  assert.ok(events.every((event) => /\d{4}-\d{2}-\d{2}T/.test(event.timeUtc)), "events store UTC timestamps");
});
