import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseHlsUris,
  probeSignedStreams,
  publicProbeResult,
  resolveHlsUri
} from "../scripts/probe-meo-signed-streams.js";

const PROBE_ORIGIN = "https://surfcams-portugal.invalid";
const FIXTURE_TOKEN = "fixture-token-value";
const HLS_HEADERS = {
  "access-control-allow-origin": "*",
  "content-type": "application/vnd.apple.mpegurl; charset=utf-8"
};

function camera(id, namespace = "auth-beachcam") {
  return {
    id,
    name: `Camera ${id}`,
    location: "Fixture beach",
    region: "Fixture region",
    lat: 38.7,
    lon: -9.4,
    hasStream: true,
    streamUrl: `https://video-auth1.iol.pt/${namespace}/${id}/playlist.m3u8`
  };
}

function cameraDb(...cameras) {
  return { cameras };
}

function hlsResponse(body, init = {}) {
  const headers = new Headers(HLS_HEADERS);
  for (const [key, value] of Object.entries(init.headers || {})) {
    headers.set(key, value);
  }
  return new Response(body, { ...init, headers });
}

function segmentResponse(body = new Uint8Array([0x47, 0x40, 0x00, 0x10]), init = {}) {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "content-type": "video/mp2t"
  });
  for (const [key, value] of Object.entries(init.headers || {})) {
    headers.set(key, value);
  }
  return new Response(body, { status: 206, ...init, headers });
}

function trackedResponse(chunks, init = {}) {
  const state = { canceled: false, pulls: 0 };
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
      );
    },
    cancel() {
      state.canceled = true;
    }
  }, { highWaterMark: 0 });
  const headers = new Headers(init.headers || HLS_HEADERS);
  return {
    response: new Response(body, { status: init.status || 200, headers }),
    state
  };
}

function stalledCancelResponse({ headers: headerOverrides = {}, status = 200 } = {}) {
  const state = { canceled: false };
  const body = new ReadableStream({
    cancel() {
      state.canceled = true;
      return new Promise(() => {});
    }
  }, { highWaterMark: 0 });
  const headers = new Headers(HLS_HEADERS);
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return {
    response: new Response(body, { headers, status }),
    state
  };
}

function requestHeader(options, name) {
  return new Headers(options.headers).get(name);
}

function safeResultKeys(result) {
  return Object.keys(result).sort();
}

test("Access docs scope optional OTP to a separate exact-email policy", () => {
  const runbook = readFileSync(
    new URL("../docs/runbooks/cloudflare-access.md", import.meta.url),
    "utf8"
  );
  const securityPolicy = readFileSync(
    new URL("../SECURITY.md", import.meta.url),
    "utf8"
  );
  const normalizedRunbook = runbook.replace(/\s+/gu, " ");
  const normalizedSecurityPolicy = securityPolicy.replace(/\s+/gu, " ");
  const contracts = [
    [
      "runbook should keep a primary Google allow policy",
      normalizedRunbook.includes("primary Google `Allow` policy")
    ],
    [
      "OTP fallback should use a separate allow policy",
      normalizedRunbook.includes("Create a separate `Allow` policy named `OTP fallback — <person>`")
    ],
    [
      "OTP fallback Include should contain only one exact email",
      normalizedRunbook.includes("Under **Include**, add only that one person's exact email address.")
    ],
    [
      "OTP fallback Require should select One-time PIN",
      normalizedRunbook.includes("Under **Require**, set **Login Methods** to **One-time PIN**.")
    ],
    [
      "Google policy should precede the narrowly scoped OTP fallback",
      normalizedRunbook.includes(
        "Place the primary Google policy first and the OTP fallback policy immediately after it."
      )
    ],
    [
      "runbook should forbid using One-time PIN as an Include selector",
      normalizedRunbook.includes("Never put **One-time PIN** under **Include**")
    ],
    [
      "revocation should remove the email from every allow policy",
      normalizedRunbook.includes("every `Allow` policy")
    ],
    [
      "security policy should describe every allow policy as exact-email-only",
      normalizedSecurityPolicy.includes("Every `Allow` policy")
    ]
  ];

  for (const [description, satisfied] of contracts) {
    assert.equal(satisfied, true, description);
  }
  assert.equal(
    normalizedRunbook.includes("Keep the same exact email in the existing allow policy."),
    false,
    "OTP fallback should not inherit the Google-only login-method requirement"
  );
});

