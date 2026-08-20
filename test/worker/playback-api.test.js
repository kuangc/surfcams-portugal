import assert from "node:assert/strict";
import test from "node:test";

import { createPlaybackApi } from "../../worker/playback-api.js";

const API_ORIGIN = "https://surfcams.example";
const KNOWN_CAMERA = Object.freeze({
  id: "praia-de-carcavelos",
  streamUrl: "https://video-auth1.iol.pt/auth-beachcam/carcavelos/playlist.m3u8"
});

function apiRequest(path, init) {
  return new Request(`${API_ORIGIN}${path}`, init);
}

function jsonRequest(path, value, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return apiRequest(path, {
    ...init,
    method: init.method ?? "POST",
    headers,
    body: typeof value === "string" ? value : JSON.stringify(value)
  });
}

function streamingRequest(path, chunks, { contentLength } = {}) {
  const state = { bytesDelivered: 0, canceled: false, pulls: 0 };
  let index = 0;
  let offset = 0;
  const body = new ReadableStream({
    type: "bytes",
    pull(controller) {
      state.pulls += 1;
      if (index >= chunks.length) {
        controller.close();
        controller.byobRequest?.respond(0);
        return;
      }
      const chunk = chunks[index];
      const view = controller.byobRequest?.view;
      if (!view) {
        const remaining = chunk.slice(offset);
        state.bytesDelivered += remaining.byteLength;
        index += 1;
        offset = 0;
        controller.enqueue(remaining);
        return;
      }
      const byteLength = Math.min(view.byteLength, chunk.byteLength - offset);
      view.set(chunk.subarray(offset, offset + byteLength));
      state.bytesDelivered += byteLength;
      offset += byteLength;
      if (offset === chunk.byteLength) {
        index += 1;
        offset = 0;
      }
      controller.byobRequest.respond(byteLength);
    },
    cancel() {
      state.canceled = true;
    }
  }, { highWaterMark: 0 });
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return {
    request: apiRequest(path, {
      method: "POST",
      headers,
      body,
      duplex: "half"
    }),
    state
  };
}

function disposableRecord(overrides = {}, { disposeError } = {}) {
  const state = { disposeCalls: 0 };
  const record = {
    token: "fixture-token",
    revision: "revision-1",
    refreshAt: Date.UTC(2026, 7, 20, 18, 30, 0),
    ...overrides,
    [Symbol.dispose]() {
      state.disposeCalls += 1;
      if (disposeError) throw disposeError;
    }
  };
  return { record, state };
}

function createHarness({
  findCamera = (cameraId) => cameraId === KNOWN_CAMERA.id ? KNOWN_CAMERA : null,
  signUrl = (streamUrl, token) => `${streamUrl}?wmsAuthSign=${token}`,
  getToken,
  refreshToken
} = {}) {
  const calls = {
    coordinatorNames: [],
    getToken: 0,
    refreshToken: [],
    signUrl: []
  };
  const defaultGetRecord = disposableRecord();
  const defaultRefreshRecord = disposableRecord({
    token: "replacement-token",
    revision: "revision-2"
  });
  const coordinator = {
    async getToken() {
      calls.getToken += 1;
      return getToken ? getToken() : defaultGetRecord.record;
    },
    async refreshToken(failedRevision) {
      calls.refreshToken.push(failedRevision);
      return refreshToken ? refreshToken(failedRevision) : defaultRefreshRecord.record;
    }
  };
  const env = {
    MEO_TOKEN_COORDINATOR: {
      getByName(name) {
        calls.coordinatorNames.push(name);
        return coordinator;
      }
    }
  };
  const api = createPlaybackApi({
    findCamera,
    signUrl(streamUrl, token) {
      calls.signUrl.push([streamUrl, token]);
      return signUrl(streamUrl, token);
    }
  });
  return {
    api,
    calls,
    env,
    defaultGetRecord,
    defaultRefreshRecord
  };
}

async function readApiResponse(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  const text = await response.text();
  assert.ok(new TextEncoder().encode(text).byteLength <= 512);
  return { text, json: JSON.parse(text) };
}

