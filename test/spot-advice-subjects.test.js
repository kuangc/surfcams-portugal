import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  firstClassCameras,
  mergeAdviceGuideSubjects,
  mergePromotedSpots,
  routeCameraPlayback,
  sanitizeFavoriteIds
} from "../src/camera-data.js";
import { filterCameras } from "../src/camera-filters.js";
import { formatSpotPlaybook, normalizeSpotAdviceRuntime } from "../src/spot-advice.js";
import { normalizeSpotData } from "../src/spot-data.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

const cameraDb = readJson("data/beachcam-cameras.json");
const promotedDb = readJson("data/promoted-spots.json");
const promotionRoster = readJson("data/surfline-promotions.json");
const adviceDb = readJson("data/spot-advice-resolved.json");
const adviceRuntime = normalizeSpotAdviceRuntime(adviceDb);
const spotData = normalizeSpotData({ promotedDb, adviceDb });

function mergeActualAppSubjects() {
  return mergeAdviceGuideSubjects(
    mergePromotedSpots(cameraDb, promotedDb),
    adviceRuntime
  );
}

test("mergeAdviceGuideSubjects adds deferred selected spots without inventing cameras", () => {
  const merged = mergeAdviceGuideSubjects({ cameras: [] }, adviceRuntime);

  assert.deepEqual(
    merged.cameras.map((row) => row.id),
    ["surfline-cave", "surfline-praia-da-ursa"]
  );
  for (const row of merged.cameras) {
    assert.equal(row.adviceGuideOnly, true);
    assert.equal(Object.hasOwn(row, "streamUrl"), false);
    assert.equal(Object.hasOwn(row, "hasStream"), false);
    assert.equal(Object.hasOwn(row, "forecast"), false);
    assert.equal(Object.hasOwn(row, "conditions"), false);
    assert.equal(Number.isFinite(row.lat), true);
    assert.equal(Number.isFinite(row.lon), true);
    assert.match(row.surfline.pageUrl, /^https:\/\//);
  }
});

test("mergeAdviceGuideSubjects appends deterministically without mutating its inputs", () => {
  const input = { marker: "kept", cameras: [{ id: "real-camera", name: "Real" }] };
  const before = structuredClone(input);
  const runtime = normalizeSpotAdviceRuntime({
    subjects: {
      "guide-b": {
        id: "guide-b",
        name: "Guide B",
        region: "South",
        lat: 38.4,
        lon: -9.1,
        guideOnly: true,
        surfline: { pageUrl: "https://example.com/b" }
      },
      "guide-a": {
        id: "guide-a",
        name: "Guide A",
        region: "North",
        lat: 39.1,
        lon: -9.4,
        guideOnly: true,
        surfline: { pageUrl: "https://example.com/a" }
      }
    }
  });

  const merged = mergeAdviceGuideSubjects(input, runtime);

  assert.deepEqual(input, before);
  assert.notEqual(merged, input);
  assert.notEqual(merged.cameras, input.cameras);
  assert.deepEqual(merged.cameras.map((row) => row.id), ["real-camera", "guide-b", "guide-a"]);
  merged.cameras[1].surfline.pageUrl = "https://changed.example/";
  assert.equal(runtime.subjectsById.get("guide-b").surfline.pageUrl, "https://example.com/b");
});

test("mergeAdviceGuideSubjects ignores malformed guides and omits unsafe page URLs", () => {
  const runtime = normalizeSpotAdviceRuntime({
    subjects: {
      "not-a-guide": {
        id: "not-a-guide",
        name: "Not a guide",
        region: "Region",
        lat: 38,
        lon: -9,
        guideOnly: false
      },
      "missing-name": {
        id: "missing-name",
        region: "Region",
        lat: 38,
        lon: -9,
        guideOnly: true
      },
      "bad-coordinate": {
        id: "bad-coordinate",
        name: "Bad coordinate",
        region: "Region",
        lat: "38",
        lon: -9,
        guideOnly: true
      },
      "out-of-range": {
        id: "out-of-range",
        name: "Out of range",
        region: "Region",
        lat: 91,
        lon: -9,
        guideOnly: true
      },
      "unsafe-guide": {
        id: "unsafe-guide",
        name: "Unsafe guide",
        region: "Region",
        lat: 38,
        lon: -9,
        guideOnly: true,
        surfline: { pageUrl: "javascript:alert(1)" }
      }
    }
  });

  const merged = mergeAdviceGuideSubjects({ cameras: [] }, runtime);

  assert.deepEqual(merged.cameras.map((row) => row.id), ["unsafe-guide"]);
  assert.equal(Object.hasOwn(merged.cameras[0], "surfline"), false);
});

test("guide merge requires canonical exact map identity and rejects prototype-like ids", () => {
  const subject = (id) => ({
    id,
    name: id,
    region: "Region",
    lat: 38,
    lon: -9,
    guideOnly: true,
    claims: [{ id: `${id}-claim` }]
  });
  const runtime = {
    subjectsById: new Map([
      ["canonical-guide", subject("canonical-guide")],
      ["map-key", subject("different-value-id")],
      [" whitespace-guide ", subject(" whitespace-guide ")],
      ["constructor", subject("constructor")],
      ["__proto__", subject("__proto__")]
    ])
  };

  const merged = mergeAdviceGuideSubjects({ cameras: [] }, runtime);

  assert.deepEqual(merged.cameras.map((row) => row.id), ["canonical-guide"]);
  const playbookData = {
    advice: normalizeSpotAdviceRuntime({
      subjects: { "canonical-guide": subject("canonical-guide") }
    })
  };
  assert.equal(formatSpotPlaybook(merged.cameras[0], playbookData).subjectId, "canonical-guide");
});

test("real and promoted records win guide identity collisions", () => {
  const runtime = normalizeSpotAdviceRuntime({
    subjects: {
      real: {
        id: "real",
        name: "Guide duplicate",
        region: "Region",
        lat: 38,
        lon: -9,
        guideOnly: true
      },
      promoted: {
        id: "promoted",
        name: "Guide duplicate",
        region: "Region",
        lat: 38,
        lon: -9,
        guideOnly: true
      }
    }
  });
  const input = { cameras: [
    { id: "real", name: "Real camera", streamUrl: "https://example.com/live.m3u8" },
    { id: "promoted", name: "Promoted spot", promoted: true }
  ] };

  const merged = mergeAdviceGuideSubjects(input, runtime);

  assert.equal(merged, input);
  assert.deepEqual(merged.cameras.map((row) => row.name), ["Real camera", "Promoted spot"]);
});

test("empty or failed advice leaves the camera database unchanged", () => {
  const input = { cameras: [{ id: "real" }] };

  assert.equal(mergeAdviceGuideSubjects(input, null), input);
  assert.equal(mergeAdviceGuideSubjects(input, {}), input);
  assert.equal(mergeAdviceGuideSubjects(input, { subjectsById: new Map() }), input);
  assert.equal(mergeAdviceGuideSubjects(input, { subjectsById: "bad" }), input);
});

test("persisted guide favorites are removed while real favorites retain their order", () => {
  const cameras = [
    { id: "real-a" },
    { id: "guide", adviceGuideOnly: true },
    { id: "real-b" }
  ];
  const persisted = new Set(["real-b", "guide", "missing", "real-a"]);

  assert.deepEqual([...sanitizeFavoriteIds(cameras, persisted)], ["real-b", "real-a"]);
});

test("guide playback always clears and never reaches the live player path", () => {
  for (const guide of [
    { id: "guide-safe", adviceGuideOnly: true, surfline: { pageUrl: "https://example.com/guide" } },
    { id: "guide-no-url", adviceGuideOnly: true },
    { id: "guide-unsafe", adviceGuideOnly: true, surfline: { pageUrl: "javascript:alert(1)" } }
  ]) {
    const calls = { clear: 0, play: [] };
    const mode = routeCameraPlayback(guide, null, {
      clear() { calls.clear += 1; },
      play(camera) { calls.play.push(camera.id); }
    });
    assert.equal(mode, "guide");
    assert.equal(calls.clear, 1);
    assert.deepEqual(calls.play, []);
  }
});

test("all 44 selected advice subjects are inspectable after the real app merges", () => {
  const merged = mergeActualAppSubjects();
  const inspectableIds = new Set(merged.cameras.map((row) => row.id));
  const selectedIds = promotionRoster.promoted.map((row) => row.surflineSpotId);

  assert.equal(selectedIds.length, 44);
  assert.deepEqual(
    selectedIds.filter((id) => !inspectableIds.has(id)),
    []
  );
});

test("deferred guides survive the real Explore collection, search, and playbook selection", () => {
  const exploreCollection = firstClassCameras(mergeActualAppSubjects());

  for (const [query, expectedId] of [
    ["Cave", "surfline-cave"],
    ["Praia da Ursa", "surfline-praia-da-ursa"]
  ]) {
    const matches = filterCameras(exploreCollection, { query });
    const guide = matches.find((camera) => camera.id === expectedId);
    assert.ok(guide, `${expectedId} is present in the Explore search results`);
    assert.equal(guide.adviceGuideOnly, true);
    assert.equal(Object.hasOwn(guide, "streamUrl"), false);
    const playbook = formatSpotPlaybook(guide, spotData);
    assert.equal(playbook.guideOnly, true);
    assert.ok(playbook.sections.some((section) => section.claims.length > 0));
    assert.equal(matches[0].id, expectedId, `${query} exact-name result is deterministic`);
  }

  const caveMatches = filterCameras(exploreCollection, { query: "Cave" });
  assert.ok(caveMatches.some((camera) => /carcavelos/i.test(camera.name)), "legacy substring matches remain visible after exact Cave");
});

test("main wires guides after metadata and promotion merges and labels them without live claims", () => {
  const source = fs.readFileSync("src/main.js", "utf8");

  assert.match(source, /mergeAdviceGuideSubjects\(\s*mergePromotedSpots\(\s*applySpotMetadataToCameraDb\(cameraDb, spotData\),\s*spotData\.promotedDb\s*\),\s*spotData\.advice\s*\)/s);
  assert.match(source, /Guide only[^"'`]*no live camera or conditions/i);
  assert.match(source, /camera\.adviceGuideOnly/);
  assert.match(source, /sanitizeFavoriteIds\(manageSpotCameras\(\), loadFavoriteIds\(/);
  assert.match(source, /button\.hidden = Boolean\(camera\?\.adviceGuideOnly\)/);
  assert.match(source, /camera\.adviceGuideOnly\s*\?\s*\{ key: "guide" \}\s*:\s*rateSurfSpot/s);
  assert.match(source, /routeCameraPlayback\(camera, linked, state\.explorePlayer\)/);
});