test("parseHlsUris returns only trimmed non-comment HLS URI lines", () => {
  const manifest = [
    "#EXTM3U",
    "",
    "  #EXT-X-STREAM-INF:BANDWIDTH=1200000  ",
    "  child/playlist.m3u8?wmsAuthSign=fixture  ",
    "\tsegment-1.ts?nimblesessionid=fixture\t",
    "#EXT-X-ENDLIST"
  ].join("\r\n");

  const uris = parseHlsUris(manifest);
  assert.equal(uris.length, 2);
  assert.equal(
    uris[0] === "child/playlist.m3u8?wmsAuthSign=fixture",
    true,
    "first non-comment URI should round-trip without exposing it in diagnostics"
  );
  assert.equal(
    uris[1] === "segment-1.ts?nimblesessionid=fixture",
    true,
    "second non-comment URI should round-trip without exposing it in diagnostics"
  );
  assert.deepEqual(parseHlsUris("\n  \n#EXTM3U\n"), []);
});

test("resolveHlsUri preserves authorization queries on canonical relative MEO URIs", () => {
  const master = "https://video-auth1.iol.pt/auth-beachcam/fixture/playlist.m3u8?wmsAuthSign=master-fixture";
  const child = resolveHlsUri(
    master,
    "levels/child.m3u8?wmsAuthSign=child-fixture&nimblesessionid=child-session"
  );
  const segment = resolveHlsUri(
    child,
    "../media/segment.ts?nimblesessionid=segment-session"
  );

  assert.equal(
    child === "https://video-auth1.iol.pt/auth-beachcam/fixture/levels/child.m3u8?wmsAuthSign=child-fixture&nimblesessionid=child-session",
    true,
    "relative child URI should preserve its authorization query"
  );
  assert.equal(
    segment === "https://video-auth1.iol.pt/auth-beachcam/fixture/media/segment.ts?nimblesessionid=segment-session",
    true,
    "relative segment URI should preserve its authorization query"
  );
});

test("resolveHlsUri rejects provider-controlled URLs outside the exact MEO HTTPS origin", () => {
  const parent = "https://video-auth1.iol.pt/beachcam/fixture/playlist.m3u8?wmsAuthSign=fixture";
  const invalidReferences = [
    "https://evil.invalid/beachcam/fixture/child.m3u8?nimblesessionid=x",
    "http://video-auth1.iol.pt/beachcam/fixture/child.m3u8?nimblesessionid=x",
    "https://user:password@video-auth1.iol.pt/beachcam/fixture/child.m3u8?nimblesessionid=x",
    "https://video-auth1.iol.pt:444/beachcam/fixture/child.m3u8?nimblesessionid=x",
    "https://video-auth1.iol.pt.evil.invalid/beachcam/fixture/child.m3u8?nimblesessionid=x",
    "child.m3u8?nimblesessionid=x#fragment",
    "../../outside/child.m3u8?nimblesessionid=x",
    " child.m3u8?nimblesessionid=x "
  ];

  for (const reference of invalidReferences) {
    assert.throws(
      () => resolveHlsUri(parent, reference),
      (error) => {
        assert.equal(
          error.message === "Invalid MEO HLS URI",
          true,
          "URI rejection should use the fixed redacted error"
        );
        assert.equal(
          error.cause === undefined,
          true,
          "URI rejection should not retain an upstream cause"
        );
        return true;
      }
    );
  }
});

