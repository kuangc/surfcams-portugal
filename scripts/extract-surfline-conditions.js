// scripts/extract-surfline-conditions.js
import fs from "node:fs/promises";
import path from "node:path";
import { parseNextDataState, extractConditionsRecords } from "./lib/surfline-extract.js";

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.match(/^--([^=]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const CACHE_DIR = args["cache-dir"] || ".cache/surfline/pages";
const OUT_FILE = args.out || "data/surfline-conditions.json";
const MIN_VALID_RATIO = 0.5; // structural validity floor for a full-cache extraction

const surflineDb = JSON.parse(await fs.readFile("data/surfline-spots.json", "utf8"));
const idByRemote = new Map(surflineDb.spots.map((s) => [s.remoteSpotId, s.id]));

const files = (await fs.readdir(CACHE_DIR)).filter((f) => f.endsWith(".html"));
const conditions = {};
let pagesParsed = 0;
for (const file of files) {
  const html = await fs.readFile(path.join(CACHE_DIR, file), "utf8");
  const meta = JSON.parse(await fs.readFile(path.join(CACHE_DIR, file.replace(/\.html$/, ".json")), "utf8").catch(() => "{}"));
  const state = parseNextDataState(html);
  if (!state) continue;
  pagesParsed += 1;
  const records = extractConditionsRecords(state, {
    fetchedAt: meta.fetchedAt || null,
    idFor: (_name, remoteId) => idByRemote.get(remoteId) || null
  });
  for (const rec of records) {
    if (!rec.id) continue;
    const existing = conditions[rec.id];
    // primary beats nearby; newer beats older
    if (!existing || (rec.sourceKind === "primary" && existing.sourceKind !== "primary")
      || (rec.sourceKind === existing.sourceKind && String(rec.fetchedAt) > String(existing.fetchedAt))) {
      conditions[rec.id] = rec;
    }
  }
}

if (pagesParsed < files.length * MIN_VALID_RATIO || Object.keys(conditions).length === 0) {
  console.error(`extract-surfline-conditions: only ${pagesParsed}/${files.length} pages parsed; refusing to write`);
  process.exit(1);
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  unitsNormalized: { surfHeight: "m", windSpeed: "kmh" },
  source: { cacheDir: CACHE_DIR, pagesParsed },
  total: Object.keys(conditions).length,
  conditions
};
await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 1) + "\n");
console.log(`wrote ${OUT_FILE}: ${payload.total} spots from ${pagesParsed} pages`);
