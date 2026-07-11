#!/usr/bin/env node

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { canonicalJson, digestDocument, validateSpotAdvice } from "./lib/spot-advice-build.js";
import { isMaterialClaimChange } from "./lib/spot-advice-review.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_PATH = path.join(ROOT, "data", "spot-advice.json");
const clone = (value) => structuredClone(value);

function validateFeedbackEnvelope(feedback) {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) throw new Error("feedback must be an object");
  const keys = Object.keys(feedback);
  if (keys.length !== 3 || !["schemaVersion", "baseDigest", "document"].every((key) => keys.includes(key))) {
    throw new Error("feedback shape must contain exactly schemaVersion, baseDigest, and document");
  }
  if (feedback.schemaVersion !== 1) throw new Error("feedback schemaVersion must be 1");
  if (!/^[a-f0-9]{64}$/.test(feedback.baseDigest ?? "")) throw new Error("feedback baseDigest must be SHA-256");
  if (!feedback.document || typeof feedback.document !== "object" || feedback.document.schemaVersion !== 1) throw new Error("feedback document schemaVersion must be 1");
}

export function prepareFeedbackCandidate(canonical, feedback) {
  validateFeedbackEnvelope(feedback);
  const currentDigest = digestDocument(canonical);
  if (feedback.baseDigest !== currentDigest) throw new Error(`stale feedback digest: expected ${currentDigest}, received ${feedback.baseDigest}`);
  const candidate = clone(feedback.document);
  const canonicalById = new Map(canonical.advice.map((claim) => [claim.id, claim]));
  for (const claim of candidate.advice ?? []) {
    const before = canonicalById.get(claim.id);
    if (!before) {
      claim.publicationStatus = "draft";
      claim.reviewedAt = null;
      claim.calculationCandidate = false;
      continue;
    }
    if (!isMaterialClaimChange(before, claim)) continue;
    claim.calculationCandidate = false;
    claim.publicationStatus = "draft";
    claim.reviewedAt = null;
  }
  return candidate;
}

export function applyFeedback({
  canonicalPath = CANONICAL_PATH,
  feedback,
  context,
  fileSystem = fs,
  beforeRename = () => {},
  temporaryPathFactory = (target) => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
}) {
  const initialText = fileSystem.readFileSync(canonicalPath, "utf8");
  const canonical = JSON.parse(initialText);
  const initialDigest = digestDocument(canonical);
  const candidate = prepareFeedbackCandidate(canonical, feedback);
  validateSpotAdvice(candidate, context);
  const expected = canonicalJson(candidate);
  const temporaryPath = temporaryPathFactory(canonicalPath);
  let descriptor = null;
  let createdTemporary = false;
  try {
    descriptor = fileSystem.openSync(temporaryPath, "wx");
    createdTemporary = true;
    fileSystem.writeFileSync(descriptor, expected, "utf8");
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    beforeRename({ canonicalPath, temporaryPath, initialDigest });
    const current = JSON.parse(fileSystem.readFileSync(canonicalPath, "utf8"));
    const currentDigest = digestDocument(current);
    if (currentDigest !== initialDigest) throw new Error(`canonical document changed concurrently before rename: expected digest ${initialDigest}, received ${currentDigest}`);
    fileSystem.renameSync(temporaryPath, canonicalPath);
    createdTemporary = false;
    return { baseDigest: initialDigest, digest: digestDocument(candidate), document: candidate };
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

function readJson(filePath, fileSystem = fs) {
  return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
}

function loadContext(root = ROOT, fileSystem = fs) {
  const dataPath = (name) => path.join(root, "data", name);
  return {
    promotions: readJson(dataPath("surfline-promotions.json"), fileSystem),
    surflineSpots: readJson(dataPath("surfline-spots.json"), fileSystem),
    stretches: readJson(dataPath("stretches.json"), fileSystem),
    promotedDb: readJson(dataPath("promoted-spots.json"), fileSystem),
    enrichmentDb: readJson(dataPath("spot-metadata-enrichment.json"), fileSystem),
    defaultFavoriteIds: DEFAULT_FAVORITE_IDS
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("usage: node scripts/apply-spot-advice-feedback.js <feedback.json>");
    process.exitCode = 1;
    return;
  }
  const feedback = readJson(path.resolve(args[0]));
  const result = applyFeedback({ feedback, context: loadContext() });
  console.log(`Applied spot advice feedback at base digest ${result.baseDigest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
