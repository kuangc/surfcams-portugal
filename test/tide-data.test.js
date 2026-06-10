import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import {
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
  }
];

test("normalizeGeomarExtremes keeps only official high and low tide events", () => {
  const events = normalizeGeomarExtremes(rawCascaisExtremes);

  assert.deepEqual(events.map((event) => event.type), ["low", "high", "low", "high"]);
  assert.deepEqual(events.map((event) => event.heightM), [1.22, 2.85, 1.32, 3]);
  assert.equal(events[1].timeUtc, "2026-06-10T10:09:00.000Z");
});

test("findTideSnapshot infers current tide state and next high tide from cached official events", () => {
  const cache = normalizeTideCache({
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
});

test("findTideSnapshot returns null when a camera has no cached official station", () => {
  const cache = normalizeTideCache();

  assert.equal(findTideSnapshot({ id: "unknown" }, cache, new Date("2026-06-10T12:00:00+01:00")), null);
});

test("Portugal tide cache maps default favorites to official station events", () => {
  const cache = JSON.parse(fs.readFileSync("data/portugal-tides.json", "utf8"));

  assert.equal(cache.provider, "instituto-hidrografico-geomar");
  assert.match(cache.source.platformUrl, /geomar\.hidrografico\.pt/);

  for (const id of DEFAULT_FAVORITE_IDS) {
    assert.ok(cache.cameraStations[id], `${id} has an official tide station`);
  }

  const events = Object.values(cache.eventsByPort).flat();
  assert.ok(events.some((event) => event.type === "high"), "cache contains high tide events");
  assert.ok(events.some((event) => event.type === "low"), "cache contains low tide events");
  assert.ok(events.every((event) => /\d{4}-\d{2}-\d{2}T/.test(event.timeUtc)), "events store UTC timestamps");
});
