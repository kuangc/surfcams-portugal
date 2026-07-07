import test from "node:test";
import assert from "node:assert/strict";
import { renderPromotionMapHtml } from "../scripts/build-promotion-map-html.js";

const html = renderPromotionMapHtml({
  generatedAt: "2026-07-07T00:00:00Z",
  fence: { north: 39.65, south: 38.40, westOfLon: -9.05 },
  spots: [
    { id: "surfline-alpha", name: "Alpha", lat: 39.0, lon: -9.42, camCoverage: "spot", deferredReason: null, wanted: true, linkedCamId: "cam-a" },
    { id: "surfline-beta", name: "Beta", lat: 38.64, lon: -9.24, camCoverage: "stretch", deferredReason: null, wanted: true, linkedCamId: null },
    { id: "surfline-omega", name: "Omega", lat: 38.9, lon: -9.44, camCoverage: null, deferredReason: null, wanted: false, linkedCamId: null }
  ],
  reviewQueue: [
    { surflineSpotId: "surfline-beta", spotName: "Beta", nearestCamId: "cam-strip", distanceKm: 0.5, reviewStatus: "needs-review" }
  ]
});

test("map page contains every spot as dot and checkbox, wanted pre-checked", () => {
  assert.match(html, /surfline-alpha/);
  assert.match(html, /surfline-omega/);
  assert.match(html, /data-id="surfline-beta"[^>]*checked/);
  assert.doesNotMatch(html, /data-id="surfline-omega"[^>]*checked/);
  assert.match(html, /<svg/);
  assert.match(html, /Export manifest/);
});

test("review queue rendered with accept/reject controls", () => {
  assert.match(html, /cam-strip/);
  assert.match(html, /Export feedback/);
});

test("html escapes interpolated content", () => {
  const nasty = renderPromotionMapHtml({
    generatedAt: "x", fence: { north: 39.65, south: 38.40, westOfLon: -9.05 },
    spots: [{ id: "surfline-x", name: "<script>alert(1)</script>", lat: 39.0, lon: -9.42, camCoverage: null, deferredReason: null, wanted: false, linkedCamId: null }],
    reviewQueue: []
  });
  assert.doesNotMatch(nasty, /<script>alert\(1\)<\/script>/);
});
