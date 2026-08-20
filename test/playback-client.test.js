import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlaybackBrokerClient,
  PlaybackBrokerError
} from "../src/playback-client.js";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const FUTURE = new Date(NOW + 60_000).toISOString();
const LATER = new Date(NOW + 120_000).toISOString();
const MAX_RESPONSE_BYTES = 16 * 1024;

function signedUrl(signature = "fixture-signature", feed = "fixture_feed") {
  return `https://video-auth1.iol.pt/auth-beachcam/${feed}/playlist.m3u8?wmsAuthSign=${signature}`;
}

function playbackRecord(cameraId, {
  signature = "fixture-signature",
  revision = "revision-1",
  refreshAt = FUTURE,
  feed = "fixture_feed"
} = {}) {
  return {
    cameraId,
    playlistUrl: signedUrl(signature, feed),
    revision,
    refreshAt
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate, message = "condition was not reached") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

function trackedJsonResponse(value, {
  status = 200,
  declaredLength,
  normalStream = false,
  rawBytes
} = {}) {
  const bytes = rawBytes ?? new TextEncoder().encode(JSON.stringify(value));
  const state = {
    bytesDelivered: 0,
    canceled: false,
    pulls: 0
  };
  let offset = 0;
  const source = normalStream ? {
    pull(controller) {
      state.pulls += 1;
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset);
      offset = bytes.byteLength;
      state.bytesDelivered += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      state.canceled = true;
    }
  } : {
    type: "bytes",
    pull(controller) {
      state.pulls += 1;
      if (offset >= bytes.byteLength) {
        controller.close();
        controller.byobRequest?.respond(0);
        return;
      }
      const view = controller.byobRequest?.view;
      if (!view) {
        const chunk = bytes.slice(offset);
        offset = bytes.byteLength;
        state.bytesDelivered += chunk.byteLength;
        controller.enqueue(chunk);
        return;
      }
      const byteLength = Math.min(view.byteLength, bytes.byteLength - offset);
      view.set(bytes.subarray(offset, offset + byteLength));
      offset += byteLength;
      state.bytesDelivered += byteLength;
      controller.byobRequest.respond(byteLength);
    },
    cancel() {
      state.canceled = true;
    }
  };
  const headers = new Headers({ "content-type": "application/json" });
  if (declaredLength !== undefined) {
    headers.set("content-length", String(declaredLength));
  }
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers,
      body: new ReadableStream(source, { highWaterMark: 0 })
    },
    bytes,
    state
  };
}

function response(value, options) {
  return trackedJsonResponse(value, options).response;
}

async function captureError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail("expected PlaybackBrokerError");
}

function assertGeneric(error, hiddenValues = []) {
  assert.equal(error instanceof PlaybackBrokerError, true);
  assert.equal(error.name, "PlaybackBrokerError");
  assert.equal(error.message, "Playback unavailable");
  assert.equal(Object.hasOwn(error, "cause"), false);
  const publicText = `${error.name} ${error.message} ${error.stack}`;
  for (const hidden of hiddenValues) {
    assert.equal(publicText.includes(hidden), false);
  }
}

function requestMethod(call) {
  return call.init.method;
}

test("resolve uses the exact encoded GET contract and returns the original signed URL", async () => {
  const calls = [];
  const cameraId = "beach / costa ? ç";
  const record = playbackRecord(cameraId);
  const client = createPlaybackBrokerClient({
    basePath: "/api/playback",
    fetcher: async (url, init) => {
      calls.push({ init, url });
      return response(record);
    },
    now: () => NOW
  });

  const resolved = await client.resolve(cameraId);

  assert.deepEqual(Object.keys(client).sort(), ["refresh", "resolve"]);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/playback/${encodeURIComponent(cameraId)}`
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
  assert.deepEqual([...new Headers(calls[0].init.headers)], [
    ["accept", "application/json"]
  ]);
  assert.equal(Object.hasOwn(calls[0].init, "body"), false);
  assert.deepEqual(Object.keys(resolved), [
    "cameraId",
    "playlistUrl",
    "revision",
    "refreshAt"
  ]);
  assert.equal(resolved.cameraId, cameraId);
  assert.equal(resolved.playlistUrl === record.playlistUrl, true);
  assert.equal(resolved.revision === record.revision, true);
  assert.equal(resolved.refreshAt, FUTURE);
});

test("refresh uses the exact encoded POST contract and opaque body", async () => {
  const calls = [];
  const cameraId = "costa / riviera";
  const failedRevision = "  opaque revision / ? # 🌊  ";
  const replacement = playbackRecord(cameraId, { revision: "revision-2" });
  const client = createPlaybackBrokerClient({
    fetcher: async (url, init) => {
      calls.push({ init, url });
      return response(replacement);
    },
    now: () => NOW
  });

  const resolved = await client.refresh(cameraId, failedRevision);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/playback/${encodeURIComponent(cameraId)}/refresh`
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
  assert.deepEqual([...new Headers(calls[0].init.headers)], [
    ["accept", "application/json"],
    ["content-type", "application/json"]
  ]);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body), ["failedRevision"]);
  assert.equal(body.failedRevision === failedRevision, true);
  assert.equal(resolved.cameraId, cameraId);
  assert.equal(resolved.revision === replacement.revision, true);
});

