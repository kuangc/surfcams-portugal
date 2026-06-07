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

test("camera list rows keep only pre-click surf decision signals", () => {
  assert.match(mainSource, /windFit\.textContent = rating\.wind\.alignment/);
  assert.doesNotMatch(mainSource, /conditions\.append\(score, wave, coast, wind\)/);
  assert.doesNotMatch(mainSource, /wind\.textContent = rating\.wind\.label/);
  assert.doesNotMatch(mainSource, /coast\.textContent = exposure\.shortLabel/);
});

test("direction visualization notes can wrap instead of truncating", () => {
  const noteRules = [...styleSource.matchAll(/\.vector-note\s*\{(?<body>[^}]+)\}/g)];
  const noteRule = noteRules.at(-1)?.groups?.body || "";

  assert.match(noteRule, /white-space:\s*normal/);
  assert.match(noteRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(noteRule, /text-overflow:\s*ellipsis/);
});
