import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { mergeAdviceGuideSubjects, mergePromotedSpots } from "../src/camera-data.js";
import {
  extractSurflineCameraId,
  normalizeRawSurflineFeeds,
  resolveFeedBackedCameras
} from "../src/feed-policy.js";
import { normalizeSpotAdviceRuntime } from "../src/spot-advice.js";

function spotData(byCameraId = {}) {
  return {
    advice: normalizeSpotAdviceRuntime({
      subjects: {
        "surfline-alpha": { id: "surfline-alpha", name: "Alpha" },
        "surfline-no-feed": { id: "surfline-no-feed", name: "No feed" }
      },
      identityReport: { byCameraId }
    })
  };
}

function registry(rows) {
  return { __rawSurflineFeeds: rows };
}

const RAW_MATCHES = new Map([
  ["surfline-nazare", "pt-nazareov"],
  ["surfline-baleal", "pt-baleal"],
  ["surfline-lagide", "pt-lagide"],
  ["surfline-cantinho-da-baia", "pt-baiaoverview"],
  ["surfline-supertubos", "pt-supertubosoverview"],
  ["surfline-ribeira-d-ilhas", "pt-ribeiradeilhas"],
  ["surfline-reef", "pt-reef"],
  ["surfline-pedra-branca", "pt-pedrabranca"],
  ["surfline-praia-do-sul", "pt-praiadosulericeira"],
  ["surfline-foz-do-lizandro", "pt-fozdolizandro"],
  ["surfline-praia-pequena", "pt-praiapequena"],
  ["surfline-praia-grande", "pt-praiagrande"],
  ["surfline-praia-do-guincho", "pt-guincho"],
  ["surfline-paco-de-arcos", "pt-pacodearcos"],
  ["surfline-santo-amaro", "pt-santoamaro"],
  ["surfline-carcavelos", "pt-carcavelosov"],
  ["surfline-cova-do-vapor", "pt-covadovapor"],
  ["surfline-sao-joao-da-caparica", "pt-saojoaocaparica"],
  ["surfline-praia-do-barbas", "pt-barbas"],
  ["surfline-costa-da-caparica", "pt-costadacaparicaoverview"],
  ["surfline-castelo", "pt-castelo"],
  ["surfline-fonte-da-telha", "pt-fontedatelhafront"]
]);

test("normalizeRawSurflineFeeds accepts the first valid HTTPS entry per safe id", () => {
  const feeds = normalizeRawSurflineFeeds({
    __rawSurflineFeeds: [
      { id: "pt-good", streamUrl: "http://example.test/rejected.m3u8" },
      {
        id: "pt-good",
        streamUrl: "https://hls.example.test/good.m3u8",
        image: "https://images.example.test/good.jpg"
      },
      { id: "pt-good", streamUrl: "https://hls.example.test/duplicate.m3u8" },
      { id: "__meta", streamUrl: "https://hls.example.test/meta.m3u8" },
      { id: "bad/id", streamUrl: "https://hls.example.test/bad.m3u8" },
      {
        id: "pt-bad-image",
        streamUrl: "https://hls.example.test/bad-image.m3u8",
        image: "javascript:alert(1)"
      }
    ],
    "pt-top-level": { streamUrl: "https://hls.example.test/top-level.m3u8" }
  });

  assert.deepEqual([...feeds], [["pt-good", {
    id: "pt-good",
    streamUrl: "https://hls.example.test/good.m3u8",
    image: "https://images.example.test/good.jpg"
  }]]);
});

test("extractSurflineCameraId accepts only the known still host and safe final directory", () => {
  assert.equal(
    extractSurflineCameraId("https://camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"),
    "pt-carcavelosov"
  );
  assert.equal(
    extractSurflineCameraId("https://example.test/eu-west-1/pt-carcavelosov/latest_small.jpg"),
    null
  );
  assert.equal(
    extractSurflineCameraId("http://camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"),
    null
  );
  assert.equal(
    extractSurflineCameraId("https://user@camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"),
    null
  );
  assert.equal(
    extractSurflineCameraId("https://camstills.cdn-surfline.com:444/eu-west-1/pt-carcavelosov/latest_small.jpg"),
    null
  );
  assert.equal(
    extractSurflineCameraId("https://camstills.cdn-surfline.com/eu-west-1/bad%2Fid/latest_small.jpg"),
    null
  );
});