test("signed URL validation accepts only the exact MEO HLS contract", async (t) => {
  const cameraId = "camera-a";
  const invalidUrls = [
    "http://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt.evil.invalid/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://VIDEO-AUTH1.IOL.PT/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://user:pass@video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt:8443/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt:443/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x#fragment",
    "https://video-auth1.iol.pt/auth-beachcam/other/../feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt/media/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt/auth-beachcam/feed/index.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x&wmsAuthSign=y",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x&extra=y",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x&",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wms%41uthSign=x",
    " https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x ",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?\u0000wmsAuthSign=x",
    "https://video-auth1.iol.pt/auth-beachcam/feed/playlist.m3u8?wmsAuthSign=x\u0085",
    "not-a-url",
    "",
    null
  ];

  for (const [index, playlistUrl] of invalidUrls.entries()) {
    await t.test(`invalid URL shape ${index + 1}`, async () => {
      const client = createPlaybackBrokerClient({
        fetcher: async () => response({
          ...playbackRecord(cameraId),
          playlistUrl
        }),
        now: () => NOW
      });
      assertGeneric(await captureError(() => client.resolve(cameraId)));
    });
  }

  for (const playlistUrl of [
    signedUrl("x", "feed_1"),
    "https://video-auth1.iol.pt/beachcam/feed-2/playlist.m3u8?wmsAuthSign=a%2Bb%2F%3D"
  ]) {
    const client = createPlaybackBrokerClient({
      fetcher: async () => response({
        ...playbackRecord(cameraId),
        playlistUrl
      }),
      now: () => NOW
    });
    const resolved = await client.resolve(cameraId);
    assert.equal(resolved.playlistUrl === playlistUrl, true);
  }
});

test("response validation rejects malformed IDs, revisions, timestamps, and shapes", async (t) => {
  const cameraId = "camera-a";
  const valid = playbackRecord(cameraId);
  const invalidRecords = [
    null,
    [],
    "not-an-object",
    { ...valid, extra: true },
    { ...valid, cameraId: "camera-b" },
    { ...valid, cameraId: null },
    { ...valid, revision: "" },
    { ...valid, revision: "   " },
    { ...valid, revision: "x".repeat(257) },
    { ...valid, revision: "🌊".repeat(65) },
    { ...valid, revision: "bad\u0085revision" },
    { ...valid, refreshAt: new Date(NOW).toISOString() },
    { ...valid, refreshAt: new Date(NOW - 1).toISOString() },
    { ...valid, refreshAt: "2026-08-20T13:00:00Z" },
    { ...valid, refreshAt: "not-a-date" },
    { ...valid, refreshAt: null }
  ];

  for (const [index, value] of invalidRecords.entries()) {
    await t.test(`invalid response shape ${index + 1}`, async () => {
      const client = createPlaybackBrokerClient({
        fetcher: async () => response(value),
        now: () => NOW
      });
      assertGeneric(await captureError(() => client.resolve(cameraId)));
    });
  }
});

