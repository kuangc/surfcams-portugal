#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseNextDataState } from "./lib/surfline-extract.js";
import { parseCliArgs, passesValidityFloor } from "./extract-surfline-conditions.js";
import { DEFAULT_FAVORITE_IDS } from "../src/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CACHE_DIR = path.join(ROOT, ".cache", "surfline", "pages");
const CONDITIONS_OUT_FILE = path.join(ROOT, "data", "surfline-conditions.json");
const UA = "surfcams-portugal-refresh/1.0 (personal, low-volume; github.com/kuangc/surfcams-portugal)";
const REFRESH_VALID_RATIO = 0.8;

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function pageKeyFromSourceRecord(record) {
  const [, file = ""] = String(record || "").split(":");
  return path.basename(file).replace(/\.html$/i, "") || null;
}

function pageCoverage(spots, wantedIds) {
  const wanted = new Set(wantedIds);
  const byPage = new Map();
  for (const spot of spots || []) {
    if (!wanted.has(spot?.id)) continue;
    for (const record of spot.sourceRecords || []) {
      const pageKey = pageKeyFromSourceRecord(record);
      if (!pageKey) continue;
      if (!byPage.has(pageKey)) byPage.set(pageKey, new Set());
      byPage.get(pageKey).add(spot.id);
    }
  }
  return byPage;
}

export function computeCoverPages(spots, wantedIds, { maxPages = 20 } = {}) {
  const wanted = uniqSorted(wantedIds);
  const uncovered = new Set(wanted);
  const coverage = pageCoverage(spots, wanted);
  const selected = [];
  const limit = Math.max(0, Math.floor(Number(maxPages) || 0));

  while (uncovered.size && selected.length < limit) {
    let bestPage = null;
    let bestCount = 0;
    for (const page of [...coverage.keys()].sort()) {
      if (selected.includes(page)) continue;
      const count = [...coverage.get(page)].filter((id) => uncovered.has(id)).length;
      if (count > bestCount) {
        bestPage = page;
        bestCount = count;
      }
    }
    if (!bestPage || bestCount === 0) break;
    selected.push(bestPage);
    for (const id of coverage.get(bestPage)) uncovered.delete(id);
  }

  return selected;
}

export function coverageReport(spots, wantedIds, pages) {
  const wanted = uniqSorted(wantedIds);
  const selectedPages = new Set(pages || []);
  const coverage = pageCoverage(spots, wanted);
  const covered = new Set();
  for (const page of selectedPages) {
    for (const id of coverage.get(page) || []) covered.add(id);
  }
  return {
    covered: wanted.filter((id) => covered.has(id)),
    uncovered: wanted.filter((id) => !covered.has(id))
  };
}

function promotedIds(promotions) {
  const rows = Array.isArray(promotions) ? promotions : promotions?.promoted || [];
  return rows.map((row) => row?.surflineSpotId).filter(Boolean);
}

function enrichmentEntries(enrichment) {
  if (Array.isArray(enrichment)) return enrichment;
  return enrichment?.entries || [];
}

function stretchIds(stretches) {
  const rows = Array.isArray(stretches) ? stretches : stretches?.stretches || [];
  return rows.flatMap((stretch) => stretch?.surflineSpotIds || []);
}

export function buildWantedIds({ promotions, enrichment, defaultFavoriteIds, stretches }) {
  const ids = new Set(promotedIds(promotions));
  const enrichmentById = new Map(
    enrichmentEntries(enrichment).map((entry) => [entry?.id, entry])
  );

  for (const id of defaultFavoriteIds || []) {
    if (String(id).startsWith("surfline-")) {
      ids.add(id);
      continue;
    }
    const mapped = enrichmentById.get(id)?.surfMetadata?.sourceSpotId;
    if (mapped) ids.add(mapped);
  }

  for (const id of stretchIds(stretches)) ids.add(id);
  return [...ids].filter(Boolean).sort();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter((arg) => arg !== "--dry-run");
  const { values, errors } = parseCliArgs(args, {
    knownFlags: ["--transport", "--port", "--cache-dir", "--max-pages"]
  });
  if (argv.some((arg) => arg.startsWith("--dry-run="))) {
    errors.push("Unknown argument: --dry-run");
  }
  return { values, errors, dryRun };
}

