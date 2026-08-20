import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseNextDataState, feetToMeters, knotsToKmh, fahrenheitToCelsius,
  extractConditionsRecords
} from "../scripts/lib/surfline-extract.js";

const html = fs.readFileSync("test/fixtures/surfline-page.html", "utf8");

test("unit conversions", () => {
  assert.equal(feetToMeters(3), 0.9);        // rounded to 0.1
  assert.equal(feetToMeters(null), null);
  assert.equal(knotsToKmh(10), 18.5);
  assert.equal(fahrenheitToCelsius(61), 16.1);
  assert.equal(fahrenheitToCelsius(null), null);
});

test("parseNextDataState finds ssrReduxState", () => {
  const state = parseNextDataState(html);
  assert.equal(state.spot.report.data.spot.name, "Testspot");
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
  assert.equal(primary.ratingValue, 3);
  assert.equal(primary.swells[0].periodS, 12);
  assert.equal(primary.waterTempC, 16.1);
  const nearby = records.find((r) => r.sourceKind === "nearby");
  assert.equal(nearby.rating, "POOR");
  assert.equal(nearby.ratingValue, 1);
  assert.equal(nearby.surfMaxM, 0.6);
  assert.equal(nearby.swells[0]?.periodS, 11);
  assert.equal(nearby.waterTempC, 15.6);
});

test("extraction preserves explicit human observation provenance", () => {
  const state = structuredClone(parseNextDataState(html));
  state.spot.report.data.forecast.waveHeight.human = true;
  state.spot.report.data.forecast.conditions.human = true;
  state.spot.nearby.data.spots[0].waveHeight.human = false;
  state.spot.nearby.data.spots[0].conditions.human = false;

  const records = extractConditionsRecords(state, { fetchedAt: "2026-07-06T06:00:00Z", idFor: (name) => name });
  const primary = records.find((record) => record.sourceKind === "primary");
  const nearby = records.find((record) => record.sourceKind === "nearby");

  assert.equal(primary.surfObserved, true);
  assert.equal(primary.ratingObserved, true);
  assert.equal(nearby.surfObserved, false);
  assert.equal(nearby.ratingObserved, false);
});

test("null and malformed inputs degrade to null/empty", () => {
  assert.equal(parseNextDataState("<html>no script</html>"), null);
  assert.equal(parseNextDataState('<script id="__NEXT_DATA__">not json</script>'), null);
  const viaDoubleEncoded = parseNextDataState(JSON.stringify(html));
  assert.equal(viaDoubleEncoded.spot.report.data.spot.name, "Testspot");
  assert.deepEqual(extractConditionsRecords(null, { fetchedAt: "x" }), []);
  assert.deepEqual(extractConditionsRecords({}, { fetchedAt: "x" }), []);
});