test("a response of exactly 16 KiB is accepted", async () => {
  const cameraId = "camera-a";
  const emptySignature = playbackRecord(cameraId, { signature: "" });
  const baseBytes = new TextEncoder().encode(JSON.stringify(emptySignature)).byteLength;
  const record = playbackRecord(cameraId, {
    signature: "a".repeat(MAX_RESPONSE_BYTES - baseBytes)
  });
  const tracked = trackedJsonResponse(record);
  assert.equal(tracked.bytes.byteLength, MAX_RESPONSE_BYTES);
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  const resolved = await client.resolve(cameraId);

  assert.equal(resolved.cameraId, cameraId);
  assert.equal(resolved.playlistUrl === record.playlistUrl, true);
  assert.equal(tracked.state.bytesDelivered, MAX_RESPONSE_BYTES);
  assert.equal(tracked.state.canceled, false);
});

test("streaming overflow consumes only byte 16,385 and cancels", async () => {
  const tracked = trackedJsonResponse(null, {
    rawBytes: new Uint8Array(100_000).fill(97)
  });
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  assertGeneric(await captureError(() => client.resolve("camera-a")));
  assert.equal(tracked.state.bytesDelivered, MAX_RESPONSE_BYTES + 1);
  assert.equal(tracked.state.canceled, true);
});

test("declared oversized responses are canceled before any body byte is read", async () => {
  const tracked = trackedJsonResponse(playbackRecord("camera-a"), {
    declaredLength: MAX_RESPONSE_BYTES + 1
  });
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  assertGeneric(await captureError(() => client.resolve("camera-a")));
  assert.equal(tracked.state.bytesDelivered, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.equal(tracked.state.canceled, true);
});

test("ordinary Safari-compatible response streams are supported", async () => {
  const tracked = trackedJsonResponse(playbackRecord("camera-a"), {
    normalStream: true
  });
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  const resolved = await client.resolve("camera-a");

  assert.equal(resolved.cameraId, "camera-a");
  assert.equal(tracked.state.bytesDelivered, tracked.bytes.byteLength);
  assert.equal(tracked.state.canceled, false);
});

test("ordinary stream overflow is canceled without accumulating beyond 16 KiB", async () => {
  const tracked = trackedJsonResponse(null, {
    normalStream: true,
    rawBytes: new Uint8Array(100_000).fill(97)
  });
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  assertGeneric(await captureError(() => client.resolve("camera-a")));
  assert.equal(tracked.state.pulls, 1);
  assert.equal(tracked.state.canceled, true);
});

test("invalid UTF-8 and invalid JSON fail generically", async (t) => {
  for (const bytes of [
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode("{not-json")
  ]) {
    await t.test(`invalid body ${bytes[0]}`, async () => {
      const client = createPlaybackBrokerClient({
        fetcher: async () => trackedJsonResponse(null, { rawBytes: bytes }).response,
        now: () => NOW
      });
      assertGeneric(await captureError(() => client.resolve("camera-a")));
    });
  }
});

test("cache expiry is exact and reads never slide it", async () => {
  const cameraId = "camera-a";
  let now = NOW;
  let calls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async () => {
      calls += 1;
      return response(playbackRecord(cameraId, {
        signature: `signature-${calls}`,
        revision: `revision-${calls}`,
        refreshAt: calls === 1 ? FUTURE : LATER
      }));
    },
    now: () => now
  });

  const first = await client.resolve(cameraId);
  now = NOW + 59_999;
  const cached = await client.resolve(cameraId);
  now = NOW + 60_000;
  const refreshed = await client.resolve(cameraId);

  assert.equal(calls, 2);
  assert.equal(cached.playlistUrl === first.playlistUrl, true);
  assert.equal(refreshed.playlistUrl === first.playlistUrl, false);
});

test("callers cannot mutate the private cached record", async () => {
  const cameraId = "camera-a";
  const original = playbackRecord(cameraId);
  let calls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async () => {
      calls += 1;
      return response(original);
    },
    now: () => NOW
  });

  const first = await client.resolve(cameraId);
  first.playlistUrl = "poisoned";
  first.revision = "poisoned";
  first.refreshAt = "poisoned";
  const second = await client.resolve(cameraId);
  second.cameraId = "poisoned";
  const third = await client.resolve(cameraId);

  assert.equal(calls, 1);
  assert.equal(second.playlistUrl === original.playlistUrl, true);
  assert.equal(second.revision === original.revision, true);
  assert.equal(second.refreshAt, original.refreshAt);
  assert.equal(third.cameraId, cameraId);
});

