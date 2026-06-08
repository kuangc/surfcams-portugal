import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import { formatConditionLine, formatSpotMetadata } from "../src/condition-summary.js";

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
  detailMetrics: {
    "Período das ondas": "8.0s",
    "Direção das ondas": "Noroeste",
    "Direção do vento": "Norte",
    "Temp. do mar": "15.2º"
  }
};

test("formatConditionLine keeps the monitor summary to core visual signals", () => {
  const line = formatConditionLine(camera, DEFAULT_SURF_PREFERENCES);

  assert.equal(line, "Good · ~0.8m · NW 8s · wind ↓ 6km/h · low 1.2m");
});

test("formatSpotMetadata exposes richer favorite and explore details", () => {
  const metadata = formatSpotMetadata(camera, DEFAULT_SURF_PREFERENCES);

  assert.deepEqual(metadata.map((item) => item.label), [
    "Surf",
    "Swell",
    "Period",
    "Wind",
    "Tide",
    "Coast",
    "Sea Temp"
  ]);
  assert.equal(metadata.find((item) => item.label === "Sea Temp").value, "15.2º");
});
