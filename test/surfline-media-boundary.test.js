import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const FORBIDDEN_CAMERA_MEDIA_HOST = /hls\.cdn-surfline\.com|camstills\.cdn-surfline\.com|__rawSurflineFeeds/i;
const FORBIDDEN_CAMERA_MEDIA_SCHEMA = /surflineCams|stillUrl/i;

function productionFiles() {
  const files = ["index.html"];
  for (const directory of ["src", "scripts", "data"]) {
    const queue = [path.join(ROOT, directory)];
    while (queue.length) {
      const current = queue.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(fullPath);
        else if (/\.(?:c?js|css|html|json)$/i.test(entry.name)) files.push(path.relative(ROOT, fullPath));
      }
    }
  }
  return files.sort();
}

test("production assets contain no Surfline camera streams, stills, or camera-media schema", () => {
  const files = productionFiles();
  const mediaHostViolations = files
    .filter((file) => FORBIDDEN_CAMERA_MEDIA_HOST.test(fs.readFileSync(file, "utf8")));
  const schemaViolations = files
    .filter((file) => /^(?:data\/|scripts\/)/.test(file))
    .filter((file) => FORBIDDEN_CAMERA_MEDIA_SCHEMA.test(fs.readFileSync(file, "utf8")));

  assert.deepEqual(mediaHostViolations, []);
  assert.deepEqual(schemaViolations, []);
  assert.equal(fs.existsSync("data/local-stream-overrides.json"), false);
  assert.equal(fs.existsSync("data/local-stream-overrides.example.json"), false);
});

test("Surfline remains available as wave intelligence without camera media", () => {
  const spots = JSON.parse(fs.readFileSync("data/surfline-spots.json", "utf8"));
  const conditions = JSON.parse(fs.readFileSync("data/surfline-conditions.json", "utf8"));
  const advice = JSON.parse(fs.readFileSync("data/spot-advice-resolved.json", "utf8"));

  assert.ok(spots.spots.length > 0);
  assert.ok(spots.spots.every((spot) => /^https:\/\/www\.surfline\.com\/surf-report\//.test(spot.url)));
  assert.ok(spots.spots.some((spot) => spot.staticMetadata?.travelDetails || spot.staticMetadata?.coastExposure));
  assert.ok(Object.keys(conditions.conditions || {}).length > 0);
  assert.ok(JSON.stringify(advice).includes("surfline"));
});
