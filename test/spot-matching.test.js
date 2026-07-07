import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSlugName,
  slugNamesMatch,
  inCaparicaAmbiguityZone,
  evaluateAssociation,
  classifyGeneratedMatch,
  NAME_MATCH_MAX_KM
} from "../scripts/lib/spot-matching.js";

test("normalizeSlugName strips diacritics, punctuation, case", () => {
  assert.equal(normalizeSlugName("Ribeira D'Ilhas"), "ribeiradilhas");
  assert.equal(normalizeSlugName("ribeira-dilhas"), "ribeiradilhas");
  assert.equal(normalizeSlugName("São João da Caparica"), "saojoaodacaparica");
});

test("slugNamesMatch: equality and containment, min length guard", () => {
  assert.equal(slugNamesMatch("ribeira-dilhas", "Ribeira D'Ilhas"), true);
  assert.equal(slugNamesMatch("praia-do-sul", "ericeira-praia-do-sul"), true);
  assert.equal(slugNamesMatch("sul", "praia-do-sul"), false); // <=3 chars normalized
  assert.equal(slugNamesMatch("parede", "carcavelos"), false);
});

test("inCaparicaAmbiguityZone bounds", () => {
  assert.equal(inCaparicaAmbiguityZone(38.61, -9.21), true);  // Castelo strip
  assert.equal(inCaparicaAmbiguityZone(38.70, -9.25), false); // north of strip
  assert.equal(inCaparicaAmbiguityZone(38.44, -9.10), false); // Sesimbra
});

test("evaluateAssociation: name-first rule", () => {
  // name match within 3km sanity cap -> trusted, even beyond 200m (bad geo pin case)
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0.8, distanceKm: 2.6, curated: false, camLat: 39.32, camLon: -9.36 }),
    { trusted: true, why: "name" });
  // slug containment counts as a name match even when nameScore is low
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0.1, distanceKm: 0.5, curated: false, camLat: 38.98, camLon: -9.42,
      surflineName: "praia-do-sul", meoName: "ericeira-praia-do-sul" }),
    { trusted: true, why: "name" });
  // no name match: <=0.2km passes, 0.3km fails
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0, distanceKm: 0.2, curated: false, camLat: 39.37, camLon: -9.34 }),
    { trusted: true, why: "proximity" });
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0, distanceKm: 0.3, curated: false, camLat: 38.73, camLon: -9.48 }),
    { trusted: false, why: "untrusted" });
  // Caparica zone: name path disabled, proximity still works
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0.9, distanceKm: 0.5, curated: false, camLat: 38.64, camLon: -9.24 }),
    { trusted: false, why: "untrusted" });
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0, distanceKm: 0.15, curated: false, camLat: 38.64, camLon: -9.24 }),
    { trusted: true, why: "proximity" });
  // curated rows are author-trusted for ALL members, anywhere
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0, distanceKm: 0.7, curated: true, camLat: 38.61, camLon: -9.21 }),
    { trusted: true, why: "curated" });
});

test("evaluateAssociation boundary values", () => {
  // exactly at the name-match distance cap -> still trusted
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0.9, distanceKm: NAME_MATCH_MAX_KM, curated: false, camLat: 39.32, camLon: -9.36 }),
    { trusted: true, why: "name" });
  // just past the cap, no proximity fallback -> untrusted
  assert.deepEqual(
    evaluateAssociation({ nameScore: 0.9, distanceKm: NAME_MATCH_MAX_KM + 0.001, curated: false, camLat: 39.32, camLon: -9.36 }),
    { trusted: false, why: "untrusted" });
});

test("classifyGeneratedMatch maps trust to reviewStatus/confidence", () => {
  assert.deepEqual(classifyGeneratedMatch({ nameScore: 0.8, distanceKm: 0.4, camLat: 39.34, camLon: -9.36 }),
    { reviewStatus: "generated", confidence: "name" });
  assert.deepEqual(classifyGeneratedMatch({ nameScore: 0, distanceKm: 0.15, camLat: 39.37, camLon: -9.34 }),
    { reviewStatus: "generated", confidence: "proximity" });
  assert.deepEqual(classifyGeneratedMatch({ nameScore: 0.9, distanceKm: 0.5, camLat: 38.64, camLon: -9.24 }),
    { reviewStatus: "needs-review", confidence: "coordinate-nearby" }); // Caparica zone
  assert.deepEqual(classifyGeneratedMatch({ nameScore: 0, distanceKm: 0.9, camLat: 38.98, camLon: -9.42 }),
    { reviewStatus: "needs-review", confidence: "coordinate-nearby" });
});
