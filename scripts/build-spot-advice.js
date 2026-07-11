import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { canonicalJson, compileSpotAdvice } from "./lib/spot-advice-build.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (filePath, fileSystem = fs) => JSON.parse(fileSystem.readFileSync(filePath, "utf8"));

export function syncCompiledArtifact({
  outputPath,
  expected,
  check = false,
  fileSystem = fs,
  temporaryPathFactory = (target) => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
}) {
  const current = fileSystem.existsSync(outputPath) ? fileSystem.readFileSync(outputPath, "utf8") : null;
  if (current === expected) return { status: 0, changed: false };
  if (check) return { status: 1, changed: false };
  const temporaryPath = temporaryPathFactory(outputPath);
  let descriptor = null;
  let createdTemporary = false;
  try {
    descriptor = fileSystem.openSync(temporaryPath, "wx");
    createdTemporary = true;
    fileSystem.writeFileSync(descriptor, expected, "utf8");
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(temporaryPath, outputPath);
    createdTemporary = false;
    return { status: 0, changed: true };
  } catch (error) {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch {}
    }
    if (createdTemporary && fileSystem.existsSync(temporaryPath)) {
      try { fileSystem.unlinkSync(temporaryPath); } catch {}
    }
    throw error;
  }
}

export function buildSpotAdviceFiles({ root = ROOT, check = false, fileSystem = fs } = {}) {
  const dataPath = (name) => path.join(root, "data", name);
  const document = readJson(dataPath("spot-advice.json"), fileSystem);
  const context = {
    promotions: readJson(dataPath("surfline-promotions.json"), fileSystem),
    surflineSpots: readJson(dataPath("surfline-spots.json"), fileSystem),
    stretches: readJson(dataPath("stretches.json"), fileSystem),
    promotedDb: readJson(dataPath("promoted-spots.json"), fileSystem),
    enrichmentDb: readJson(dataPath("spot-metadata-enrichment.json"), fileSystem),
    defaultFavoriteIds: DEFAULT_FAVORITE_IDS
  };
  const expected = canonicalJson(compileSpotAdvice(document, context));
  const outputPath = dataPath("spot-advice-resolved.json");
  return { ...syncCompiledArtifact({ outputPath, expected, check, fileSystem }), outputPath };
}

function main() {
  const check = process.argv.includes("--check");
  const result = buildSpotAdviceFiles({ check });
  if (result.status !== 0) {
    console.error(`${path.relative(ROOT, result.outputPath)} is stale; run npm run build-spot-advice`);
    process.exitCode = result.status;
  } else if (result.changed) {
    console.log(`Wrote ${path.relative(ROOT, result.outputPath)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