test("GET returns only the signed playback contract and disposes the RPC record", async () => {
  const harness = createHarness();

  const response = await harness.api(
    apiRequest(`/api/playback/${KNOWN_CAMERA.id}`),
    harness.env
  );
  const { json } = await readApiResponse(response, 200);

  assert.deepEqual(Object.keys(json), [
    "cameraId",
    "playlistUrl",
    "revision",
    "refreshAt"
  ]);
  assert.equal(json.cameraId, KNOWN_CAMERA.id);
  assert.equal(
    json.playlistUrl === `${KNOWN_CAMERA.streamUrl}?wmsAuthSign=fixture-token`,
    true
  );
  assert.equal(json.revision, "revision-1");
  assert.equal(json.refreshAt, "2026-08-20T18:30:00.000Z");
  assert.deepEqual(harness.calls.coordinatorNames, ["global"]);
  assert.equal(harness.calls.getToken, 1);
  assert.deepEqual(harness.calls.refreshToken, []);
  assert.equal(harness.calls.signUrl.length, 1);
  assert.equal(harness.calls.signUrl[0][0] === KNOWN_CAMERA.streamUrl, true);
  assert.equal(harness.calls.signUrl[0][1] === "fixture-token", true);
  assert.equal(harness.defaultGetRecord.state.disposeCalls, 1);
});

test("unavailable and malformed IDs return 404 before coordinator access", async (t) => {
  const unavailableIds = new Set([
    "unknown-camera",
    "surfline-camera",
    "promoted-alias",
    "streamless-camera"
  ]);
  const harness = createHarness({
    findCamera(cameraId) {
      return unavailableIds.has(cameraId) ? null :
        cameraId === KNOWN_CAMERA.id ? KNOWN_CAMERA : null;
    }
  });
  const paths = [
    "/api/playback/unknown-camera",
    "/api/playback/surfline-camera",
    "/api/playback/promoted-alias",
    "/api/playback/streamless-camera",
    "/api/playback/",
    "/api/playback/praia-de-carcavelos/extra",
    "/api/playback/praia%2Dde%2Dcarcavelos",
    "/api/playback/praia-de%2Fcarcavelos",
    "/api/playback/%70raia-de-carcavelos"
  ];

  for (const path of paths) {
    await t.test(path, async () => {
      const { json } = await readApiResponse(
        await harness.api(apiRequest(path), harness.env),
        404
      );
      assert.deepEqual(json, { error: "Not found" });
    });
  }

  assert.deepEqual(harness.calls.coordinatorNames, []);
  assert.equal(harness.calls.getToken, 0);
  assert.deepEqual(harness.calls.refreshToken, []);
  assert.deepEqual(harness.calls.signUrl, []);
});

test("refresh accepts only the exact JSON shape and passes the opaque revision unchanged", async () => {
  const harness = createHarness();
  const failedRevision = "  opaque revision / ? # 🌊  ";

  const response = await harness.api(
    jsonRequest(`/api/playback/${KNOWN_CAMERA.id}/refresh`, { failedRevision }),
    harness.env
  );
  const { json } = await readApiResponse(response, 200);

  assert.deepEqual(Object.keys(json), [
    "cameraId",
    "playlistUrl",
    "revision",
    "refreshAt"
  ]);
  assert.equal(json.cameraId, KNOWN_CAMERA.id);
  assert.equal(
    json.playlistUrl === `${KNOWN_CAMERA.streamUrl}?wmsAuthSign=replacement-token`,
    true
  );
  assert.equal(json.revision, "revision-2");
  assert.equal(json.refreshAt, "2026-08-20T18:30:00.000Z");
  assert.deepEqual(harness.calls.refreshToken, [failedRevision]);
  assert.equal(harness.calls.getToken, 0);
  assert.equal(harness.defaultRefreshRecord.state.disposeCalls, 1);
});

test("refresh accepts a valid body whose UTF-8 size is exactly 1024 bytes", async () => {
  const harness = createHarness();
  const fixedBytes = new TextEncoder().encode(JSON.stringify({ failedRevision: "" })).byteLength;
  const body = JSON.stringify({ failedRevision: "x".repeat(1024 - fixedBytes) });
  assert.equal(new TextEncoder().encode(body).byteLength, 1024);

  const { json } = await readApiResponse(
    await harness.api(jsonRequest(
      `/api/playback/${KNOWN_CAMERA.id}/refresh`,
      body,
      { headers: { "content-length": "1024" } }
    ), harness.env),
    200
  );

  assert.equal(json.revision, "revision-2");
  assert.equal(harness.calls.refreshToken[0].length, 1024 - fixedBytes);
});

