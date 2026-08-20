import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  mergeAdviceGuideSubjects,
  mergePromotedSpots,
  sanitizeFavoriteIds
} from "../src/camera-data.js";
import { resolveMeoPlaybackCameras } from "../src/feed-policy.js";
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

test("guide-only subjects remain canonical but never enter the feed-backed roster", () => {
  const merged = mergeActualAppSubjects();
  const resolved = resolveMeoPlaybackCameras(merged);
  const guideOnlyIds = ["surfline-cave", "surfline-praia-da-ursa"];

  for (const id of guideOnlyIds) {
    const guide = merged.cameras.find((camera) => camera.id === id);
    assert.ok(guide, `${id} remains in the canonical merged database`);
    assert.equal(guide.adviceGuideOnly, true);
    assert.equal(resolved.some((camera) => camera.id === id), false);
    const playbook = formatSpotPlaybook(guide, spotData);
    assert.equal(playbook.guideOnly, true);
    assert.ok(playbook.sections.some((section) => section.claims.length > 0));
  }
});

test("main keeps guide research canonical and resolves the user-facing roster afterward", () => {
  const source = fs.readFileSync("src/main.js", "utf8");

  assert.match(source, /const nativeCameraDb\s*=\s*applySpotMetadataToCameraDb\(cameraDb, spotData\)/);
  assert.match(source, /mergeAdviceGuideSubjects\(\s*mergePromotedSpots\(\s*nativeCameraDb,\s*spotData\.promotedDb\s*\),\s*spotData\.advice\s*\)/s);
  assert.match(source, /state\.cameras\s*=\s*sortCamerasByLatitudeDescending\(resolveMeoPlaybackCameras\(nativeCameraDb\)\)/s);
  assert.match(source, /state\.exploreSubjects\s*=\s*sortCamerasByLatitudeDescending\(\s*buildExploreCatalog\(state\.cameras,\s*state\.db\)/s);
  assert.match(source, /loadFavoriteIds\(state\.cameras, undefined, favoriteIdAliases\)/);
  assert.match(source, /state\.explorePlayer\.play\(playbackCamera\)/);
  assert.doesNotMatch(source, /routeCameraPlayback/);
});