test("concurrent resolves for one camera share one GET and receive separate copies", async () => {
  const pending = deferred();
  let calls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async () => {
      calls += 1;
      return pending.promise;
    },
    now: () => NOW
  });

  const firstPromise = client.resolve("camera-a");
  const secondPromise = client.resolve("camera-a");
  await waitFor(() => calls === 1);
  pending.resolve(response(playbackRecord("camera-a")));
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(calls, 1);
  assert.notEqual(first, second);
  assert.equal(first.playlistUrl === second.playlistUrl, true);
});

test("one revision-wide refresh evicts all matching cameras and coordinates follow-up GETs", async () => {
  const calls = [];
  const refreshResponse = deferred();
  const fetcher = async (url, init) => {
    calls.push({ method: init.method, url });
    if (init.method === "POST") return refreshResponse.promise;
    const cameraId = decodeURIComponent(url.split("/").at(-1));
    const revision = calls.filter((call) => call.method === "POST").length
      ? "revision-2"
      : "revision-1";
    return response(playbackRecord(cameraId, { revision }));
  };
  const client = createPlaybackBrokerClient({ fetcher, now: () => NOW });
  await Promise.all([client.resolve("camera-a"), client.resolve("camera-b")]);
  assert.equal(calls.length, 2);

  const firstRefresh = client.refresh("camera-a", "revision-1");
  const joinedRefresh = client.refresh("camera-a", "revision-1");
  const otherCameraRefresh = client.refresh("camera-b", "revision-1");
  const evictedResolve = client.resolve("camera-b");
  await waitFor(
    () => calls.filter((call) => call.method === "POST").length === 1,
    "shared refresh POST did not start"
  );
  assert.equal(calls.length, 3);

  refreshResponse.resolve(response(playbackRecord("camera-a", {
    revision: "revision-2"
  })));
  const [first, joined, other, resolved] = await Promise.all([
    firstRefresh,
    joinedRefresh,
    otherCameraRefresh,
    evictedResolve
  ]);

  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(
    calls.filter((call) => call.method === "GET" && call.url.endsWith("camera-b")).length,
    2
  );
  assert.equal(first.cameraId, "camera-a");
  assert.equal(joined.cameraId, "camera-a");
  assert.equal(other.cameraId, "camera-b");
  assert.equal(resolved.cameraId, "camera-b");
  assert.equal(other.revision === first.revision, true);
});

test("a refresh response cannot reuse its failed revision", async () => {
  const client = createPlaybackBrokerClient({
    fetcher: async () => response(playbackRecord("camera-a", {
      revision: "revision-1"
    })),
    now: () => NOW
  });

  assertGeneric(await captureError(
    () => client.refresh("camera-a", "revision-1")
  ));
});

test("a GET overtaken by refresh cannot resurrect its old revision", async () => {
  const oldGet = deferred();
  const calls = [];
  const client = createPlaybackBrokerClient({
    fetcher: async (url, init) => {
      calls.push({ method: init.method, url });
      if (init.method === "POST") {
        return response(playbackRecord("camera-a", { revision: "revision-2" }));
      }
      if (calls.filter((call) => call.method === "GET").length === 1) {
        return oldGet.promise;
      }
      return response(playbackRecord("camera-a", { revision: "revision-2" }));
    },
    now: () => NOW
  });

  const resolving = client.resolve("camera-a");
  await waitFor(() => calls.length === 1);
  const replacement = await client.refresh("camera-a", "revision-1");
  oldGet.resolve(response(playbackRecord("camera-a", { revision: "revision-1" })));
  const resolved = await resolving;

  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
  assert.equal(resolved.revision === replacement.revision, true);
  assert.equal(resolved.playlistUrl === replacement.playlistUrl, true);
});

test("an arbitrarily late old GET remains stale after many later refresh epochs", async () => {
  const oldGet = deferred();
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (init.method === "GET") {
        getCalls += 1;
        if (getCalls === 1) return oldGet.promise;
        return response(playbackRecord("camera-a", { revision: "latest-current" }));
      }
      postCalls += 1;
      return response(playbackRecord("camera-b", {
        revision: `replacement-${postCalls}`
      }));
    },
    now: () => NOW
  });

  const resolving = client.resolve("camera-a");
  await waitFor(() => getCalls === 1);
  for (let index = 0; index < 140; index += 1) {
    await client.refresh("camera-b", `failed-${index}`);
  }
  oldGet.resolve(response(playbackRecord("camera-a", { revision: "retired-old" })));
  const resolved = await resolving;

  assert.equal(postCalls, 140);
  assert.equal(getCalls, 2);
  assert.equal(resolved.revision === "retired-old", false);
});