test("publicProbeResult returns only the redacted public acceptance fields", () => {
  const publicResult = publicProbeResult({
    cameraId: "fixture-camera",
    phase: "child",
    status: 200,
    durationMs: 12.8,
    authorizationOk: 1,
    corsOk: true,
    url: "https://video-auth1.iol.pt/private.m3u8?wmsAuthSign=private",
    token: "private-token",
    headers: { authorization: "private" },
    body: "private-response-body",
    error: new Error("private-upstream-error")
  });

  assert.equal(
    JSON.stringify(safeResultKeys(publicResult))
      === JSON.stringify(["authorizationOk", "cameraId", "corsOk", "durationMs", "phase", "status"]),
    true,
    "public result should expose only the fixed redacted field allowlist"
  );
  assert.equal(publicResult.cameraId, "fixture-camera");
  assert.equal(publicResult.phase, "child");
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.durationMs, 13);
  assert.equal(publicResult.authorizationOk, true);
  assert.equal(publicResult.corsOk, true);
  const serialized = JSON.stringify(publicResult);
  for (const forbidden of [
    "private-token",
    "private-response-body",
    "private-upstream-error",
    "wmsAuthSign",
    "https://",
    "?"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("probeSignedStreams probes every master at concurrency three and both representative chains", async () => {
  const cameras = [
    camera("auth-a"),
    camera("auth-b"),
    camera("auth-c"),
    camera("auth-d"),
    camera("public-a", "beachcam")
  ];
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let tokenCalls = 0;
  const fetcher = async (url, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    calls.push({ url, options });

    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/levels/child.m3u8")) {
      return hlsResponse([
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:4",
        "../media/segment.ts?nimblesessionid=segment-session"
      ].join("\n"), {
        headers: { "access-control-allow-origin": PROBE_ORIGIN }
      });
    }
    if (parsed.pathname.endsWith("/media/segment.ts")) {
      return segmentResponse();
    }
    if (parsed.pathname.endsWith("/playlist.m3u8")) {
      return hlsResponse([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=1200000",
        "levels/child.m3u8?wmsAuthSign=child-fixture&nimblesessionid=child-session"
      ].join("\n"));
    }
    throw new Error("unexpected fixture request");
  };

  const report = await probeSignedStreams({
    cameraDb: cameraDb(...cameras),
    fetcher,
    fetchToken: async () => {
      tokenCalls += 1;
      return FIXTURE_TOKEN;
    },
    timeoutMs: 100
  });

  assert.equal(report.ok, true);
  assert.equal(report.cameraCount, cameras.length);
  assert.equal(report.results.length, cameras.length + 4);
  assert.equal(tokenCalls, 1);
  assert.equal(maxActive, 3);
  assert.equal(report.results.every((result) => result.authorizationOk), true);
  assert.equal(report.results.every((result) => result.corsOk), true);
  assert.equal(report.results.filter((result) => result.phase === "master").length, cameras.length);
  assert.deepEqual(
    report.results
      .filter((result) => result.phase !== "master")
      .map((result) => [result.cameraId, result.phase, result.status]),
    [
      ["auth-a", "child", 200],
      ["auth-a", "segment", 206],
      ["public-a", "child", 200],
      ["public-a", "segment", 206]
    ]
  );

  for (const { url, options } of calls) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol === "https:", true, "probe request should use HTTPS");
    assert.equal(
      parsed.hostname === "video-auth1.iol.pt",
      true,
      "probe request should use only the fixed MEO host"
    );
    assert.equal(parsed.username === "", true, "probe URL should omit credentials");
    assert.equal(parsed.password === "", true, "probe URL should omit credentials");
    assert.equal(parsed.port === "", true, "probe URL should omit nondefault ports");
    assert.equal(parsed.hash === "", true, "probe URL should omit fragments");
    assert.equal(options.redirect === "error", true, "probe should reject redirects");
    assert.equal(options.credentials === "omit", true, "probe should omit credentials");
    assert.equal(
      requestHeader(options, "origin") === PROBE_ORIGIN,
      true,
      "probe should send the fixed public test origin"
    );
    assert.equal(options.signal instanceof AbortSignal, true);
    const isSegment = parsed.pathname.endsWith(".ts");
    assert.equal(
      requestHeader(options, "range") === (isSegment ? "bytes=0-1023" : null),
      true,
      "only segment requests should carry the fixed bounded range"
    );
  }

  const serialized = JSON.stringify(report);
  for (const forbidden of [
    FIXTURE_TOKEN,
    "wmsAuthSign",
    "nimblesessionid",
    "https://",
    "#EXTM3U",
    "request headers",
    "response body",
    "unexpected fixture request"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(
    JSON.stringify(Object.keys(report).sort()) === JSON.stringify(["cameraCount", "ok", "results"]),
    true,
    "aggregate report should expose only fixed redacted fields"
  );
  assert.equal(report.results.every((result) => (
    JSON.stringify(safeResultKeys(result))
    === JSON.stringify(["authorizationOk", "cameraId", "corsOk", "durationMs", "phase", "status"])
  )), true);
});

test("probeSignedStreams contains timeout and upstream failure to one camera", async () => {
  const requestedCameraIds = new Set();
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    const cameraId = parsed.pathname.split("/")[2];
    requestedCameraIds.add(cameraId);
    if (cameraId === "auth-timeout") {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("private-timeout-detail")),
          { once: true }
        );
      });
    }
    if (parsed.pathname.endsWith("/child.m3u8")) {
      return hlsResponse("#EXTM3U\nsegment.ts?nimblesessionid=session");
    }
    if (parsed.pathname.endsWith("/segment.ts")) return segmentResponse();
    return hlsResponse("#EXTM3U\nchild.m3u8?nimblesessionid=session");
  };

  const report = await probeSignedStreams({
    cameraDb: cameraDb(
      camera("auth-timeout"),
      camera("public-works", "beachcam")
    ),
    fetcher,
    fetchToken: async () => FIXTURE_TOKEN,
    timeoutMs: 10
  });

  assert.equal(report.ok, false);
  assert.equal(requestedCameraIds.has("auth-timeout"), true);
  assert.equal(requestedCameraIds.has("public-works"), true);
  const timedOut = report.results.find((result) => result.cameraId === "auth-timeout");
  assert.equal(timedOut.cameraId, "auth-timeout");
  assert.equal(timedOut.phase, "master");
  assert.equal(timedOut.status, 0);
  assert.equal(timedOut.durationMs >= 0, true);
  assert.equal(timedOut.durationMs < 250, true);
  assert.equal(timedOut.authorizationOk, true);
  assert.equal(timedOut.corsOk, false);
  assert.equal(
    report.results.some((result) => (
      result.cameraId === "public-works"
      && result.phase === "segment"
      && result.status === 206
    )),
    true
  );
  assert.equal(JSON.stringify(report).includes("private-timeout-detail"), false);
});

