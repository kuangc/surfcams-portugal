import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createWorker } from "../../worker/router.js";

function privateApiHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("every /api route authenticates before playback routing", async (t) => {
  for (const path of ["/api", "/api/playback/known", "/api/unknown"] ) {
    await t.test(path, async () => {
      const events = [];
      const playbackResponse = Response.json({ error: "routed fixture" }, {
        status: 418,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
      const worker = createWorker({
        async authenticate(request, env) {
          events.push(["authenticate", request, env]);
        },
        async playbackApi(request, env) {
          events.push(["playback", request, env]);
          return playbackResponse;
        }
      });
      const request = new Request(`https://surfcams.example${path}`);
      const env = { ASSETS: { fetch: assert.fail } };

      const response = await worker.fetch(request, env);

      assert.equal(response, playbackResponse);
      assert.deepEqual(events, [
        ["authenticate", request, env],
        ["playback", request, env]
      ]);
    });
  }
});

test("authentication failure is generic private 403 and never reaches playback", async () => {
  const sensitive = "private JWT verification and identity detail";
  let playbackCalls = 0;
  const worker = createWorker({
    async authenticate() {
      throw new Error(sensitive);
    },
    async playbackApi() {
      playbackCalls += 1;
      return new Response("must not run");
    }
  });

  const response = await worker.fetch(
    new Request("https://surfcams.example/api/unknown?secret=request-query"),
    { ASSETS: { fetch: assert.fail } }
  );
  const text = await response.text();

  assert.equal(response.status, 403);
  privateApiHeaders(response);
  assert.deepEqual(JSON.parse(text), { error: "Access denied" });
  assert.equal(playbackCalls, 0);
  assert.equal(text.includes(sensitive), false);
  assert.equal(text.includes("request-query"), false);
});

test("non-API requests delegate the original Request exactly once", async () => {
  const calls = [];
  const assetResponse = new Response("asset fixture", {
    status: 200,
    headers: { "x-asset": "yes" }
  });
  const worker = createWorker({
    authenticate: assert.fail,
    playbackApi: assert.fail
  });
  const request = new Request("https://surfcams.example/favorites?view=hero", {
    headers: { "x-original": "preserved" }
  });
  const env = {
    ASSETS: {
      async fetch(input) {
        calls.push(input);
        return assetResponse;
      }
    }
  };

  const response = await worker.fetch(request, env);

  assert.equal(response, assetResponse);
  assert.deepEqual(calls, [request]);
});

test("asset 404 responses remain unchanged instead of becoming the app shell", async () => {
  const asset404 = new Response("asset not found fixture", {
    status: 404,
    headers: { "x-static-assets": "miss" }
  });
  const worker = createWorker({
    authenticate: assert.fail,
    playbackApi: assert.fail
  });

  const response = await worker.fetch(
    new Request("https://surfcams.example/typo.js"),
    { ASSETS: { async fetch() { return asset404; } } }
  );

  assert.equal(response, asset404);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "asset not found fixture");
  assert.equal(response.headers.get("x-static-assets"), "miss");
});

test("router remains a pure Node module without Workerd-only imports", async () => {
  const source = await readFile(
    new URL("../../worker/router.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /cloudflare:workers/);
  assert.match(source, /export function createWorker/);
});