test("a second stale GET fails generically without a third retry", async () => {
  const firstGet = deferred();
  const secondGet = deferred();
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (init.method === "POST") {
        postCalls += 1;
        return response(playbackRecord("camera-a", {
          revision: `replacement-${postCalls}`
        }));
      }
      getCalls += 1;
      return getCalls === 1 ? firstGet.promise : secondGet.promise;
    },
    now: () => NOW
  });

  const resolving = client.resolve("camera-a");
  await waitFor(() => getCalls === 1);
  await client.refresh("camera-a", "failed-1");
  firstGet.resolve(response(playbackRecord("camera-a", { revision: "failed-1" })));
  await waitFor(() => getCalls === 2, "fresh follow-up GET did not start");
  await client.refresh("camera-a", "failed-2");
  secondGet.resolve(response(playbackRecord("camera-a", { revision: "replacement-1" })));

  assertGeneric(await captureError(() => resolving));
  assert.equal(getCalls, 2);
});

test("a late older POST cannot overwrite or return a newer refresh epoch", async () => {
  const olderPost = deferred();
  const newerPost = deferred();
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (init.method === "GET") {
        getCalls += 1;
        return response(playbackRecord("camera-a", { revision: "revision-3" }));
      }
      postCalls += 1;
      return postCalls === 1 ? olderPost.promise : newerPost.promise;
    },
    now: () => NOW
  });

  const olderRefresh = client.refresh("camera-a", "revision-1");
  const newerRefresh = client.refresh("camera-a", "revision-2");
  await waitFor(() => postCalls === 2);
  newerPost.resolve(response(playbackRecord("camera-a", { revision: "revision-3" })));
  const newer = await newerRefresh;
  olderPost.resolve(response(playbackRecord("camera-a", { revision: "revision-2" })));
  const older = await olderRefresh;
  const cached = await client.resolve("camera-a");

  assert.equal(getCalls, 1);
  assert.equal(older.revision === newer.revision, true);
  assert.equal(cached.revision === newer.revision, true);
});

test("failed refresh rolls back its barrier without permanently retiring the revision", async () => {
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (init.method === "GET") {
        getCalls += 1;
        return response(playbackRecord("camera-a", { revision: "revision-1" }));
      }
      postCalls += 1;
      if (postCalls === 1) throw new Error("private provider detail");
      return response(playbackRecord("camera-a", { revision: "revision-2" }));
    },
    now: () => NOW
  });

  await client.resolve("camera-a");
  assertGeneric(await captureError(
    () => client.refresh("camera-a", "revision-1")
  ));
  const secondGeneration = await client.resolve("camera-a");
  const replacement = await client.refresh("camera-a", "revision-1");

  assert.equal(getCalls, 2);
  assert.equal(postCalls, 2);
  assert.equal(secondGeneration.revision === "revision-1", true);
  assert.equal(replacement.revision === "revision-1", false);
});

test("resolve waits through a rejected refresh barrier and can fetch the preserved revision", async () => {
  const pendingRefresh = deferred();
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (url, init) => {
      if (init.method === "POST") {
        postCalls += 1;
        return pendingRefresh.promise;
      }
      getCalls += 1;
      const cameraId = decodeURIComponent(url.split("/").at(-1));
      return response(playbackRecord(cameraId, { revision: "revision-1" }));
    },
    now: () => NOW
  });
  await Promise.all([client.resolve("camera-a"), client.resolve("camera-b")]);

  const failedRefresh = client.refresh("camera-a", "revision-1")
    .catch((error) => error);
  await waitFor(() => postCalls === 1);
  const resolving = client.resolve("camera-b");
  await Promise.resolve();
  assert.equal(getCalls, 2);
  pendingRefresh.reject(new Error("private refresh failure"));
  const refreshError = await failedRefresh;
  const recovered = await resolving;

  assertGeneric(refreshError);
  assert.equal(getCalls, 3);
  assert.equal(recovered.revision === "revision-1", true);
});

