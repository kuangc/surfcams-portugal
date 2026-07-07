import test from "node:test";
import assert from "node:assert/strict";
import { isCuratedMatch, isRejectedMatch, isPreservedMatch } from "../scripts/build-meo-surfline-matches.js";

test("isCuratedMatch: curated source, manual source, or curated reviewStatus", () => {
  assert.equal(isCuratedMatch({ source: "curated" }), true);
  assert.equal(isCuratedMatch({ source: "manual" }), true);
  assert.equal(isCuratedMatch({ source: "generated-nearest", reviewStatus: "curated" }), true);
  assert.equal(isCuratedMatch({ source: "generated-nearest", reviewStatus: "generated" }), false);
  assert.equal(isCuratedMatch({ source: "generated-nearest", reviewStatus: "rejected" }), false);
});

test("isRejectedMatch: only reviewStatus rejected counts", () => {
  assert.equal(isRejectedMatch({ source: "generated-nearest", reviewStatus: "rejected" }), true);
  assert.equal(isRejectedMatch({ source: "curated", reviewStatus: "curated" }), false);
  assert.equal(isRejectedMatch({ source: "generated-nearest", reviewStatus: "generated" }), false);
  assert.equal(isRejectedMatch({ source: "generated-nearest", reviewStatus: "needs-review" }), false);
});

test("isPreservedMatch: curated preserved, rejected preserved, generated not preserved", () => {
  assert.equal(isPreservedMatch({ source: "curated", reviewStatus: "curated" }), true);
  assert.equal(isPreservedMatch({ source: "generated-nearest", reviewStatus: "rejected" }), true);
  assert.equal(isPreservedMatch({ source: "generated-nearest", reviewStatus: "generated" }), false);
  assert.equal(isPreservedMatch({ source: "generated-nearest", reviewStatus: "needs-review" }), false);
});
