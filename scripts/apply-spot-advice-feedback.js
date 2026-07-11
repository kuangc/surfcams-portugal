#!/usr/bin/env node

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { canonicalJson, digestDocument, validateSpotAdvice } from "./lib/spot-advice-build.js";
import { isExplicitClaimSignoff, isMaterialClaimChange } from "./lib/spot-advice-review.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_PATH = path.join(ROOT, "data", "spot-advice.json");
const clone = (value) => structuredClone(value);
const locallyReclaimableOwners = new Map();

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
    if (before && !isMaterialClaimChange(before, claim)) continue;
    claim.calculationCandidate = false;
    if (isExplicitClaimSignoff(before, claim)) continue;
    claim.publicationStatus = "draft";
    claim.reviewedAt = null;
  }
  return candidate;
}

function defaultProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function parseLockMetadata(fileSystem, lockPath) {
  try {
    const metadata = JSON.parse(fileSystem.readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(metadata?.pid) || typeof metadata.token !== "string" || typeof metadata.createdAt !== "string") return null;
    return metadata;
  } catch {
    return null;
  }
}

function lockOwnerPaths(fileSystem, lockPrefix) {
  const directory = path.dirname(lockPrefix);
  const basename = path.basename(lockPrefix);
  return fileSystem.readdirSync(directory)
    .filter((name) => name === basename || name.startsWith(`${basename}.owner.`))
    .map((name) => path.join(directory, name));
}

function ownerPidFromPath(ownerPath) {
  const match = /\.owner\.(\d+)\./.exec(ownerPath);
  return match ? Number(match[1]) : null;
}

function ownerIsActive(fileSystem, ownerPath, processIsAlive) {
  const metadata = parseLockMetadata(fileSystem, ownerPath);
  const localToken = locallyReclaimableOwners.get(ownerPath);
  if (localToken !== undefined) {
    if (metadata?.token === localToken) return false;
    if (metadata) locallyReclaimableOwners.delete(ownerPath);
  }
  if (metadata) return metadata.state === "active" && processIsAlive(metadata.pid);
  const pid = ownerPidFromPath(ownerPath);
  return pid === null || processIsAlive(pid);
}

function ensureOwnerReclaimable(fileSystem, metadata) {
  if (!fileSystem.existsSync(metadata.path)) return true;
  const current = parseLockMetadata(fileSystem, metadata.path);
  if (!current || current.token !== metadata.token) return false;
  try {
    fileSystem.writeFileSync(metadata.path, `${JSON.stringify({ ...metadata, path: undefined, state: "releasable" })}\n`, "utf8");
    return true;
  } catch {
    locallyReclaimableOwners.set(metadata.path, metadata.token);
    return true;
  }
}

