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

test("renders exactly one dot and one checkbox row per spot", () => {
  const dotCount = (html.match(/class="spot-dot"/g) || []).length;
  const rowCount = (html.match(/class="spot-row"/g) || []).length;
  assert.equal(dotCount, 3);
  assert.equal(rowCount, 3);
});

test("review queue orders zero-coverage before stretch and shows badges", () => {
  const queued = renderPromotionMapHtml({
    generatedAt: "x", fence: { north: 39.65, south: 38.40, westOfLon: -9.05 },
    spots: [
      { id: "surfline-s1", name: "S1", lat: 39.0, lon: -9.42, camCoverage: "stretch", deferredReason: null, wanted: true, linkedCamId: null },
      { id: "surfline-s2", name: "S2", lat: 39.1, lon: -9.42, camCoverage: null, deferredReason: "no trusted cam", wanted: true, linkedCamId: null }
    ],
    reviewQueue: [
      { surflineSpotId: "surfline-s1", spotName: "S1", nearestCamId: "cam-1", distanceKm: 0.4, reviewStatus: "needs-review", camCoverage: "stretch" },
      { surflineSpotId: "surfline-s2", spotName: "S2", nearestCamId: "cam-2", distanceKm: 0.6, reviewStatus: "needs-review", camCoverage: null }
    ]
  });
  const s1 = queued.indexOf("surfline-s1");
  const s2 = queued.indexOf("surfline-s2");
  assert.ok(s2 >= 0 && s1 >= 0);
  assert.match(queued, /no coverage yet/);
  assert.match(queued, /stretch cam nearby/);

  const s1CardIndex = queued.indexOf('data-review-id="surfline-s1"');
  const s2CardIndex = queued.indexOf('data-review-id="surfline-s2"');
  assert.ok(s1CardIndex >= 0 && s2CardIndex >= 0);
  assert.ok(s2CardIndex < s1CardIndex);
});