test("raw Surfline feed wins for promoted and trusted native representations", () => {
  const cameras = [
    {
      id: "meo-alpha",
      streamUrl: "https://meo.example/alpha.m3u8",
      image: "https://meo.example/alpha.jpg",
      hasStream: true,
      livecamId: "42"
    },
    {
      id: "surfline-alpha",
      promoted: true,
      linkedCamId: "meo-alpha",
      surflineCams: [
        { stillUrl: "https://bad.example/eu-west-1/pt-missing/latest_small.jpg" },
        { stillUrl: "https://camstills.cdn-surfline.com/eu-west-1/pt-alpha/latest_small.jpg" }
      ]
    }
  ];
  const resolved = resolveFeedBackedCameras(
    { cameras },
    spotData({ "meo-alpha": "surfline-alpha" }),
    registry([{
      id: "pt-alpha",
      streamUrl: "https://surfline.example/alpha.m3u8",
      image: "https://surfline.example/alpha.jpg"
    }])
  );

  assert.deepEqual(
    resolved.map(({ id, streamSource, feedCameraId, streamUrl }) => ({
      id,
      streamSource,
      feedCameraId,
      streamUrl
    })),
    [
      {
        id: "meo-alpha",
        streamSource: "surfline-raw",
        feedCameraId: "pt-alpha",
        streamUrl: "https://surfline.example/alpha.m3u8"
      },
      {
        id: "surfline-alpha",
        streamSource: "surfline-raw",
        feedCameraId: "pt-alpha",
        streamUrl: "https://surfline.example/alpha.m3u8"
      }
    ]
  );
  assert.equal(resolved.every((camera) => camera.hasStream), true);
  assert.equal(resolved.every((camera) => camera.image === "https://surfline.example/alpha.jpg"), true);
});

test("the first provider-ordered matching raw camera wins", () => {
  const resolved = resolveFeedBackedCameras({ cameras: [{
    id: "surfline-alpha",
    promoted: true,
    linkedCamId: null,
    surflineCams: [
      { stillUrl: "https://camstills.cdn-surfline.com/eu-west-1/pt-first/latest_small.jpg" },
      { stillUrl: "https://camstills.cdn-surfline.com/eu-west-1/pt-second/latest_small.jpg" }
    ]
  }] }, spotData(), registry([
    { id: "pt-first", streamUrl: "https://surfline.example/first.m3u8" },
    { id: "pt-second", streamUrl: "https://surfline.example/second.m3u8" }
  ]));

  assert.equal(resolved[0].feedCameraId, "pt-first");
  assert.equal(resolved[0].streamUrl, "https://surfline.example/first.m3u8");
});

test("promoted subjects use only exact linked MEO fallback and never stretch cameras", () => {
  const resolved = resolveFeedBackedCameras({ cameras: [
    {
      id: "meo-alpha",
      streamUrl: "https://meo.example/alpha.m3u8",
      image: "https://meo.example/alpha.jpg",
      hasStream: true,
      livecamId: "42"
    },
    { id: "stretch", streamUrl: "https://meo.example/stretch.m3u8", hasStream: true },
    {
      id: "surfline-alpha",
      promoted: true,
      linkedCamId: "meo-alpha",
      stretchCamIds: ["stretch"],
      surflineCams: []
    },
    {
      id: "surfline-no-feed",
      promoted: true,
      linkedCamId: null,
      stretchCamIds: ["stretch"],
      surflineCams: []
    }
  ] }, spotData({ "meo-alpha": "surfline-alpha" }), registry([]));

  const alpha = resolved.find((camera) => camera.id === "surfline-alpha");
  assert.equal(alpha.streamSource, "meo");
  assert.equal(alpha.feedCameraId, "42");
  assert.equal(alpha.streamUrl, "https://meo.example/alpha.m3u8");
  assert.equal(alpha.image, "https://meo.example/alpha.jpg");
  assert.equal(resolved.some((camera) => camera.id === "surfline-no-feed"), false);
  assert.equal(resolved.some((camera) => camera.id === "stretch"), true);
});

