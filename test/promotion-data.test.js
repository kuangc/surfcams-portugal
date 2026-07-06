import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const promotions = JSON.parse(fs.readFileSync("data/surfline-promotions.json", "utf8"));
const stretches = JSON.parse(fs.readFileSync("data/stretches.json", "utf8"));
const surflineDb = JSON.parse(fs.readFileSync("data/surfline-spots.json", "utf8"));
const meoDb = JSON.parse(fs.readFileSync("data/meo-spots.json", "utf8"));
const slIds = new Set(surflineDb.spots.map((s) => s.id));
const meoIds = new Set(meoDb.spots.map((s) => s.id));

test("promotion manifest: 44 unique wanted ids, all in surfline catalog", () => {
  assert.equal(promotions.promoted.length, 44);
  const ids = promotions.promoted.map((p) => p.surflineSpotId);
  assert.equal(new Set(ids).size, 44);
  for (const id of ids) assert.ok(slIds.has(id), `unknown surfline id ${id}`);
  assert.equal(promotions.promoteOnlyWithTrustedCam, true);
});

test("stretches reference real spot and cam ids, ordered north to south", () => {
  assert.equal(stretches.stretches.length, 2);
  for (const st of stretches.stretches) {
    for (const id of st.surflineSpotIds) assert.ok(slIds.has(id), `unknown ${id} in ${st.id}`);
    for (const id of st.meoCamIds) assert.ok(meoIds.has(id), `unknown cam ${id} in ${st.id}`);
    const lats = st.surflineSpotIds.map((id) => surflineDb.spots.find((s) => s.id === id).lat);
    const sorted = [...lats].sort((a, b) => b - a);
    assert.deepEqual(lats, sorted, `${st.id} spots not N->S ordered`);
  }
});