test("a stale GET drains every refresh barrier even when an earlier one rejects", async () => {
  const oldGet = deferred();
  const rejectedRefresh = deferred();
  const pendingRefresh = deferred();
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (init.method === "GET") {
        getCalls += 1;
        if (getCalls === 1) return oldGet.promise;
        return response(playbackRecord("camera-a", { revision: "revision-3" }));
      }
      postCalls += 1;
      return postCalls === 1 ? rejectedRefresh.promise : pendingRefresh.promise;
    },
    now: () => NOW
  });

  const resolving = client.resolve("camera-a");
  await waitFor(() => getCalls === 1);
  const firstRefresh = client.refresh("camera-a", "revision-1")
    .catch((error) => error);
  const secondRefresh = client.refresh("camera-a", "revision-2");
  await waitFor(() => postCalls === 2);
  oldGet.resolve(response(playbackRecord("camera-a", { revision: "revision-1" })));
  rejectedRefresh.reject(new Error("private first barrier failure"));
  const firstError = await firstRefresh;
  await Promise.resolve();

  assertGeneric(firstError);
  assert.equal(getCalls, 1);
  pendingRefresh.resolve(response(playbackRecord("camera-a", {
    revision: "revision-3"
  })));
  const [secondResult, resolved] = await Promise.all([secondRefresh, resolving]);

  assert.equal(getCalls, 2);
  assert.equal(resolved.revision === secondResult.revision, true);
});

test("rejected resolve and refresh operations are removed from their in-flight maps", async () => {
  let getCalls = 0;
  let postCalls = 0;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      if (requestMethod({ init }) === "GET") {
        getCalls += 1;
        if (getCalls === 1) throw new Error("private GET rejection");
        return response(playbackRecord("camera-a", { revision: "revision-1" }));
      }
      postCalls += 1;
      if (postCalls === 1) throw new Error("private POST rejection");
      return response(playbackRecord("camera-a", { revision: "revision-2" }));
    },
    now: () => NOW
  });

  const firstResolveError = await captureError(() => client.resolve("camera-a"));
  const resolved = await client.resolve("camera-a");
  const firstRefreshError = await captureError(
    () => client.refresh("camera-a", "revision-1")
  );
  const refreshed = await client.refresh("camera-a", "revision-1");

  assertGeneric(firstResolveError);
  assertGeneric(firstRefreshError);
  assert.equal(getCalls, 2);
  assert.equal(postCalls, 2);
  assert.equal(resolved.revision === "revision-1", true);
  assert.equal(refreshed.revision === "revision-2", true);
});

test("concurrent callers receive fresh generic errors with no cause or secret detail", async () => {
  const bodySecret = "response-body-secret";
  const urlSecret = "https://upstream.invalid/path?private=query-secret";
  let calls = 0;
  const pending = deferred();
  const client = createPlaybackBrokerClient({
    fetcher: async () => {
      calls += 1;
      return pending.promise;
    },
    now: () => NOW
  });

  const first = client.resolve("camera-a").catch((error) => error);
  const second = client.resolve("camera-a").catch((error) => error);
  await waitFor(() => calls === 1);
  pending.resolve(response({ error: `${bodySecret} ${urlSecret}` }, { status: 503 }));
  const [firstError, secondError] = await Promise.all([first, second]);

  assertGeneric(firstError, [bodySecret, urlSecret, "query-secret"]);
  assertGeneric(secondError, [bodySecret, urlSecret, "query-secret"]);
  assert.notEqual(firstError, secondError);
});

test("each request uses one default 15-second timer and always clears it", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const active = new Set();
  let nextTimer = 0;
  globalThis.setTimeout = (callback, delay) => {
    nextTimer += 1;
    scheduled.push({ callback, delay, id: nextTimer });
    active.add(nextTimer);
    return nextTimer;
  };
  globalThis.clearTimeout = (timerId) => {
    active.delete(timerId);
  };

  try {
    const client = createPlaybackBrokerClient({
      fetcher: async () => response(playbackRecord("camera-a")),
      now: () => NOW
    });
    await client.resolve("camera-a");
    await client.resolve("camera-a");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 15_000);
  assert.equal(active.size, 0);
});

