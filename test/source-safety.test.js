import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const configSource = fs.readFileSync("src/config.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const videoSource = fs.readFileSync("src/video-player.js", "utf8");

test("main UI avoids selector interpolation from camera IDs", () => {
  assert.doesNotMatch(mainSource, /querySelector\(`\[data-camera-row=/);
  assert.match(mainSource, /row\.dataset\.cameraRow === cameraId/);
});

test("CDN dependencies are pinned to explicit versions", () => {
  assert.doesNotMatch(`${configSource}\n${videoSource}`, /@latest/);
  assert.match(configSource, /hls\.js@1\.6\.4/);
});

test("v3 source has monitor-first routing and no v2 monitor overlay", () => {
  assert.match(indexSource, /id="monitorScreen"[^>]*data-active="true"/);
  assert.doesNotMatch(indexSource, /id="monitorDeck"/);
  assert.doesNotMatch(indexSource, /bestTodayTitle/);
});

test("main controller wires v3 screens and keeps might-be-good explicit", () => {
  assert.match(mainSource, /activeRoute:\s*"monitor"/);
  assert.match(mainSource, /monitorMode:\s*"favorites"/);
  assert.match(mainSource, /monitorCameraSlots/);
  assert.match(mainSource, /mightBeGoodCameras/);
  assert.match(mainSource, /renderMonitor/);
  assert.match(mainSource, /renderFavorites/);
  assert.match(mainSource, /renderExploreSelection/);
  assert.match(mainSource, /renderConfigure/);
  assert.doesNotMatch(mainSource, /autoFill/i);
});
