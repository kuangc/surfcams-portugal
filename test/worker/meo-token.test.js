import assert from "node:assert/strict";
import test from "node:test";

import {
  MEO_BROKER_TTL_MS,
  MEO_TOKEN_ENDPOINTS,
  MeoTokenUnavailableError,
  fetchMeoToken,
  signMeoPlaylistUrl,
  validateMeoToken
} from "../../worker/meo-token.js";

const encoder = new TextEncoder();

function plainTextResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function trackedNonByobResponse(chunks, init = {}) {
  const state = { bytesRead: 0, pulls: 0, canceled: false };
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = typeof chunks[index] === "string" ? encoder.encode(chunks[index]) : chunks[index];
      index += 1;
      state.bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      state.canceled = true;
    }
  }, { highWaterMark: 0 });
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
  return { response: new Response(body, { ...init, headers }), state };
}

function trackedLargeByteResponse(totalBytes) {
  const state = { bytesRead: 0, pulls: 0, canceled: false };
  const body = new ReadableStream({
    type: "bytes",
    pull(controller) {
      state.pulls += 1;
      const remaining = totalBytes - state.bytesRead;
      if (remaining === 0) {
        controller.close();
        return;
      }
      const requested = controller.byobRequest?.view;
      if (requested) {
        const byteLength = Math.min(requested.byteLength, remaining);
        requested.subarray(0, byteLength).fill(97);
        state.bytesRead += byteLength;
        controller.byobRequest.respond(byteLength);
        return;
      }
      const chunk = new Uint8Array(remaining).fill(97);
      state.bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      state.canceled = true;
    }
  });
  return {
    response: new Response(body, { headers: { "content-type": "text/plain" } }),
    state
  };
}

function assertSanitizedError(error) {
  assert.equal(error instanceof MeoTokenUnavailableError, true);
  assert.equal(error.name, "MeoTokenUnavailableError");
  assert.equal(error.message, "MEO token unavailable");
  assert.equal(error.cause, undefined);
  return true;
}

test("exports the fixed MEO broker policy constants", () => {
  assert.equal(MEO_BROKER_TTL_MS, 72_000_000);
  assert.deepEqual(MEO_TOKEN_ENDPOINTS, [
    "https://beachcam.meo.pt/api/video-token",
    "https://beachcam.meo.pt/api/livecam/access"
  ]);
  assert.equal(Object.isFrozen(MEO_TOKEN_ENDPOINTS), true);
});

test("validateMeoToken trims and accepts only bounded, control-free UTF-8 text", () => {
  assert.equal(validateMeoToken("  token+/=_-.~  "), "token+/=_-.~");
  assert.equal(validateMeoToken("a".repeat(4096)), "a".repeat(4096));
  assert.equal(validateMeoToken("é".repeat(2048)), "é".repeat(2048));

  for (const invalid of [
    "",
    "   ",
    "a".repeat(4097),
    "é".repeat(2049),
    "token\u0000value",
    "token\nvalue",
    "token\u007fvalue",
    "token\u0085value",
    123,
    null
  ]) {
    assert.throws(() => validateMeoToken(invalid), assertSanitizedError);
  }
});

test("fetchMeoToken returns a valid primary token without calling fallback", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return plainTextResponse("  primary-token  ");
  };

  assert.equal(await fetchMeoToken({ fetcher }), "primary-token");
  assert.deepEqual(calls.map(({ url }) => url), [MEO_TOKEN_ENDPOINTS[0]]);
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
});

test("fetchMeoToken uses the default timeout when timeoutMs is null", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return plainTextResponse("primary-token");
  };

  assert.equal(await fetchMeoToken({ fetcher, timeoutMs: null }), "primary-token");
  assert.equal(calls, 1);
});

test("fetchMeoToken falls back exactly once for primary endpoint failures", async (t) => {
  const failureCases = [
    ["network error", async () => { throw new Error("private network detail"); }],
    ["non-2xx response", async () => plainTextResponse("private body", { status: 503 })],
    ["wrong content type", async () => new Response("private body", {
      headers: { "content-type": "application/json" }
    })],
    ["blank body", async () => plainTextResponse("   ")],
    ["control character", async () => plainTextResponse("token\u0000secret")],
    ["body over 4096 bytes", async () => plainTextResponse("a".repeat(4097))]
  ];

  for (const [name, failPrimary] of failureCases) {
    await t.test(name, async () => {
      const calls = [];
      const fetcher = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return failPrimary(options.signal);
        return plainTextResponse("fallback-token");
      };

      assert.equal(await fetchMeoToken({ fetcher }), "fallback-token");
      assert.deepEqual(calls.map(({ url }) => url), MEO_TOKEN_ENDPOINTS);
    });
  }
});

