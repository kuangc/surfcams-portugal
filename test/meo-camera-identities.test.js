import assert from "node:assert/strict";
import test from "node:test";

import {
  MEO_CAMERA_ID_RENAMES,
  canonicalMeoCameraId
} from "../src/meo-camera-identities.js";

test("MEO camera identity renames contain only the Espinho spelling corrections", () => {
  assert.deepEqual(MEO_CAMERA_ID_RENAMES, {
    "espinho-silvade": "espinho-silvalde",
    espinhosilvadeestatica: "espinhosilvaldeestatica"
  });
  assert.equal(Object.isFrozen(MEO_CAMERA_ID_RENAMES), true);
});

test("MEO identity canonicalization changes only known legacy IDs", () => {
  assert.equal(canonicalMeoCameraId("espinho-silvade"), "espinho-silvalde");
  assert.equal(canonicalMeoCameraId("espinhosilvadeestatica"), "espinhosilvaldeestatica");
  assert.equal(canonicalMeoCameraId("espinho-silvalde"), "espinho-silvalde");
  assert.equal(canonicalMeoCameraId("surfline-castelo"), "surfline-castelo");
  assert.equal(canonicalMeoCameraId(null), null);
});