test("probeSignedStreams rejects a malicious cross-origin child without requesting it", async () => {
  let evilRequests = 0;
  const fetcher = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "video-auth1.iol.pt") evilRequests += 1;
    return hlsResponse([
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1200000",
      "https://evil.invalid/private/child.m3u8?nimblesessionid=private"
    ].join("\n"));
  };

  const report = await probeSignedStreams({
    cameraDb: cameraDb(camera("auth-cross-origin")),
    fetcher,
    fetchToken: async () => FIXTURE_TOKEN
  });

  assert.equal(report.ok, false);
  assert.equal(evilRequests, 0);
  assert.deepEqual(
    report.results.map(({ phase, status }) => [phase, status]),
    [["master", 200], ["child", 0]]
  );
  assert.equal(JSON.stringify(report).includes("evil.invalid"), false);
});

test("probeSignedStreams sets redirect error mode and rejects returned redirects with body cancellation", async () => {
  const tracked = trackedResponse(["private redirect body"], {
    status: 302,
    headers: {
      location: "https://evil.invalid/private.m3u8?token=private",
      "content-type": "text/plain"
    }
  });
  let redirectMode;
  const report = await probeSignedStreams({
    cameraDb: cameraDb(camera("auth-redirect")),
    fetchToken: async () => FIXTURE_TOKEN,
    fetcher: async (_url, options) => {
      redirectMode = options.redirect;
      return tracked.response;
    }
  });

  assert.equal(redirectMode === "error", true, "probe should reject redirects");
  assert.equal(tracked.state.canceled, true);
  assert.equal(report.ok, false);
  assert.equal(report.results[0].status, 302);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("evil.invalid"), false);
  assert.equal(serialized.includes("private redirect body"), false);
});

test("probeSignedStreams bounds streamed manifest reads and cancels an oversized body", async () => {
  const chunk = new Uint8Array(16 * 1024).fill(65);
  const tracked = trackedResponse(Array.from({ length: 80 }, () => chunk));
  const report = await probeSignedStreams({
    cameraDb: cameraDb(camera("auth-oversized-manifest")),
    fetchToken: async () => FIXTURE_TOKEN,
    fetcher: async () => tracked.response
  });

  assert.equal(report.ok, false);
  assert.equal(tracked.state.canceled, true);
  assert.equal(tracked.state.pulls < 80, true);
  assert.equal(report.results[0].status, 200);
  assert.equal(JSON.stringify(report).includes("AAAA"), false);
});

test("probeSignedStreams times out and cancels a stalled manifest body", async () => {
  const state = { canceled: false };
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      state.canceled = true;
    }
  }, { highWaterMark: 0 });
  const response = new Response(body, { headers: HLS_HEADERS });
  let watchdogId;
  const watchdog = new Promise((_, reject) => {
    watchdogId = setTimeout(
      () => reject(new Error("probe did not bound the manifest body read")),
      100
    );
  });

  const report = await Promise.race([
    probeSignedStreams({
      cameraDb: cameraDb(camera("auth-stalled-manifest")),
      fetchToken: async () => FIXTURE_TOKEN,
      fetcher: async () => response,
      timeoutMs: 10
    }),
    watchdog
  ]).finally(() => clearTimeout(watchdogId));

  assert.equal(report.ok, false);
  assert.equal(state.canceled, true);
  assert.equal(report.results[0].status, 200);
  assert.equal(report.results[0].durationMs < 250, true);
});

