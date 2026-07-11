import assert from "node:assert/strict";
import test from "node:test";

import {
  auditUrls,
  collectAcceptedUrls,
  runCli
} from "../scripts/check-spot-advice-links.js";

function response(status, { redirected = false, cancel } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected,
    headers: { get: () => null },
    body: cancel ? { cancel } : null
  };
}

function redirectResponse(status, location, { cancel } = {}) {
  return {
    ...response(status, { cancel }),
    headers: { get: (name) => name.toLowerCase() === "location" ? location : null }
  };
}

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function safeOptions(options = {}) {
  return { resolver: publicResolver, ...options };
}

test("collectAcceptedUrls returns sorted unique accepted HTTP evidence from published claims and research", () => {
  const document = {
    advice: [
      {
        publicationStatus: "published",
        evidence: [
          { status: "accepted", url: "https://z.example/guide" },
          { status: "accepted", url: null, kind: "user-observed" },
          { status: "accepted", url: "http://a.example/spot" },
          { status: "rejected", url: "https://rejected.example/claim" },
          { status: "accepted", url: "javascript:alert(1)" }
        ]
      },
      {
        publicationStatus: "draft",
        evidence: [{ status: "accepted", url: "https://draft.example/claim" }]
      }
    ],
    spotResearch: [
      {
        checkedSources: [
          { decision: "accepted", url: "https://z.example/guide" },
          { decision: "accepted", url: "https://m.example/research" },
          { decision: "rejected", url: "https://rejected.example/research" },
          { decision: "accepted", url: "ftp://unsafe.example/research" },
          { decision: "accepted", url: "https://user:secret@example.com/private?token=hidden" },
          { decision: "accepted", url: "https://EXAMPLE.com:443/a/../guide" },
          { decision: "accepted", url: "http://127.1/internal" }
        ]
      }
    ]
  };

  assert.deepEqual(collectAcceptedUrls(document), [
    "http://a.example/spot",
    "https://example.com/guide",
    "https://m.example/research",
    "https://z.example/guide"
  ]);
});

test("auditUrls deduplicates URLs, falls back from unsupported HEAD, and emits one result and line per URL", async () => {
  const calls = [];
  const lines = [];
  const result = await auditUrls(
    ["https://b.example", "https://a.example", "https://b.example"],
    safeOptions({
      concurrency: 2,
      logger: (line) => lines.push(line),
      fetcher: async (url, options) => {
        calls.push([url, options.method]);
        if (url === "https://a.example/" && options.method === "HEAD") return response(405);
        return response(options.method === "GET" ? 204 : 200);
      }
    })
  );

  assert.deepEqual(calls, [
    ["https://a.example/", "HEAD"],
    ["https://b.example/", "HEAD"],
    ["https://a.example/", "GET"]
  ]);
  assert.deepEqual(result.map(({ url, ok, method, status }) => ({ url, ok, method, status })), [
    { url: "https://a.example/", ok: true, method: "GET", status: 204 },
    { url: "https://b.example/", ok: true, method: "HEAD", status: 200 }
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^OK GET 204 https:\/\/a\.example\/$/);
  assert.match(lines[1], /^OK HEAD 200 https:\/\/b\.example\/$/);
});

test("auditUrls rejects an unresolved redirect and cancels its response body", async () => {
  let cancelCount = 0;
  const results = await auditUrls(["https://redirect.example"], safeOptions({
    logger: () => {},
    fetcher: async () => response(302, {
      redirected: true,
      cancel: async () => { cancelCount += 1; }
    })
  }));

  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 302);
  assert.equal(cancelCount, 1);
});

test("auditUrls enforces bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const release = [];
  const fetcher = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => release.push(resolve));
    active -= 1;
    return response(200);
  };

  const pending = auditUrls(
    ["https://a.example", "https://b.example", "https://c.example", "https://d.example"],
    safeOptions({ fetcher, concurrency: 2, logger: () => {} })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximumActive, 2);
  release.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));
  release.splice(0).forEach((resolve) => resolve());
  await pending;
  assert.equal(maximumActive, 2);
});

