import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const configSource = fs.readFileSync("src/config.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");
const videoSource = fs.readFileSync("src/video-player.js", "utf8");

test("main UI avoids selector interpolation from camera IDs", () => {
  assert.doesNotMatch(mainSource, /querySelector\(`\[data-camera-row=/);
  assert.match(mainSource, /row\.dataset\.cameraRow === cameraId/);
});

test("CDN dependencies are pinned to explicit versions", () => {
  assert.doesNotMatch(`${configSource}\n${videoSource}`, /@latest/);
  assert.match(configSource, /hls\.js@1\.6\.4/);
});

test("Leaflet CSS integrity matches the pinned CDN asset", () => {
  assert.match(
    indexSource,
    /leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="/
  );
});

test("surf rating UI avoids numeric precision labels", () => {
  assert.doesNotMatch(mainSource, /\$\{rating\.label\} \$\{rating\.score\}/);
  assert.doesNotMatch(mainSource, /Surf score/);
  assert.doesNotMatch(mainSource, /\/100/);
  assert.match(mainSource, /rating\.label/);
});

test("Best Today cards expose practical pre-click decision signals", () => {
  assert.match(mainSource, /surfDecision\(camera,\s*index\)/);
  assert.match(mainSource, /decision\.tide/);
  assert.match(mainSource, /decision\.wind/);
  assert.match(mainSource, /decision\.swell/);
  assert.match(mainSource, /decision\.period/);
  assert.match(mainSource, /decision\.confidence\.label/);
  assert.match(mainSource, /decision\.abilityFit/);
  assert.match(mainSource, /decision\.reason/);
});

test("main UI wires Best Today monitor helpers", () => {
  assert.match(mainSource, /surfDecision/);
  assert.match(mainSource, /monitorTileData/);
  assert.match(mainSource, /buildGroupSummary/);
  assert.match(mainSource, /createMonitorSelection/);
  assert.match(mainSource, /Add to Monitor/);
  assert.match(mainSource, /MONITOR_DURATION_SECONDS\s*=\s*60/);
  assert.match(mainSource, /navigator\.clipboard\.writeText/);
});

test("direction visualization notes can wrap instead of truncating", () => {
  const noteRules = [...styleSource.matchAll(/\.vector-note\s*\{(?<body>[^}]+)\}/g)];
  const noteRule = noteRules.at(-1)?.groups?.body || "";

  assert.match(noteRule, /white-space:\s*normal/);
  assert.match(noteRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(noteRule, /text-overflow:\s*ellipsis/);
});

test("styles define responsive Best Today and monitor deck behavior", () => {
  assert.match(styleSource, /\.best-today/);
  assert.match(styleSource, /\.monitor-bar/);
  assert.match(styleSource, /\.monitor-grid/);
  assert.match(styleSource, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styleSource, /@media \(max-width:\s*760px\)[\s\S]*\.monitor-grid/);
});