test("probeSignedStreams never waits indefinitely for rejected-response cancellation", async () => {
  const cases = [
    stalledCancelResponse({ status: 503 }),
    stalledCancelResponse({ headers: { "content-type": "text/plain" } }),
    stalledCancelResponse({ headers: { "access-control-allow-origin": null } }),
    stalledCancelResponse({ headers: { "content-length": String(256 * 1024 + 1) } })
  ];
  let watchdogId;
  const watchdog = new Promise((_, reject) => {
    watchdogId = setTimeout(
      () => reject(new Error("probe waited for rejected-response cancellation")),
      150
    );
  });

  const reports = await Promise.race([
    Promise.all(cases.map(({ response }, index) => probeSignedStreams({
      cameraDb: cameraDb(camera(`auth-stalled-cancel-${index}`)),
      fetchToken: async () => FIXTURE_TOKEN,
      fetcher: async () => response,
      timeoutMs: 10
    }))),
    watchdog
  ]).finally(() => clearTimeout(watchdogId));

  assert.equal(reports.every((report) => !report.ok), true);
  assert.equal(cases.every(({ state }) => state.canceled), true);
});

test("probeSignedStreams bounds the ranged segment body and cancels excess bytes", async () => {
  const segment = trackedResponse([
    new Uint8Array(1024).fill(0x47),
    new Uint8Array([0x47])
  ], {
    status: 206,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "video/mp2t"
    }
  });
  const fetcher = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/segment.ts")) return segment.response;
    if (parsed.pathname.endsWith("/child.m3u8")) {
      return hlsResponse("#EXTM3U\nsegment.ts?nimblesessionid=session");
    }
    return hlsResponse("#EXTM3U\nchild.m3u8?nimblesessionid=session");
  };

  const report = await probeSignedStreams({
    cameraDb: cameraDb(camera("auth-large-segment")),
    fetchToken: async () => FIXTURE_TOKEN,
    fetcher
  });

  assert.equal(report.ok, false);
  assert.equal(segment.state.canceled, true);
  assert.deepEqual(
    report.results.map(({ phase, status }) => [phase, status]),
    [["master", 200], ["child", 200], ["segment", 206]]
  );
});

test("probeSignedStreams rejects arbitrary octet-stream bytes as a segment", async () => {
  const fetcher = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/segment.ts")) {
      return segmentResponse(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" }
      });
    }
    if (parsed.pathname.endsWith("/child.m3u8")) {
      return hlsResponse("#EXTM3U\nsegment.ts?nimblesessionid=session");
    }
    return hlsResponse("#EXTM3U\nchild.m3u8?nimblesessionid=session");
  };

  const report = await probeSignedStreams({
    cameraDb: cameraDb(camera("auth-generic-binary")),
    fetchToken: async () => FIXTURE_TOKEN,
    fetcher
  });

  assert.equal(report.ok, false);
  const segment = report.results.find((result) => result.phase === "segment");
  assert.equal(segment.status, 206);
  assert.equal(segment.authorizationOk, true);
  assert.equal(segment.corsOk, true);
});

test("probeSignedStreams treats missing CORS and invalid playlist content as camera-local failures", async () => {
  const report = await probeSignedStreams({
    cameraDb: cameraDb(
      camera("auth-no-cors"),
      camera("public-bad-hls", "beachcam"),
      camera("public-good", "beachcam")
    ),
    fetchToken: async () => FIXTURE_TOKEN,
    fetcher: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("auth-no-cors")) {
        return hlsResponse("#EXTM3U\nchild.m3u8?nimblesessionid=x", {
          headers: { "access-control-allow-origin": "" }
        });
      }
      if (parsed.pathname.includes("public-bad-hls")) {
        return hlsResponse("not an HLS manifest");
      }
      if (parsed.pathname.endsWith("/child.m3u8")) {
        return hlsResponse("#EXTM3U\nsegment.ts?nimblesessionid=x");
      }
      if (parsed.pathname.endsWith("/segment.ts")) return segmentResponse();
      return hlsResponse("#EXTM3U\nchild.m3u8?nimblesessionid=x");
    }
  });

  assert.equal(report.ok, false);
  const noCors = report.results.find((result) => result.cameraId === "auth-no-cors");
  const badHls = report.results.find((result) => result.cameraId === "public-bad-hls");
  const good = report.results.find((result) => result.cameraId === "public-good");
  assert.equal(noCors.status, 200);
  assert.equal(noCors.corsOk, false);
  assert.equal(badHls.status, 200);
  assert.equal(badHls.corsOk, true);
  assert.equal(good.status, 200);
});
