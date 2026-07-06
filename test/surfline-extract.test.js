import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseNextDataState, feetToMeters, knotsToKmh,
  extractSurflineCams, extractConditionsRecords
} from "../scripts/lib/surfline-extract.js";

const html = fs.readFileSync("test/fixtures/surfline-page.html", "utf8");

test("unit conversions", () => {
  assert.equal(feetToMeters(3), 0.9);        // rounded to 0.1
  assert.equal(feetToMeters(null), null);
  assert.equal(knotsToKmh(10), 18.5);
});

test("parseNextDataState finds ssrReduxState", () => {
  const state = parseNextDataState(html);
  assert.equal(state.spot.report.data.spot.name, "Testspot");
});

test("extractSurflineCams", () => {
  const state = parseNextDataState(html);
  assert.deepEqual(extractSurflineCams(state.spot.report.data.spot), [
    { title: "PT - Testspot", stillUrl: "https://camstills.example/test.jpg" }
  ]);
});

test("extractConditionsRecords normalizes primary + nearby, FT->m, KTS->kmh", () => {
  const state = parseNextDataState(html);
  const records = extractConditionsRecords(state, { fetchedAt: "2026-07-06T06:00:00Z", idFor: (name) => name });
  const primary = records.find((r) => r.sourceKind === "primary");
  assert.equal(primary.name, "Testspot");
  assert.equal(primary.surfMinM, 0.6);
  assert.equal(primary.surfMaxM, 0.9);
  assert.deepEqual(primary.surfRawFt, [2, 3]);
  assert.equal(primary.windKmh, 18.5);
  assert.equal(primary.windDirDeg, 200);
  assert.equal(primary.rating, "FAIR");
  assert.equal(primary.swells[0].periodS, 12);
  const nearby = records.find((r) => r.sourceKind === "nearby");
  assert.equal(nearby.rating, "POOR");
  assert.equal(nearby.surfMaxM, 0.6);
});
