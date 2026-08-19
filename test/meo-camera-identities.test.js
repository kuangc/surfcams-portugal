import assert from "node:assert/strict";
import test from "node:test";

import {
  MEO_CAMERA_ID_RENAMES,
  MEO_FAVORITE_ID_REPLACEMENTS,
  RETIRED_MEO_CAMERA_IDS
} from "../src/meo-camera-identities.js";

test("MEO camera identity migrations are explicit and one-directional", () => {
  assert.equal(MEO_CAMERA_ID_RENAMES["espinho-silvade"], "espinho-silvalde");
  assert.equal(MEO_CAMERA_ID_RENAMES.espinhosilvadeestatica, "espinhosilvaldeestatica");
  assert.deepEqual(RETIRED_MEO_CAMERA_IDS, ["surfline-castelo"]);
  assert.equal(MEO_FAVORITE_ID_REPLACEMENTS["surfline-castelo"], "costa-da-caparica-riviera");
  assert.equal(Object.hasOwn(MEO_CAMERA_ID_RENAMES, "surfline-castelo"), false);
});
