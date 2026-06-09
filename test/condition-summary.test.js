import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import {
  formatConditionChips,
  formatConditionLine,
  formatSpotMetadata,
  formatWaterSummary
} from "../src/condition-summary.js";

const camera = {
  id: "praia-de-carcavelos",
  name: "Carcavelos",
  region: "cascais",
  forecast: {
    wave: "0.8 m",
    tide: "1.2m",
    tideState: "Baixa-mar",
    wind: "6Km/h",
    windDirection: "north"
  },
  pageUrl: "http://beachcam.meo.pt/livecams/praia-de-carcavelos/",
  detailMetrics: {
    "Período das ondas": "8.0s",
    "Direção das ondas": "Noroeste",
    "Direção do vento": "Norte",
    "Temp. do mar": "15.2º",
    "Maré": "14:19"
  }
};

test("formatConditionLine keeps the monitor summary to core visual signals", () => {
  const line = formatConditionLine(camera, DEFAULT_SURF_PREFERENCES);

  assert.equal(line, "Good · MEO · ~0.8m · NW 8s · wind ↓ 6km/h offshore · coast S");
});

test("formatSpotMetadata exposes richer favorite and explore details", () => {
  const metadata = formatSpotMetadata(camera, DEFAULT_SURF_PREFERENCES);

  assert.deepEqual(metadata.map((item) => item.label), [
    "Surf",
    "Swell",
    "Period",
    "Wind",
    "Coast"
  ]);
});

test("formatConditionChips exposes scan-friendly condition tokens", () => {
  const chips = formatConditionChips(camera, DEFAULT_SURF_PREFERENCES);

  assert.deepEqual(chips.map((chip) => chip.key), ["fit", "source", "wave", "swell", "wind", "coast"]);
  assert.deepEqual(chips.map((chip) => chip.label), ["Good", "MEO", "~0.8m", "NW 8s", "6km/h offshore", "S exposure"]);
  assert.deepEqual(chips.map((chip) => chip.icon), ["●", "MEO", "≈", "↘", "↓", "━"]);
  assert.equal(chips[0].tone, "good");
  assert.equal(chips.find((chip) => chip.key === "source").detail, "Beachcam/MEO forecast");
  assert.equal(chips.find((chip) => chip.key === "wind").detail, "offshore");
  assert.equal(chips.find((chip) => chip.key === "coast").detail, "Spot-calibrated coast exposure");
});

test("formatWaterSummary exposes shared sea temperature and tide status", () => {
  const summary = formatWaterSummary(camera);

  assert.deepEqual(summary.map((item) => item.key), ["sea-temp", "tide-now", "next-high"]);
  assert.deepEqual(summary.map((item) => item.label), ["Sea temp", "Tide now", "High daylight"]);
  assert.deepEqual(summary.map((item) => item.value), ["15.2°", "Low", "unknown"]);
  assert.deepEqual(summary.map((item) => item.icon), ["≋", "↓", "⇡"]);
});

test("formatWaterSummary only shows daylight high tide time from explicit tide data", () => {
  const summary = formatWaterSummary({
    ...camera,
    forecast: {
      ...camera.forecast,
      nextDaylightHighTideTime: "19:42"
    }
  });

  assert.equal(summary.find((item) => item.key === "next-high").value, "7:42pm");
});
