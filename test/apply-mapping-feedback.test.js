import test from "node:test";
import assert from "node:assert/strict";
import { applyFeedback } from "../scripts/apply-mapping-feedback.js";

const db = { matches: [
  { meoSpotId: "cam-a", surflineSpotIds: ["surfline-x", "surfline-y"], source: "generated-nearest",
    confidence: "coordinate-nearby", reviewStatus: "needs-review", distancesKm: { "surfline-x": 0.2, "surfline-y": 0.7 } }
]};

test("accept turns row curated with the selected spot first", () => {
  const out = applyFeedback(db, [{ meoSpotId: "cam-a", decision: "accept", selectedSurflineSpotId: "surfline-y", notes: "cam frames y" }]);
  const row = out.matches.find((m) => m.meoSpotId === "cam-a");
  assert.equal(row.source, "curated");
  assert.equal(row.reviewStatus, "curated");
  assert.equal(row.surflineSpotIds[0], "surfline-y");
  assert.equal(row.notes, "cam frames y");
});

test("reject marks row rejected and runtime-excluded", () => {
  const out = applyFeedback(db, [{ meoSpotId: "cam-a", decision: "reject" }]);
  assert.equal(out.matches.find((m) => m.meoSpotId === "cam-a").reviewStatus, "rejected");
});

test("unknown meoSpotId throws", () => {
  assert.throws(() => applyFeedback(db, [{ meoSpotId: "nope", decision: "accept", selectedSurflineSpotId: "surfline-x" }]));
});