test("an unrelated native MEO camera retains its stream and missing feeds are excluded", () => {
  const resolved = resolveFeedBackedCameras({ cameras: [
    { id: "native", streamUrl: "https://meo.example/native.m3u8", hasStream: true },
    { id: "broken", streamUrl: "", hasStream: false },
    {
      id: "surfline-orphan",
      provider: "surfline",
      streamUrl: "https://legacy.example/orphan.m3u8",
      hasStream: true
    }
  ] }, spotData(), registry([]));

  assert.deepEqual(
    resolved.map(({ id, streamSource, feedCameraId }) => ({ id, streamSource, feedCameraId })),
    [{ id: "native", streamSource: "meo", feedCameraId: "native" }]
  );
});

test("the real 44-subject fixture resolves to the approved provider partition", () => {
  const cameraDb = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));
  const promotedDb = JSON.parse(fs.readFileSync("data/promoted-spots.json", "utf8"));
  const adviceDb = JSON.parse(fs.readFileSync("data/spot-advice-resolved.json", "utf8"));
  const advice = normalizeSpotAdviceRuntime(adviceDb);
  const canonicalDb = mergeAdviceGuideSubjects(
    mergePromotedSpots(cameraDb, promotedDb),
    advice
  );
  const localOverrides = registry([...RAW_MATCHES.values()].map((id) => ({
    id,
    streamUrl: `https://hls.example.test/${id}.m3u8`,
    image: `https://images.example.test/${id}.jpg`
  })));

  const resolved = resolveFeedBackedCameras(canonicalDb, { advice }, localOverrides);
  const resolvedById = new Map(resolved.map((camera) => [camera.id, camera]));
  const promotedIds = new Set(promotedDb.promoted.map((camera) => camera.id));
  const resolvedPromoted = resolved.filter((camera) => promotedIds.has(camera.id));
  const surflineRaw = resolvedPromoted
    .filter((camera) => camera.streamSource === "surfline-raw")
    .map((camera) => camera.id);
  const meo = resolvedPromoted
    .filter((camera) => camera.streamSource === "meo")
    .map((camera) => camera.id);
  const excludedPromoted = promotedDb.promoted
    .map((camera) => camera.id)
    .filter((id) => !resolvedById.has(id));

  assert.deepEqual(surflineRaw, [...RAW_MATCHES.keys()]);
  assert.deepEqual(meo, [
    "surfline-consolacao",
    "surfline-santa-cruz",
    "surfline-matadouro",
    "surfline-sao-juliao",
    "surfline-praia-das-macas",
    "surfline-praia-da-adraga",
    "surfline-sao-pedro-do-estoril",
    "surfline-parede",
    "surfline-praia-da-laje",
    "surfline-praia-de-torre",
    "surfline-praia-da-rainha",
    "surfline-lagoa-de-albufeira",
    "surfline-bicas",
    "surfline-sesimbra"
  ]);
  assert.deepEqual(excludedPromoted, [
    "surfline-praia-de-caxias",
    "surfline-marcelino",
    "surfline-praia-da-saude",
    "surfline-praia-da-cornelia",
    "surfline-praia-do-pescador",
    "surfline-praia-do-rei"
  ]);
  assert.equal(resolvedById.has("surfline-cave"), false);
  assert.equal(resolvedById.has("surfline-praia-da-ursa"), false);
  assert.equal(advice.subjectsById.size, 44);
  assert.deepEqual(
    advice.identityReport.selectedSurflineIds.filter((id) => (
      !canonicalDb.cameras.some((camera) => camera.id === id)
    )),
    []
  );
});