function acquireOwnedLock({ fileSystem, lockPath, lockTokenFactory, now, processIsAlive }) {
  const token = lockTokenFactory();
  const ownerPath = `${lockPath}.owner.${process.pid}.${token}`;
  const metadata = { pid: process.pid, token, createdAt: now().toISOString(), state: "active" };
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(ownerPath, "wx");
    fileSystem.writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`, "utf8");
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) { try { fileSystem.closeSync(descriptor); } catch {} }
    if (fileSystem.existsSync(ownerPath)) {
      try { fileSystem.unlinkSync(ownerPath); } catch (cleanupError) { throw new Error(`spot advice feedback lock setup failed and cleanup failed: ${cleanupError.message}`, { cause: error }); }
    }
    throw error;
  }
  const owned = { ...metadata, path: ownerPath };
  try {
    const owners = lockOwnerPaths(fileSystem, lockPath);
    const activeOther = owners.find((candidate) => candidate !== ownerPath && ownerIsActive(fileSystem, candidate, processIsAlive));
    if (activeOther) throw new Error(`spot advice feedback lock is busy: ${activeOther}`);
    for (const candidate of owners) {
      if (candidate !== ownerPath && !ownerIsActive(fileSystem, candidate, processIsAlive)) {
        fileSystem.unlinkSync(candidate);
        locallyReclaimableOwners.delete(candidate);
      }
    }
    return owned;
  } catch (error) {
    try {
      releaseOwnedLock({ fileSystem, metadata: owned, committed: false });
    } catch (cleanupError) {
      const wrapped = new Error(`spot advice feedback lock acquisition failed and owner cleanup failed: ${cleanupError.message}`, { cause: error });
      wrapped.reclaimable = ensureOwnerReclaimable(fileSystem, owned);
      throw wrapped;
    }
    throw error;
  }
}

function releaseOwnedLock({ fileSystem, metadata, committed }) {
  if (!metadata?.path || !fileSystem.existsSync(metadata.path)) return;
  const current = parseLockMetadata(fileSystem, metadata.path);
  if (!current || current.token !== metadata.token) throw new Error("spot advice feedback lock ownership changed before cleanup");
  try {
    fileSystem.unlinkSync(metadata.path);
    locallyReclaimableOwners.delete(metadata.path);
  } catch (cleanupError) {
    const stillOwned = parseLockMetadata(fileSystem, metadata.path);
    if (!stillOwned || stillOwned.token !== metadata.token) throw new Error("spot advice feedback lock ownership changed after cleanup failure");
    fileSystem.writeFileSync(metadata.path, `${JSON.stringify({ ...current, state: committed ? "committed" : "releasable" })}\n`, "utf8");
    throw cleanupError;
  }
}

export function applyFeedback({
  canonicalPath = CANONICAL_PATH,
  feedback,
  context,
  fileSystem = fs,
  beforeRename = () => {},
  afterLock = () => {},
  temporaryPathFactory = (target) => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`),
  lockPathFactory = (target) => path.join(path.dirname(target), `.${path.basename(target)}.lock`),
  lockTokenFactory = () => randomUUID(),
  now = () => new Date(),
  processIsAlive = defaultProcessIsAlive
}) {
  const lockPath = lockPathFactory(canonicalPath);
  let lockMetadata = null;
  let committed = false;
  let result;
  let operationError;
  try {
    lockMetadata = acquireOwnedLock({ fileSystem, lockPath, lockTokenFactory, now, processIsAlive });
    afterLock({ lockPath: lockMetadata.path, metadata: clone(lockMetadata) });
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
      beforeRename({ canonicalPath, temporaryPath, initialDigest, lockPath: lockMetadata.path });
      const current = JSON.parse(fileSystem.readFileSync(canonicalPath, "utf8"));
      const currentDigest = digestDocument(current);
      if (currentDigest !== initialDigest) throw new Error(`canonical document changed concurrently before rename: expected digest ${initialDigest}, received ${currentDigest}`);
      fileSystem.renameSync(temporaryPath, canonicalPath);
      createdTemporary = false;
      committed = true;
      result = { baseDigest: initialDigest, digest: digestDocument(candidate), document: candidate };
    } catch (error) {
      if (descriptor !== null) {
        try { fileSystem.closeSync(descriptor); } catch {}
      }
      if (createdTemporary && fileSystem.existsSync(temporaryPath)) {
        try { fileSystem.unlinkSync(temporaryPath); } catch (cleanupError) { throw new Error(`temporary file cleanup failed: ${cleanupError.message}`, { cause: error }); }
      }
      throw error;
    }
  } catch (error) {
    operationError = error;
  }
  try {
    releaseOwnedLock({ fileSystem, metadata: lockMetadata, committed });
  } catch (cleanupError) {
    const error = new Error(`spot advice feedback ${committed ? "committed but " : ""}lock cleanup failed: ${cleanupError.message}`, { cause: operationError ?? cleanupError });
    error.committed = committed;
    throw error;
  }
  if (operationError) throw operationError;
  return result;
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