function parsePositiveInt(value, flag, defaultValue, { allowZero = false } = {}) {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid ${flag}`);
  }
  return parsed;
}

function logPlan({ transport, dryRun, wanted, pages, report, maxPages }) {
  console.log(`refresh-surfline: wanted ids: ${wanted.length}`);
  console.log(`refresh-surfline: transport: ${transport}${dryRun ? " (dry-run)" : ""}`);
  console.log(`refresh-surfline: cover plan: ${pages.length} pages (max ${maxPages}), covered ${report.covered.length}/${wanted.length}, uncovered ${report.uncovered.length}`);
  console.log(`refresh-surfline: pages: ${pages.length ? pages.join(", ") : "none"}`);
  console.log(`refresh-surfline: uncovered: ${report.uncovered.length ? report.uncovered.join(", ") : "none"}`);
}

function runChild(command, args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (!inherit) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const details = stderr || stdout || `${command} exited ${code}`;
        reject(new Error(details.trim()));
      }
    });
  });
}

async function fetchViaCdp({ port, pages }) {
  if (!pages.length) {
    console.log("refresh-surfline: no pages selected for cdp fetch");
    return;
  }
  await runChild(process.execPath, [
    path.join("scripts", "cache-surfline-browser-cdp.js"),
    `--port=${port}`,
    "--batch-size=4",
    "--delay-ms=300",
    `--only=${pages.join(",")}`
  ], { inherit: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHttpPage(spot) {
  const response = await fetch(spot.url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`${spot.id}: HTTP ${response.status}`);
  }
  if (!parseNextDataState(html)) {
    throw new Error(`${spot.id}: missing parseable __NEXT_DATA__`);
  }
  return {
    html,
    status: response.status,
    responseUrl: response.url,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchViaPages({ pages, spots, cacheDir }) {
  const byId = new Map((spots || []).map((spot) => [spot.id, spot]));
  await fs.mkdir(cacheDir, { recursive: true });

  for (let index = 0; index < pages.length; index += 1) {
    const id = pages[index];
    const spot = byId.get(id);
    if (!spot) throw new Error(`No Surfline URL found for page ${id}`);

    let fetched = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !fetched; attempt += 1) {
      try {
        fetched = await fetchHttpPage(spot);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await delay(300 + Math.floor(Math.random() * 250));
      }
    }
    if (!fetched) throw lastError;

    await fs.writeFile(path.join(cacheDir, `${id}.html`), fetched.html, "utf8");
    await fs.writeFile(path.join(cacheDir, `${id}.json`), `${JSON.stringify({
      id,
      url: spot.url,
      responseUrl: fetched.responseUrl,
      status: fetched.status,
      fetchedAt: fetched.fetchedAt,
      cacheStatus: "http-fetched",
      source: "refresh-orchestrator"
    }, null, 2)}\n`, "utf8");
    console.log(`refresh-surfline: fetched ${id}`);

    if (index < pages.length - 1) await delay(300 + Math.floor(Math.random() * 250));
  }
}

async function runExtraction({ cacheDir, outFile }) {
  await runChild(process.execPath, [
    path.join("scripts", "extract-surfline-conditions.js"),
    `--cache-dir=${cacheDir}`,
    `--out=${outFile}`
  ]);
  return readJson(outFile);
}

async function makeTempOut({ dryRun }) {
  if (dryRun) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surfline-refresh-"));
    return { outFile: path.join(dir, "surfline-conditions.json"), cleanupDir: dir };
  }
  return {
    outFile: path.join(path.dirname(CONDITIONS_OUT_FILE), `.surfline-conditions.${process.pid}.${Date.now()}.tmp`),
    cleanupDir: null
  };
}

function countFreshWanted({ payload, wanted, runStartIso }) {
  const conditions = payload?.conditions || {};
  return wanted.filter((id) => String(conditions[id]?.fetchedAt || "") >= runStartIso).length;
}

async function main() {
  const { values, errors, dryRun } = parseArgs(process.argv.slice(2));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const transport = values["--transport"] || "cdp";
  if (!["cdp", "pages", "kbyg"].includes(transport)) throw new Error("Invalid --transport");
  const port = parsePositiveInt(values["--port"], "--port", 9333);
  const maxPages = parsePositiveInt(values["--max-pages"], "--max-pages", 20, { allowZero: true });
  const cacheDir = values["--cache-dir"] ? path.resolve(values["--cache-dir"]) : DEFAULT_CACHE_DIR;

  const [promotions, enrichment, stretches, surflineDb] = await Promise.all([
    readJson(path.join(ROOT, "data", "surfline-promotions.json")),
    readJson(path.join(ROOT, "data", "spot-metadata-enrichment.json")),
    readJson(path.join(ROOT, "data", "stretches.json")),
    readJson(path.join(ROOT, "data", "surfline-spots.json"))
  ]);
  const wanted = buildWantedIds({ promotions, enrichment, defaultFavoriteIds: DEFAULT_FAVORITE_IDS, stretches });
  const pages = computeCoverPages(surflineDb.spots, wanted, { maxPages });
  const report = coverageReport(surflineDb.spots, wanted, pages);
  logPlan({ transport, dryRun, wanted, pages, report, maxPages });

  const runStartIso = new Date().toISOString();
  if (!dryRun) {
    if (transport === "cdp") {
      await fetchViaCdp({ port, pages });
    } else if (transport === "pages") {
      await fetchViaPages({ pages, spots: surflineDb.spots, cacheDir });
    } else {
      console.error("kbyg transport pending runner probe");
      process.exitCode = 1;
      return;
    }
  }

  const { outFile, cleanupDir } = await makeTempOut({ dryRun });
  try {
    const payload = await runExtraction({ cacheDir, outFile });
    const pagesParsed = payload?.source?.pagesParsed ?? 0;
    const total = payload?.total ?? Object.keys(payload?.conditions || {}).length;
    const wantedPresent = wanted.filter((id) => payload?.conditions?.[id]).length;
    console.log(`refresh-surfline: extraction: ${total} spots from ${pagesParsed} pages`);
    if (dryRun) {
      console.log(`refresh-surfline: wanted present: ${wantedPresent}/${wanted.length} (dry-run; freshness not enforced)`);
      return;
    }

    const freshWanted = countFreshWanted({ payload, wanted, runStartIso });
    console.log(`refresh-surfline: fresh wanted: ${freshWanted}/${wanted.length}`);
    if (!passesValidityFloor(freshWanted, wanted.length, freshWanted, REFRESH_VALID_RATIO)) {
      await fs.rm(outFile, { force: true });
      console.error(`refresh-surfline: fresh wanted coverage below ${Math.round(REFRESH_VALID_RATIO * 100)}%; refusing to update ${path.relative(ROOT, CONDITIONS_OUT_FILE)}`);
      process.exitCode = 1;
      return;
    }

    await fs.rename(outFile, CONDITIONS_OUT_FILE);
    console.log(`refresh-surfline: wrote ${path.relative(ROOT, CONDITIONS_OUT_FILE)}`);
  } finally {
    if (cleanupDir) await fs.rm(cleanupDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
