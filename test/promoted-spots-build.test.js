import test from "node:test";
import assert from "node:assert/strict";
import { buildPromotedSpots } from "../scripts/build-promoted-spots.js";

const surflineDb = { spots: [
  { id: "surfline-alpha", remoteSpotId: "r1", name: "Alpha", lat: 39.0, lon: -9.42, url: "https://sl/alpha",
    staticMetadata: { surflineCams: [{ title: "PT - Alpha", stillUrl: "https://x/a.jpg" }], breakType: ["Reef"] } },
  { id: "surfline-beta", remoteSpotId: "r2", name: "Beta", lat: 38.64, lon: -9.24, url: "https://sl/beta",
    staticMetadata: { surflineCams: [] } },
  { id: "surfline-gamma", remoteSpotId: "r3", name: "Gamma", lat: 38.80, lon: -9.49, url: "https://sl/gamma",
    staticMetadata: { surflineCams: [] } }
]};
const meoDb = { spots: [
  { id: "cam-alpha", name: "Alpha", lat: 39.001, lon: -9.421, region: "ericeira", hasStream: true },
  { id: "cam-strip", name: "Costa de Caparica | CDS", lat: 38.641, lon: -9.241, region: "almada", hasStream: true }
]};
const matchesDb = { matches: [
  { meoSpotId: "cam-alpha", surflineSpotIds: ["surfline-alpha"], reviewStatus: "generated", source: "generated-nearest",
    distancesKm: { "surfline-alpha": 0.1 }, matchEvidence: [{ surflineSpotId: "surfline-alpha", distanceKm: 0.1, nameScore: 1 }] },
  { meoSpotId: "cam-strip", surflineSpotIds: ["surfline-beta"], reviewStatus: "needs-review", source: "generated-nearest",
    distancesKm: { "surfline-beta": 0.5 }, matchEvidence: [{ surflineSpotId: "surfline-beta", distanceKm: 0.5, nameScore: 0.6 }] }
]};
const stretches = { stretches: [
  { id: "caparica", name: "Caparica stretch", surflineSpotIds: ["surfline-beta"], meoCamIds: ["cam-strip"] }
]};
const promotions = { promoteOnlyWithTrustedCam: true, promoted: [
  { surflineSpotId: "surfline-alpha" }, { surflineSpotId: "surfline-beta" }, { surflineSpotId: "surfline-gamma" }
]};

test("gate: trusted MEO cam -> spot coverage with linkedCamId", () => {
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb, stretches, promotions });
  const alpha = out.promoted.find((s) => s.id === "surfline-alpha");
  assert.equal(alpha.camCoverage, "spot");
  assert.equal(alpha.linkedCamId, "cam-alpha");
  assert.equal(alpha.promoted, true);
  assert.equal(alpha.hasStream, false);
  assert.equal(alpha.region, "ericeira");
});

test("gate: stretch member without at-spot cam -> stretch coverage", () => {
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb, stretches, promotions });
  const beta = out.promoted.find((s) => s.id === "surfline-beta");
  assert.equal(beta.camCoverage, "stretch"); // Caparica zone kills the name match; stretch membership saves it
  assert.equal(beta.stretchId, "caparica");
  assert.deepEqual(beta.stretchCamIds, ["cam-strip"]);
});

test("gate: no cam, no stretch, no surfline cam -> deferred", () => {
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb, stretches, promotions });
  assert.ok(out.deferred.find((d) => d.surflineSpotId === "surfline-gamma"));
  assert.ok(!out.promoted.find((s) => s.id === "surfline-gamma"));
});

test("surfline native cam alone passes the gate", () => {
  const noMatches = { matches: [] };
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb: noMatches, stretches, promotions });
  const alpha = out.promoted.find((s) => s.id === "surfline-alpha");
  assert.equal(alpha.camCoverage, "spot"); // via surflineCams
  assert.equal(alpha.linkedCamId, null);
});

test("rejected rows are excluded even when nearest", () => {
  const rejectedDb = { matches: [
    { meoSpotId: "cam-strip", surflineSpotIds: ["surfline-alpha"], reviewStatus: "rejected", source: "generated-nearest",
      distancesKm: { "surfline-alpha": 0.05 }, matchEvidence: [{ surflineSpotId: "surfline-alpha", distanceKm: 0.05, nameScore: 1 }] },
    { meoSpotId: "cam-alpha", surflineSpotIds: ["surfline-alpha"], reviewStatus: "generated", source: "generated-nearest",
      distancesKm: { "surfline-alpha": 0.1 }, matchEvidence: [{ surflineSpotId: "surfline-alpha", distanceKm: 0.1, nameScore: 1 }] }
  ]};
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb: rejectedDb, stretches, promotions });
  const alpha = out.promoted.find((s) => s.id === "surfline-alpha");
  assert.equal(alpha.linkedCamId, "cam-alpha"); // rejected cam-strip@0.05 skipped despite being nearest (0.05 would win via proximity)
});

test("curated rows trust members regardless of name score or distance", () => {
  // cam-strip sits in the Caparica ambiguity zone at 0.5km with nameScore 0 — untrusted if generated, trusted because curated
  const curatedDb = { matches: [
    { meoSpotId: "cam-strip", surflineSpotIds: ["surfline-gamma"], reviewStatus: "curated", source: "curated",
      distancesKm: { "surfline-gamma": 0.5 }, matchEvidence: [{ surflineSpotId: "surfline-gamma", distanceKm: 0.5, nameScore: 0 }] }
  ]};
  const out = buildPromotedSpots({ surflineDb, meoDb, matchesDb: curatedDb, stretches, promotions });
  const gamma = out.promoted.find((s) => s.id === "surfline-gamma");
  assert.equal(gamma.camCoverage, "spot");
  assert.equal(gamma.linkedCamId, "cam-strip");
});
