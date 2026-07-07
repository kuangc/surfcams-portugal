import assert from "node:assert/strict";
import test from "node:test";

import { stretchMembers } from "../src/stretch-view.js";

test("stretchMembers lists cams and spots in stretch order with conditions", () => {
  const stretch = {
    id: "caparica",
    name: "Caparica stretch",
    surflineSpotIds: ["surfline-beta"],
    meoCamIds: ["cam-strip"]
  };
  const spotData = {
    stretchBySpotId: new Map([["surfline-beta", stretch]]),
    conditionsById: new Map([["surfline-beta", { rating: "FAIR" }]])
  };
  const camerasById = new Map([
    ["cam-strip", { id: "cam-strip", name: "Cam Strip" }],
    ["surfline-beta", {
      id: "surfline-beta",
      name: "Surfline Beta",
      promoted: true,
      surflineCams: [{ title: "Beta Cam", stillUrl: "https://example.test/beta.jpg" }]
    }]
  ]);

  const members = stretchMembers(camerasById.get("surfline-beta"), spotData, camerasById);

  assert.equal(members.stretchName, "Caparica stretch");
  assert.deepEqual(members.cams.map((cam) => cam.id), ["cam-strip"]);
  assert.equal(members.spots[0].conditions.rating, "FAIR");
  assert.equal(members.spots[0].stillUrl, "https://example.test/beta.jpg");
});

test("stretchMembers resolves stretch metadata from a cam member id", () => {
  const stretch = {
    id: "caparica",
    name: "Caparica stretch",
    surflineSpotIds: ["surfline-beta"],
    meoCamIds: ["cam-strip"]
  };
  const spotData = {
    stretchBySpotId: new Map([
      ["surfline-beta", stretch],
      ["cam-strip", stretch]
    ]),
    conditionsById: new Map()
  };
  const camerasById = new Map([
    ["cam-strip", { id: "cam-strip", name: "Cam Strip" }],
    ["surfline-beta", { id: "surfline-beta", name: "Surfline Beta" }]
  ]);

  const members = stretchMembers({ id: "cam-strip" }, spotData, camerasById);

  assert.equal(members.stretchName, "Caparica stretch");
});

test("returns null for non-stretch spots", () => {
  const members = stretchMembers(
    { id: "surfline-outside", name: "Outside" },
    { stretchBySpotId: new Map(), conditionsById: new Map() },
    new Map()
  );

  assert.equal(members, null);
});
