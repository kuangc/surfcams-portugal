// scripts/extract-surfline-conditions.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseNextDataState, extractConditionsRecords } from "./lib/surfline-extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MIN_VALID_RATIO = 0.5; // structural validity floor for a full-cache extraction

export function parseCliArgs(argv, { knownFlags = ["--cache-dir", "--out"] } = {}) {
  const values = {};
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.match(/^(--[^=]+)=(.*)$/);
    const flag = eq ? eq[1] : arg;
    if (!flag.startsWith("--")) { errors.push(`Unexpected argument: ${arg}`); continue; }
    if (!knownFlags.includes(flag)) { errors.push(`Unknown argument: ${flag}`); continue; }
    let value = eq ? eq[2] : argv[i + 1];
    if (!eq) i += 1;
    if (value === undefined || value === "" || String(value).startsWith("--")) {
      errors.push(`Missing value for ${flag}`);
      if (!eq && String(value || "").startsWith("--")) i -= 1; // don't swallow the next flag
      continue;
    }
    values[flag] = value;
  }
  return { values, errors };
}

// primary beats nearby; newer beats older (within the same kind)
export function shouldReplace(existing, candidate) {
  if (!existing) return true;
  if (candidate.sourceKind === "primary" && existing.sourceKind !== "primary") return true;
  if (candidate.sourceKind === existing.sourceKind && String(candidate.fetchedAt) > String(existing.fetchedAt)) return true;
  return false;
}

export function passesValidityFloor(pagesParsed, fileCount, conditionCount, ratio = MIN_VALID_RATIO) {
  return pagesParsed >= fileCount * ratio && conditionCount > 0;
}

async function main() {
  const { values, errors } = parseCliArgs(process.argv.slice(2));
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const DEFAULT_CACHE_DIR = path.join(ROOT, ".cache", "surfline", "pages");
  const DEFAULT_OUT_FILE = path.join(ROOT, "data", "surfline-conditions.json");
  const CACHE_DIR = values["--cache-dir"] ? path.resolve(values["--cache-dir"]) : DEFAULT_CACHE_DIR;
  const OUT_FILE = values["--out"] ? path.resolve(values["--out"]) : DEFAULT_OUT_FILE;

  const surflineDb = JSON.parse(await fs.readFile(SURFLINE_DB_PATH, "utf8"));
  const idByRemote = new Map(surflineDb.spots.map((s) => [s.remoteSpotId, s.id]));

  const files = (await fs.readdir(CACHE_DIR)).filter((f) => f.endsWith(".html")).sort();
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
      if (shouldReplace(conditions[rec.id], rec)) {
        conditions[rec.id] = rec;
      }
    }
  }

  if (!passesValidityFloor(pagesParsed, files.length, Object.keys(conditions).length)) {
    console.error(`extract-surfline-conditions: only ${pagesParsed}/${files.length} pages parsed; refusing to write`);
    process.exitCode = 1;
    return;
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
  console.log(`Wrote ${OUT_FILE}: ${payload.total} spots from ${pagesParsed} pages`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
