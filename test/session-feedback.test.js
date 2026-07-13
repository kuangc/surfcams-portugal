import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_FEEDBACK_STORAGE_KEY,
  addSessionFeedback,
  exportSessionFeedback,
  importSessionFeedback,
  loadSessionFeedback
} from "../src/session-feedback.js";

function fakeStorage(initial = []) {
  const values = new Map(initial);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    value(key) {
      return values.get(key);
    }
  };
}

function record(values = {}) {
  return {
    id: "feedback-1",
    spotId: "sao-juliao",
    startedAt: "2026-07-13T10:00:00.000Z",
    predictedQuality: "good",
    predictedConfidence: "medium",
    predictedFaceMinM: 0.6,
    predictedFaceMaxM: 1.1,
    actualFace: "knee-waist",
    actualQuality: "good",
    tideStage: "mid",
    note: "Clean for an hour.",
    ...values
  };
}

test("session feedback adds validated immutable records under a versioned key", () => {
  const storage = fakeStorage();
  const saved = addSessionFeedback(record({ id: undefined }), {
    storage,
    idFactory: () => "generated-id"
  });

  assert.equal(saved.id, "generated-id");
  assert.equal(Object.isFrozen(saved), true);
  assert.deepEqual(loadSessionFeedback(storage), [{ ...record(), id: "generated-id" }]);
  assert.equal(JSON.parse(storage.value(SESSION_FEEDBACK_STORAGE_KEY)).schemaVersion, 1);
});

test("session feedback validates enums and truncates notes to 500 characters", () => {
  const storage = fakeStorage();
  assert.throws(() => addSessionFeedback(record({ actualFace: "double-overhead" }), { storage }), /actualFace/);
  assert.throws(() => addSessionFeedback(record({ actualQuality: "epic" }), { storage }), /actualQuality/);
  assert.throws(() => addSessionFeedback(record({ predictedConfidence: "certain" }), { storage }), /predictedConfidence/);
  assert.throws(() => addSessionFeedback(record({ spotId: "" }), { storage }), /spotId/);

  const saved = addSessionFeedback(record({ id: "long-note", note: "x".repeat(550) }), { storage });
  assert.equal(saved.note.length, 500);
});

test("corrupt or wrong-version stored payloads recover as an empty list", () => {
  assert.deepEqual(loadSessionFeedback(fakeStorage([[SESSION_FEEDBACK_STORAGE_KEY, "{broken"]])), []);
  assert.deepEqual(loadSessionFeedback(fakeStorage([[SESSION_FEEDBACK_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, records: [record()] })]])), []);
  assert.deepEqual(loadSessionFeedback(fakeStorage([[SESSION_FEEDBACK_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, records: [{ nope: true }] })]])), []);
});

test("export is stable JSON and import merges valid records by id", () => {
  const storage = fakeStorage();
  addSessionFeedback(record(), { storage });
  const exported = exportSessionFeedback(storage);
  assert.deepEqual(JSON.parse(exported), { schemaVersion: 1, records: [record()] });
  assert.equal(exported.endsWith("\n"), true);

  const imported = importSessionFeedback(JSON.stringify({
    schemaVersion: 1,
    records: [
      record({ note: "Updated." }),
      record({ id: "feedback-2", startedAt: "2026-07-13T12:00:00.000Z", actualQuality: "okay" })
    ]
  }), { storage });

  assert.equal(imported.length, 2);
  assert.equal(imported.find((entry) => entry.id === "feedback-1").note, "Updated.");
  assert.equal(loadSessionFeedback(storage).length, 2);
});

test("invalid imports are rejected without changing existing records", () => {
  const storage = fakeStorage();
  addSessionFeedback(record(), { storage });
  const before = storage.value(SESSION_FEEDBACK_STORAGE_KEY);

  assert.throws(() => importSessionFeedback("not json", { storage }), /valid JSON/);
  assert.throws(() => importSessionFeedback(JSON.stringify({ schemaVersion: 1, records: [record({ actualQuality: "epic" })] }), { storage }), /actualQuality/);
  assert.equal(storage.value(SESSION_FEEDBACK_STORAGE_KEY), before);
});