test("auditUrls aborts timed-out attempts and reports the URL failure", async () => {
  let observedAbort = false;
  const lines = [];
  const results = await auditUrls(["https://slow.example"], safeOptions({
    timeoutMs: 10,
    logger: (line) => lines.push(line),
    fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    })
  }));

  assert.equal(observedAbort, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /timed out after 10 ms/i);
  assert.match(lines[0], /^FAIL https:\/\/slow\.example\/ /);
});

test("auditUrls contains thrown fetch errors to their URL and keeps auditing", async () => {
  const results = await auditUrls(["https://bad.example", "https://good.example"], safeOptions({
    concurrency: 1,
    logger: () => {},
    fetcher: async (url) => {
      if (url === "https://bad.example/") throw new Error("DNS lookup failed with token=hidden");
      return response(200);
    }
  }));

  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ url, ok }) => ({ url, ok })), [
    { url: "https://bad.example/", ok: false },
    { url: "https://good.example/", ok: true }
  ]);
  assert.equal(results[0].error, "GET request failed");
  assert.doesNotMatch(JSON.stringify(results[0]), /token=hidden/);
});

test("runCli returns a nonzero exit code when any accepted source is unreachable", async () => {
  const document = {
    advice: [{
      publicationStatus: "published",
      evidence: [{ status: "accepted", url: "https://gone.example/source" }]
    }],
    spotResearch: []
  };
  const lines = [];
  const exitCode = await runCli({
    readFile: async () => JSON.stringify(document),
    resolver: publicResolver,
    fetcher: async () => response(404),
    logger: (line) => lines.push(line)
  });

  assert.equal(exitCode, 1);
  assert.match(lines.at(-1), /^0\/1 source URLs reachable$/);
});

test("auditUrls blocks lexical SSRF targets, alternate IP encodings, credentials, and unsafe ports before fetch", async () => {
  const unsafeUrls = [
    "http://user:secret@public.example/path?token=hidden",
    "http://localhost/admin",
    "http://service.localhost/admin",
    "http://127.1/admin",
    "http://2130706433/admin",
    "http://0x7f000001/admin",
    "http://169.254.169.254/latest/meta-data?credential=hidden",
    "http://10.0.0.1/admin",
    "http://100.64.0.1/admin",
    "http://192.0.2.1/admin",
    "http://224.0.0.1/admin",
    "http://[::]/admin",
    "http://[::1]/admin",
    "http://[fe80::1]/admin",
    "http://[fc00::1]/admin",
    "http://[ff00::1]/admin",
    "http://[2001:db8::1]/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "https://public.example:22/admin"
  ];
  let fetchCalls = 0;
  const lines = [];
  const results = await auditUrls(unsafeUrls, safeOptions({
    logger: (line) => lines.push(line),
    fetcher: async () => {
      fetchCalls += 1;
      return response(200);
    }
  }));

  assert.equal(fetchCalls, 0);
  assert.equal(results.length, unsafeUrls.length);
  assert.ok(results.every((result) => !result.ok && result.blocked));
  assert.doesNotMatch(lines.join("\n"), /secret|token=hidden|credential=hidden/);
});

