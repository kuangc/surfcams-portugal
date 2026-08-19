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
    conditionsById: new Map([["surfline-beta", { rating: "FAIR" }]]),
    surflineById: new Map([["surfline-beta", {
      id: "surfline-beta",
      name: "Surfline Beta",
      staticMetadata: {
        surflineCams: [{ title: "Beta Cam", stillUrl: "https://example.test/beta.jpg" }]
      }
    }]])
  };
  const camerasById = new Map([
    ["cam-strip", { id: "cam-strip", name: "Cam Strip" }]
  ]);

  const members = stretchMembers({ id: "surfline-beta" }, spotData, camerasById);

  assert.equal(members.stretchName, "Caparica stretch");
  assert.deepEqual(members.cams.map((cam) => cam.id), ["cam-strip"]);
  assert.equal(members.spots[0].name, "Surfline Beta");
  assert.equal(members.spots[0].conditions.rating, "FAIR");
  assert.equal(Object.hasOwn(members.spots[0], "stillUrl"), false);
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
    conditionsById: new Map(),
    surflineById: new Map([["surfline-beta", { id: "surfline-beta", name: "Surfline Beta" }]])
  };
  const camerasById = new Map([
    ["cam-strip", { id: "cam-strip", name: "Cam Strip" }]
  ]);

  const members = stretchMembers({ id: "cam-strip" }, spotData, camerasById);

  assert.equal(members.stretchName, "Caparica stretch");
  assert.deepEqual(members.spots.map((spot) => spot.id), ["surfline-beta"]);
});

test("stretchMembers uses promoted metadata only as a safe Surfline-name fallback", () => {
  const stretch = {
    id: "fallback",
    name: "Fallback stretch",
    surflineSpotIds: ["surfline-fallback"],
    meoCamIds: ["cam-fallback"]
  };
  const spotData = {
    stretchBySpotId: new Map([["cam-fallback", stretch]]),
    conditionsById: new Map(),
    surflineById: new Map(),
    promotedById: new Map([
      ["surfline-fallback", { id: "surfline-fallback", name: "Fallback Surfline name" }]
    ])
  };

  const members = stretchMembers(
    { id: "cam-fallback" },
    spotData,
    new Map([["cam-fallback", { id: "cam-fallback", name: "Playable MEO cam" }]])
  );

  assert.equal(members.spots[0].name, "Fallback Surfline name");
  assert.equal(Object.hasOwn(members.spots[0], "stillUrl"), false);
});

test("returns null for non-stretch spots", () => {
  const members = stretchMembers(
    { id: "surfline-outside", name: "Outside" },
    { stretchBySpotId: new Map(), conditionsById: new Map() },
    new Map()
  );

  assert.equal(members, null);
});
