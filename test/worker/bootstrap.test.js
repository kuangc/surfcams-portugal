import assert from "node:assert/strict";
import test from "node:test";

import bootstrap from "../../worker/bootstrap.js";

test("bootstrap returns the same harmless bounded 503 for every path", async (t) => {
  for (const path of [
    "/",
    "/index.html",
    "/api",
    "/api/playback/private-camera?token=request-secret",
    "/data/beachcam-cameras.json"
  ]) {
    await t.test(path, async () => {
      const response = await bootstrap.fetch(
        new Request(`https://surfcams.example${path}`),
        { PRIVATE_BINDING: "must-not-appear" }
      );
      const text = await response.text();

      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
      assert.equal(text, '{"error":"Service unavailable"}');
      assert.ok(new TextEncoder().encode(text).byteLength <= 64);
      assert.doesNotMatch(
        text,
        /surfcam|camera|playback|token|api|data|asset|access|google|meo|surfline|private/i
      );
    });
  }
});
