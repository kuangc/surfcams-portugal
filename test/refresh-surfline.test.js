import test from "node:test";
import assert from "node:assert/strict";
import { computeCoverPages, coverageReport, buildWantedIds } from "../scripts/refresh-surfline-conditions.js";
import { passesValidityFloor } from "../scripts/extract-surfline-conditions.js";

test("computeCoverPages: greedily selects one page covering primary and nearby wanted spots", () => {
  const spots = [
    { id: "surfline-a", sourceRecords: ["primary:surfline-a.html", "nearby:surfline-b.html"] },
    { id: "surfline-b", sourceRecords: ["primary:surfline-b.html"] },
    { id: "surfline-c", sourceRecords: ["nearby:surfline-b.html", "primary:surfline-c.html"] }
  ];

  assert.deepEqual(
    computeCoverPages(spots, ["surfline-a", "surfline-b", "surfline-c"]),
    ["surfline-b"]
  );
});

test("computeCoverPages: obeys maxPages and coverageReport reports remaining wanted ids", () => {
  const spots = [
    { id: "surfline-a", sourceRecords: ["primary:surfline-a.html"] },
    { id: "surfline-b", sourceRecords: ["primary:surfline-b.html"] },
    { id: "surfline-c", sourceRecords: ["primary:surfline-c.html"] }
  ];
  const wanted = ["surfline-a", "surfline-b", "surfline-c"];
  const pages = computeCoverPages(spots, wanted, { maxPages: 2 });

  assert.deepEqual(pages, ["surfline-a", "surfline-b"]);
  assert.deepEqual(coverageReport(spots, wanted, pages), {
    covered: ["surfline-a", "surfline-b"],
    uncovered: ["surfline-c"]
  });
});

test("buildWantedIds: unions promotions, mapped favorites, raw surfline favorites, and stretches", () => {
  const wanted = buildWantedIds({
    promotions: { promoted: [{ surflineSpotId: "surfline-promoted" }, { surflineSpotId: "surfline-overlap" }] },
    enrichment: {
      entries: [
        { id: "favorite-meo", surfMetadata: { sourceSpotId: "surfline-mapped" } }
      ]
    },
    defaultFavoriteIds: ["favorite-meo", "surfline-raw-favorite", "surfline-overlap"],
    stretches: {
      stretches: [
        { surflineSpotIds: ["surfline-stretch", "surfline-mapped"] }
      ]
    }
  });

  assert.deepEqual(wanted, [
    "surfline-mapped",
    "surfline-overlap",
    "surfline-promoted",
    "surfline-raw-favorite",
    "surfline-stretch"
  ]);
});

test("passesValidityFloor: keeps the shared 80% refresh coverage contract", () => {
  assert.equal(passesValidityFloor(8, 10, 5, 0.8), true);
  assert.equal(passesValidityFloor(7, 10, 5, 0.8), false);
});
