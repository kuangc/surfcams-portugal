import { canonicalMeoCameraId } from "./meo-camera-identities.js";

export const SESSION_FEEDBACK_STORAGE_KEY = "surfcamSessionFeedback:v1";
const SCHEMA_VERSION = 1;
const FACE_VALUES = new Set(["flat", "ankle", "knee-waist", "waist-chest", "head-plus"]);
const ACTUAL_QUALITY_VALUES = new Set(["poor", "okay", "good"]);
const PREDICTED_QUALITY_VALUES = new Set(["poor", "possible", "good"]);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);
const TIDE_VALUES = new Set(["low", "mid", "high", "unknown", null]);

function finiteOrNull(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`${field} must be a non-negative number or null`);
  return numeric;
}

function enumValue(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Invalid ${field}`);
  return value;
}

function normalizeRecord(input, { requireId = true } = {}) {
  const id = typeof input?.id === "string" ? input.id.trim() : "";
  const rawSpotId = typeof input?.spotId === "string" ? input.spotId.trim() : "";
  const spotId = canonicalMeoCameraId(rawSpotId);
  const startedMs = Date.parse(input?.startedAt || "");
  if (requireId && !id) throw new TypeError("id is required");
  if (!spotId) throw new TypeError("spotId is required");
  if (!Number.isFinite(startedMs)) throw new TypeError("startedAt must be a valid timestamp");

  const predictedFaceMinM = finiteOrNull(input.predictedFaceMinM, "predictedFaceMinM");
  const predictedFaceMaxM = finiteOrNull(input.predictedFaceMaxM, "predictedFaceMaxM");
  if (predictedFaceMinM !== null && predictedFaceMaxM !== null && predictedFaceMaxM < predictedFaceMinM) {
    throw new TypeError("predictedFaceMaxM must be at least predictedFaceMinM");
  }

  return Object.freeze({
    id,
    spotId,
    startedAt: new Date(startedMs).toISOString(),
    predictedQuality: enumValue(input.predictedQuality, PREDICTED_QUALITY_VALUES, "predictedQuality"),
    predictedConfidence: enumValue(input.predictedConfidence, CONFIDENCE_VALUES, "predictedConfidence"),
    predictedFaceMinM,
    predictedFaceMaxM,
    actualFace: enumValue(input.actualFace, FACE_VALUES, "actualFace"),
    actualQuality: enumValue(input.actualQuality, ACTUAL_QUALITY_VALUES, "actualQuality"),
    tideStage: enumValue(input.tideStage ?? null, TIDE_VALUES, "tideStage"),
    note: String(input.note || "").slice(0, 500)
  });
}

function sorted(records) {
  return [...records].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
}

function freezeList(records) {
  return Object.freeze(sorted(records).map((record) => Object.isFrozen(record) ? record : Object.freeze(record)));
}

function writeRecords(storage, records) {
  const normalized = freezeList(records);
  storage?.setItem(SESSION_FEEDBACK_STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, records: normalized }));
  return normalized;
}

export function loadSessionFeedback(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SESSION_FEEDBACK_STORAGE_KEY);
    if (!raw) return freezeList([]);
    const payload = JSON.parse(raw);
    if (payload?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.records)) return freezeList([]);
    const migrated = payload.records.some((record) => {
      const spotId = typeof record?.spotId === "string" ? record.spotId.trim() : "";
      return canonicalMeoCameraId(spotId) !== spotId;
    });
    const records = freezeList(payload.records.map((record) => normalizeRecord(record)));
    if (migrated) {
      try {
        writeRecords(storage, records);
      } catch {
        // Canonical records remain usable in memory when migration persistence fails.
      }
    }
    return records;
  } catch {
    return freezeList([]);
  }
}

function defaultId() {
  return globalThis.crypto?.randomUUID?.() || `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function addSessionFeedback(input, {
  storage = globalThis.localStorage,
  idFactory = defaultId
} = {}) {
  const id = typeof input?.id === "string" && input.id.trim() ? input.id.trim() : idFactory();
  const record = normalizeRecord({ ...input, id });
  const existing = loadSessionFeedback(storage);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  byId.set(record.id, record);
  writeRecords(storage, byId.values());
  return record;
}

export function exportSessionFeedback(storage = globalThis.localStorage) {
  const records = loadSessionFeedback(storage);
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, records }, null, 2)}\n`;
}

export function importSessionFeedback(text, { storage = globalThis.localStorage } = {}) {
  let payload;
  try {
    payload = JSON.parse(String(text));
  } catch {
    throw new TypeError("Session feedback import must be valid JSON");
  }
  if (payload?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.records)) {
    throw new TypeError("Unsupported session feedback schema");
  }

  const incoming = payload.records.map((record) => normalizeRecord(record));
  const byId = new Map(loadSessionFeedback(storage).map((record) => [record.id, record]));
  incoming.forEach((record) => byId.set(record.id, record));
  return writeRecords(storage, byId.values());
}