test("auditUrls blocks DNS names unless every resolved address is public", async () => {
  let fetchCalls = 0;
  const results = await auditUrls([
    "https://mixed.example/source",
    "https://private.example/source"
  ], {
    logger: () => {},
    resolver: async (hostname) => hostname === "mixed.example"
      ? [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.8", family: 4 }]
      : [{ address: "fc00::8", family: 6 }],
    fetcher: async () => {
      fetchCalls += 1;
      return response(200);
    }
  });

  assert.equal(fetchCalls, 0);
  assert.ok(results.every((result) => !result.ok && result.blocked));
});

test("auditUrls follows only validated manual redirects and requires a final 2xx", async () => {
  const calls = [];
  const resolved = [];
  let cancelCount = 0;
  const results = await auditUrls(["https://public.example/start?key=hidden"], {
    logger: () => {},
    resolver: async (hostname) => {
      resolved.push(hostname);
      return publicResolver();
    },
    fetcher: async (url, options) => {
      calls.push([url, options.method, options.redirect]);
      if (url.includes("/start")) {
        return redirectResponse(302, "/second", { cancel: async () => { cancelCount += 1; } });
      }
      if (url.includes("/second")) {
        return redirectResponse(307, "https://other.example/final", { cancel: async () => { cancelCount += 1; } });
      }
      return response(204, { cancel: async () => { cancelCount += 1; } });
    }
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].status, 204);
  assert.equal(results[0].url, "https://public.example/start?[REDACTED]");
  assert.deepEqual(calls, [
    ["https://public.example/start?key=hidden", "HEAD", "manual"],
    ["https://public.example/second", "HEAD", "manual"],
    ["https://other.example/final", "HEAD", "manual"]
  ]);
  assert.deepEqual(resolved, ["public.example", "public.example", "other.example"]);
  assert.equal(cancelCount, 3);
});

test("auditUrls blocks public-to-private redirects without fetching the destination", async () => {
  const calls = [];
  const lines = [];
  const results = await auditUrls(["https://public.example/start?key=hidden"], safeOptions({
    logger: (line) => lines.push(line),
    fetcher: async (url) => {
      calls.push(url);
      return redirectResponse(302, "http://169.254.169.254/latest?credential=hidden");
    }
  }));

  assert.deepEqual(calls, ["https://public.example/start?key=hidden"]);
  assert.equal(results[0].blocked, true);
  assert.doesNotMatch(lines[0], /key=hidden|credential=hidden/);
});

test("auditUrls rejects redirects with missing or malformed Location", async () => {
  const results = await auditUrls([
    "https://missing.example/start",
    "https://malformed.example/start"
  ], safeOptions({
    logger: () => {},
    fetcher: async (url) => url.includes("missing")
      ? redirectResponse(302, null)
      : redirectResponse(302, "http://[::1")
  }));

  assert.equal(results.length, 2);
  assert.ok(results.every((result) => !result.ok));
  assert.match(results[0].error, /Location/i);
  assert.match(results[1].error, /Location/i);
});

test("auditUrls waits for HEAD body cleanup before starting GET fallback", async () => {
  let releaseCleanup;
  const calls = [];
  const pending = auditUrls(["https://cleanup.example/source"], safeOptions({
    timeoutMs: 1_000,
    logger: () => {},
    fetcher: async (_url, { method }) => {
      calls.push(method);
      if (method === "HEAD") {
        return response(405, {
          cancel: () => new Promise((resolve) => { releaseCleanup = resolve; })
        });
      }
      return response(200);
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["HEAD"]);
  releaseCleanup();
  const results = await pending;
  assert.equal(results[0].ok, true);
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("auditUrls treats stalled cleanup as a timeout and never starts GET fallback", async () => {
  const calls = [];
  const results = await auditUrls(["https://cleanup.example/source"], safeOptions({
    timeoutMs: 10,
    logger: () => {},
    fetcher: async (_url, { method }) => {
      calls.push(method);
      return response(405, { cancel: async () => new Promise(() => {}) });
    }
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ["HEAD"]);
  assert.equal(results[0].timedOut, true);
});

test("auditUrls stops launching work after abort-ignoring timeouts without exceeding concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const results = await auditUrls([
    "https://a.example",
    "https://b.example",
    "https://c.example",
    "https://d.example"
  ], safeOptions({
    concurrency: 2,
    timeoutMs: 10,
    logger: () => {},
    fetcher: async (url) => {
      calls.push(url);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Promise(() => {});
    }
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(maximumActive, 2);
  assert.equal(calls.length, 2);
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => !result.ok));
  assert.equal(results.filter((result) => result.notAttempted).length, 2);
});

test("a timeout circuit prevents another in-flight HEAD from starting GET fallback", async () => {
  const calls = [];
  const results = await auditUrls([
    "https://a-stalled.example",
    "https://b-delayed.example"
  ], safeOptions({
    concurrency: 2,
    timeoutMs: 30,
    logger: () => {},
    fetcher: async (url, { method }) => {
      calls.push([url, method]);
      if (url.includes("a-stalled")) return new Promise(() => {});
      await new Promise((resolve) => setTimeout(resolve, 40));
      return response(405);
    }
  }));

  assert.equal(results[0].timedOut, true);
  assert.equal(results[1].ok, false);
  assert.deepEqual(calls, [
    ["https://a-stalled.example/", "HEAD"],
    ["https://b-delayed.example/", "HEAD"]
  ]);
});