test("refresh rejects non-exact content types before coordinator access", async (t) => {
  const harness = createHarness();
  for (const contentType of [
    undefined,
    "application/json; charset=utf-8",
    "Application/JSON",
    "text/json",
    ""
  ]) {
    await t.test(String(contentType), async () => {
      const headers = new Headers();
      if (contentType !== undefined) headers.set("content-type", contentType);
      const request = apiRequest(`/api/playback/${KNOWN_CAMERA.id}/refresh`, {
        method: "POST",
        headers,
        body: JSON.stringify({ failedRevision: "revision-1" })
      });
      const { json } = await readApiResponse(
        await harness.api(request, harness.env),
        415
      );
      assert.deepEqual(json, { error: "Unsupported media type" });
    });
  }
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("declared bodies above 1024 bytes are rejected and canceled before reading", async () => {
  const harness = createHarness();
  const tracked = streamingRequest(
    `/api/playback/${KNOWN_CAMERA.id}/refresh`,
    [new Uint8Array([123])],
    { contentLength: "1025" }
  );

  const { json } = await readApiResponse(
    await harness.api(tracked.request, harness.env),
    413
  );

  assert.deepEqual(json, { error: "Request body too large" });
  assert.equal(tracked.state.bytesDelivered, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.equal(tracked.state.canceled, true);
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("streaming overflow cancels as soon as byte 1025 is observed", async (t) => {
  const encoder = new TextEncoder();
  for (const contentLength of [undefined, "false", "1"] ) {
    await t.test(String(contentLength), async () => {
      const harness = createHarness();
      const tracked = streamingRequest(
        `/api/playback/${KNOWN_CAMERA.id}/refresh`,
        [
          encoder.encode("a".repeat(1024)),
          encoder.encode("b"),
          encoder.encode("private-bytes-must-not-be-read")
        ],
        { contentLength }
      );

      const { json } = await readApiResponse(
        await harness.api(tracked.request, harness.env),
        413
      );

      assert.deepEqual(json, { error: "Request body too large" });
      assert.equal(tracked.state.bytesDelivered, 1025);
      assert.equal(tracked.state.pulls, 2);
      assert.equal(tracked.state.canceled, true);
      assert.deepEqual(harness.calls.coordinatorNames, []);
    });
  }
});

test("one arbitrarily large BYOB source is consumed only through byte 1025", async () => {
  const harness = createHarness();
  const tracked = streamingRequest(
    `/api/playback/${KNOWN_CAMERA.id}/refresh`,
    [new Uint8Array(100_000).fill(97)]
  );

  const { json } = await readApiResponse(
    await harness.api(tracked.request, harness.env),
    413
  );

  assert.deepEqual(json, { error: "Request body too large" });
  assert.equal(tracked.state.bytesDelivered, 1025);
  assert.equal(tracked.state.pulls, 1);
  assert.equal(tracked.state.canceled, true);
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("non-BYOB request streams fail closed and cancel without a pull", async () => {
  const state = { pulls: 0, canceled: false };
  const body = new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(new Uint8Array([123, 125]));
    },
    cancel() {
      state.canceled = true;
    }
  }, { highWaterMark: 0 });
  const harness = createHarness();
  const request = apiRequest(`/api/playback/${KNOWN_CAMERA.id}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half"
  });

  const { json } = await readApiResponse(
    await harness.api(request, harness.env),
    400
  );

  assert.deepEqual(json, { error: "Invalid request" });
  assert.equal(state.pulls, 0);
  assert.equal(state.canceled, true);
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("invalid UTF-8 is rejected before coordinator access", async () => {
  const harness = createHarness();
  const tracked = streamingRequest(
    `/api/playback/${KNOWN_CAMERA.id}/refresh`,
    [new Uint8Array([0xc3, 0x28])],
    { contentLength: "2" }
  );

  const { json } = await readApiResponse(
    await harness.api(tracked.request, harness.env),
    400
  );

  assert.deepEqual(json, { error: "Invalid request" });
  assert.equal(tracked.state.bytesDelivered, 2);
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("encoded refresh IDs return 404 without reading the request body", async () => {
  const harness = createHarness();
  const tracked = streamingRequest(
    "/api/playback/%70raia-de-carcavelos/refresh",
    [new Uint8Array(100_000).fill(97)]
  );

  const { json } = await readApiResponse(
    await harness.api(tracked.request, harness.env),
    404
  );

  assert.deepEqual(json, { error: "Not found" });
  assert.equal(tracked.state.bytesDelivered, 0);
  assert.equal(tracked.state.pulls, 0);
  assert.deepEqual(harness.calls.coordinatorNames, []);
});

test("refresh rejects every JSON shape except one nonblank failedRevision string", async (t) => {
  const invalidBodies = [
    ["invalid JSON", "{"],
    ["empty object", {}],
    ["extra key", { failedRevision: "revision-1", token: "must-not-be-accepted" }],
    ["array", [{ failedRevision: "revision-1" }]],
    ["null", null],
    ["empty revision", { failedRevision: "" }],
    ["blank revision", { failedRevision: "  \n\t" }],
    ["numeric revision", { failedRevision: 1 }]
  ];

  for (const [name, body] of invalidBodies) {
    await t.test(name, async () => {
      const harness = createHarness();
      const { json } = await readApiResponse(
        await harness.api(
          jsonRequest(`/api/playback/${KNOWN_CAMERA.id}/refresh`, body),
          harness.env
        ),
        400
      );
      assert.deepEqual(json, { error: "Invalid request" });
      assert.deepEqual(harness.calls.coordinatorNames, []);
    });
  }
});

test("exact routes reject wrong methods and trailing paths with bounded JSON", async (t) => {
  const cases = [
    ["POST", `/api/playback/${KNOWN_CAMERA.id}`, 405, { error: "Method not allowed" }],
    ["PUT", `/api/playback/${KNOWN_CAMERA.id}`, 405, { error: "Method not allowed" }],
    ["GET", `/api/playback/${KNOWN_CAMERA.id}/refresh`, 405, { error: "Method not allowed" }],
    ["DELETE", `/api/playback/${KNOWN_CAMERA.id}/refresh`, 405, { error: "Method not allowed" }],
    ["GET", `/api/playback/${KNOWN_CAMERA.id}/refresh/`, 404, { error: "Not found" }],
    ["GET", "/api", 404, { error: "Not found" }],
    ["GET", "/api/unknown", 404, { error: "Not found" }]
  ];

  for (const [method, path, status, body] of cases) {
    await t.test(`${method} ${path}`, async () => {
      const harness = createHarness();
      const { json } = await readApiResponse(
        await harness.api(apiRequest(path, { method }), harness.env),
        status
      );
      assert.deepEqual(json, body);
      assert.deepEqual(harness.calls.coordinatorNames, []);
    });
  }
});

test("GET and refresh dispose nonprimitive RPC results when response construction fails", async (t) => {
  for (const operation of ["GET", "refresh"]) {
    await t.test(operation, async () => {
      const tracked = disposableRecord({ token: "sensitive-record-token" });
      const harness = createHarness({
        getToken: async () => tracked.record,
        refreshToken: async () => tracked.record,
        signUrl() {
          throw new Error("sensitive signer detail");
        }
      });
      const path = operation === "GET"
        ? `/api/playback/${KNOWN_CAMERA.id}`
        : `/api/playback/${KNOWN_CAMERA.id}/refresh`;
      const request = operation === "GET"
        ? apiRequest(path)
        : jsonRequest(path, { failedRevision: "revision-1" });

      const { text, json } = await readApiResponse(
        await harness.api(request, harness.env),
        503
      );

      assert.deepEqual(json, { error: "Playback unavailable" });
      assert.equal(tracked.state.disposeCalls, 1);
      assert.equal(text.includes("sensitive-record-token"), false);
      assert.equal(text.includes("sensitive signer detail"), false);
    });
  }
});

test("disposer failures cannot override successful or sanitized API responses", async (t) => {
  for (const signFails of [false, true]) {
    await t.test(signFails ? "sign failure" : "success", async () => {
      const tracked = disposableRecord({}, {
        disposeError: new Error("private disposer detail")
      });
      const harness = createHarness({
        getToken: async () => tracked.record,
        signUrl: signFails
          ? () => { throw new Error("private signer detail"); }
          : (streamUrl, token) => `${streamUrl}?wmsAuthSign=${token}`
      });

      const { text, json } = await readApiResponse(
        await harness.api(
          apiRequest(`/api/playback/${KNOWN_CAMERA.id}`),
          harness.env
        ),
        signFails ? 503 : 200
      );

      assert.equal(tracked.state.disposeCalls, 1);
      assert.equal(text.includes("private disposer detail"), false);
      assert.equal(text.includes("private signer detail"), false);
      if (signFails) assert.deepEqual(json, { error: "Playback unavailable" });
      else assert.equal(json.cameraId, KNOWN_CAMERA.id);
    });
  }
});

test("coordinator failures return one sanitized 503 without provider or request secrets", async () => {
  const providerSecret = "provider-body-secret-token";
  const querySecret = "request-query-secret";
  const harness = createHarness({
    async getToken() {
      throw new Error(`${providerSecret} https://upstream.invalid/?token=secret`);
    }
  });

  const response = await harness.api(
    apiRequest(`/api/playback/${KNOWN_CAMERA.id}?debug=${querySecret}`),
    harness.env
  );
  const { text, json } = await readApiResponse(response, 503);

  assert.deepEqual(json, { error: "Playback unavailable" });
  for (const secret of [providerSecret, querySecret, "upstream.invalid", "token=secret", KNOWN_CAMERA.streamUrl]) {
    assert.equal(text.includes(secret), false);
  }
  assert.deepEqual(harness.calls.signUrl, []);
});
