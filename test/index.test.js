import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const db = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));

test("index embeds the same camera database that lives in data", () => {
  const match = html.match(/<script id="embeddedCameraDb" type="application\/json">([\s\S]*?)<\/script>/);

  assert.ok(match, "embeddedCameraDb script tag exists");
  assert.ok(match[1].trim().length > 0, "embeddedCameraDb is populated");
  assert.deepEqual(JSON.parse(match[1]), db);
});

test("index loads the modular app and avoids removed click metadata UI", () => {
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /Clicks/);
  assert.doesNotMatch(html, /Copy URL/);
  assert.doesNotMatch(html, /id="streamUrl"/);
});

test("index explains the Good for us filter criteria", () => {
  assert.match(html, /id="fitExplanation"/);
  assert.match(html, /0\.3-1\.5m/);
  assert.match(html, /offshore/i);
  assert.match(html, /18 km\/h/);
  assert.match(html, /Fair to Good/);
  assert.match(html, /model rating/i);
  assert.doesNotMatch(html, /Surf score/i);
  assert.doesNotMatch(html, /\/100/);
});

test("index includes the condition direction visualization shell", () => {
  assert.match(html, /id="conditionVisual"/);
  assert.match(html, /id="coastVector"/);
  assert.match(html, /id="windVector"/);
  assert.match(html, /id="swellVector"/);
});