test("fetchMeoToken treats endpoint timeout abort as a fallback condition", async () => {
  const calls = [];
  let watchdogId;
  const fetcher = (url, { signal }) => {
    calls.push(url);
    if (calls.length === 2) return Promise.resolve(plainTextResponse("fallback-token"));
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const watchdog = new Promise((_, reject) => {
    watchdogId = setTimeout(
      () => reject(new Error("AbortSignal.timeout did not settle the token fetch")),
      250
    );
  });

  try {
    assert.equal(
      await Promise.race([fetchMeoToken({ fetcher, timeoutMs: 5 }), watchdog]),
      "fallback-token"
    );
    assert.deepEqual(calls, MEO_TOKEN_ENDPOINTS);
  } finally {
    clearTimeout(watchdogId);
  }
});

test("declared oversized bodies are canceled without being read", async () => {
  const tracked = trackedNonByobResponse(["must-not-be-read"], {
    headers: { "content-length": "4097" }
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return calls.length === 1 ? tracked.response : plainTextResponse("fallback-token");
  };

  assert.equal(await fetchMeoToken({ fetcher }), "fallback-token");
  assert.deepEqual(calls, MEO_TOKEN_ENDPOINTS);
  assert.equal(tracked.state.bytesRead, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.equal(tracked.state.canceled, true);
});

test("non-BYOB streams fail closed without delivering a single large chunk", async () => {
  const tracked = trackedNonByobResponse([new Uint8Array(100_000).fill(97)]);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return calls.length === 1 ? tracked.response : plainTextResponse("fallback-token");
  };

  assert.equal(await fetchMeoToken({ fetcher }), "fallback-token");
  assert.deepEqual(calls, MEO_TOKEN_ENDPOINTS);
  assert.equal(tracked.state.bytesRead, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.equal(tracked.state.canceled, true);
});

test("BYOB streamed overflow stops at the 4097-byte decision boundary", async () => {
  const tracked = trackedLargeByteResponse(100_000);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1 ? tracked.response : plainTextResponse("fallback-token");
  };

  assert.equal(await fetchMeoToken({ fetcher }), "fallback-token");
  assert.equal(tracked.state.bytesRead, 4097);
  assert.equal(tracked.state.canceled, true);
});

test("both endpoint failures produce one generic error with no upstream secrets", async () => {
  const bodySecret = "response-body-secret-token";
  const urlSecret = "https://upstream.invalid/path?key=query-secret";
  const exceptionSecret = "underlying exception detail";
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return plainTextResponse(`${bodySecret} ${urlSecret}`, { status: 500 });
    throw new Error(`${exceptionSecret} ${urlSecret}`);
  };

  let thrown;
  try {
    await fetchMeoToken({ fetcher });
  } catch (error) {
    thrown = error;
  }

  assertSanitizedError(thrown);
  assert.equal(calls, 2);
  const publicError = `${thrown.name} ${thrown.message} ${thrown.stack}`;
  for (const secret of [bodySecret, urlSecret, "query-secret", exceptionSecret]) {
    assert.equal(publicError.includes(secret), false);
  }
});

test("signMeoPlaylistUrl signs canonical MEO playlist URLs exactly once", () => {
  const original = "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8";
  const token = "abc+/=?&%";
  const signed = signMeoPlaylistUrl(original, token);
  const parsed = new URL(signed);

  assert.equal(original, "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8");
  assert.equal(parsed.origin, "https://video-auth1.iol.pt");
  assert.equal(parsed.pathname, "/auth-beachcam/riviera/playlist.m3u8");
  assert.equal(parsed.searchParams.getAll("wmsAuthSign").length, 1);
  assert.equal(parsed.searchParams.get("wmsAuthSign"), token);
  assert.equal(parsed.hash, "");
  assert.equal(
    signed,
    "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8?wmsAuthSign=abc%2B%2F%3D%3F%26%25"
  );

  assert.equal(
    signMeoPlaylistUrl("https://video-auth1.iol.pt/beachcam/feed_1/playlist.m3u8", "token"),
    "https://video-auth1.iol.pt/beachcam/feed_1/playlist.m3u8?wmsAuthSign=token"
  );
});

test("signMeoPlaylistUrl rejects non-canonical sources and invalid tokens", () => {
  const invalidSources = [
    "http://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8",
    "https://user:pass@video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8",
    "https://video-auth1.iol.pt.evil.invalid/auth-beachcam/riviera/playlist.m3u8",
    "https://video-auth1.iol.pt:8443/auth-beachcam/riviera/playlist.m3u8",
    "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8?x=1",
    "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8#fragment",
    "https://video-auth1.iol.pt/auth-beachcam/riviera/",
    "https://video-auth1.iol.pt/media/riviera.jpg",
    "https://beachcam.meo.pt/livecams/riviera/",
    " https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8 ",
    "not a url",
    "",
    null
  ];

  for (const source of invalidSources) {
    assert.throws(() => signMeoPlaylistUrl(source, "token"), assertSanitizedError);
  }
  for (const token of ["", "   ", "bad\u0000token", "a".repeat(4097), null]) {
    assert.throws(
      () => signMeoPlaylistUrl(
        "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8",
        token
      ),
      assertSanitizedError
    );
  }
});
