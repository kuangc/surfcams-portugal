#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = path.join(ROOT, "index.html");
const DB_PATH = path.join(ROOT, "data", "beachcam-cameras.json");

function escapeScriptJson(json) {
  return json
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function main() {
  const [html, json] = await Promise.all([
    fs.readFile(INDEX_PATH, "utf8"),
    fs.readFile(DB_PATH, "utf8")
  ]);

  JSON.parse(json);

  const embedded = `<script id="embeddedCameraDb" type="application/json">${escapeScriptJson(json.trim())}</script>`;
  const nextHtml = html.replace(
    /<script id="embeddedCameraDb" type="application\/json">[\s\S]*?<\/script>/,
    embedded
  );

  if (nextHtml === html) {
    throw new Error("Could not find embeddedCameraDb script tag");
  }

  await fs.writeFile(INDEX_PATH, nextHtml, "utf8");
  console.log(`Embedded ${json.length} bytes from ${DB_PATH} into ${INDEX_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

