// scripts/extract-surfline-conditions.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseNextDataState, extractConditionsRecords } from "./lib/surfline-extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MIN_VALID_RATIO = 0.5; // structural validity floor for a full-cache extraction

const args = process.argv.slice(2);

function readArg(name) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function unknownArgument() {
  const known = new Set(["--cache-dir", "--out"]);
  return args.find((arg) => arg.startsWith("--")
    && ![...known].some((name) => arg === name || arg.startsWith(`${name}=`)));
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
  const badArg = unknownArgument();
  if (badArg) {
    console.error(`Unknown argument: ${badArg}`);
    process.exitCode = 1;
    return;
  }

  const CACHE_DIR = readArg("--cache-dir") || path.join(ROOT, ".cache", "surfline", "pages");
  const OUT_FILE = readArg("--out") || path.join(ROOT, "data", "surfline-conditions.json");

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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