test("a rejected request also clears its sole timeout timer", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const active = new Set();
  let scheduled = 0;
  globalThis.setTimeout = () => {
    scheduled += 1;
    active.add(scheduled);
    return scheduled;
  };
  globalThis.clearTimeout = (timerId) => {
    active.delete(timerId);
  };

  let error;
  try {
    const client = createPlaybackBrokerClient({
      fetcher: async () => {
        throw new Error("private rejection detail");
      },
      now: () => NOW
    });
    error = await captureError(() => client.resolve("camera-a"));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assertGeneric(error);
  assert.equal(scheduled, 1);
  assert.equal(active.size, 0);
});

test("a request that ignores abort still fails at the configured timeout", async () => {
  let signal;
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
    now: () => NOW,
    requestTimeoutMs: 5
  });

  const error = await captureError(() => client.resolve("camera-a"));

  assertGeneric(error);
  assert.equal(signal.aborted, true);
});

test("the request timeout also bounds a body reader that never settles", async () => {
  let canceled = false;
  let signal;
  const body = {
    getReader() {
      return {
        cancel() {
          canceled = true;
          return Promise.resolve();
        },
        read() {
          return new Promise(() => {});
        }
      };
    }
  };
  const client = createPlaybackBrokerClient({
    fetcher: async (_url, init) => {
      signal = init.signal;
      return {
        body,
        headers: new Headers({ "content-type": "application/json" }),
        ok: true,
        status: 200
      };
    },
    now: () => NOW,
    requestTimeoutMs: 5
  });

  const error = await captureError(() => client.resolve("camera-a"));

  assertGeneric(error);
  assert.equal(signal.aborted, true);
  assert.equal(canceled, true);
});

test("non-2xx, fetch rejection, and malformed inputs expose only generic errors", async (t) => {
  const bodySecret = "private-response-body";
  const signedSecret = signedUrl("private-query-value");
  const revisionSecret = "private-revision-value";
  const cases = [
    async () => response({
      error: `${bodySecret} ${signedSecret} ${revisionSecret}`
    }, { status: 502 }),
    async () => {
      throw new Error(`${bodySecret} ${signedSecret} ${revisionSecret}`);
    }
  ];
  for (const [index, fetcher] of cases.entries()) {
    await t.test(`network failure ${index + 1}`, async () => {
      const client = createPlaybackBrokerClient({ fetcher, now: () => NOW });
      assertGeneric(
        await captureError(() => client.resolve("camera-a")),
        [bodySecret, signedSecret, revisionSecret, "private-query-value"]
      );
    });
  }

  const client = createPlaybackBrokerClient({
    fetcher: async () => response(playbackRecord("camera-a")),
    now: () => NOW
  });
  for (const operation of [
    () => client.resolve(""),
    () => client.resolve("bad\u0000id"),
    () => client.refresh("camera-a", ""),
    () => client.refresh("camera-a", "x".repeat(257)),
    () => client.refresh("camera-a", "bad\u0085revision")
  ]) {
    assertGeneric(await captureError(operation));
  }
});

test("a non-2xx response body is canceled without being read", async () => {
  const tracked = trackedJsonResponse({ error: "private response detail" }, {
    status: 503
  });
  const client = createPlaybackBrokerClient({
    fetcher: async () => tracked.response,
    now: () => NOW
  });

  assertGeneric(await captureError(() => client.resolve("camera-a")));
  assert.equal(tracked.state.bytesDelivered, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.equal(tracked.state.canceled, true);
});

test("playback resolution neither touches browser storage nor logs failures", async () => {
  const storageNames = ["localStorage", "sessionStorage"];
  const descriptors = new Map();
  let storageReads = 0;
  for (const name of storageNames) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        storageReads += 1;
        throw new Error("storage must remain unused");
      }
    });
  }
  const consoleMethods = ["debug", "error", "info", "log", "warn"];
  const originals = new Map(consoleMethods.map((name) => [name, console[name]]));
  let logCalls = 0;
  for (const name of consoleMethods) {
    console[name] = () => {
      logCalls += 1;
    };
  }

  let error;
  try {
    const client = createPlaybackBrokerClient({
      fetcher: async () => {
        throw new Error("private network detail");
      },
      now: () => NOW
    });
    error = await captureError(() => client.resolve("camera-a"));
  } finally {
    for (const [name, original] of originals) console[name] = original;
    for (const name of storageNames) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }

  assertGeneric(error);
  assert.equal(storageReads, 0);
  assert.equal(logCalls, 0);
});
