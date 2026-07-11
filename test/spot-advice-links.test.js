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
    body: cancel ? { cancel } : null
  };
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
          { decision: "accepted", url: "ftp://unsafe.example/research" }
        ]
      }
    ]
  };

  assert.deepEqual(collectAcceptedUrls(document), [
    "http://a.example/spot",
    "https://m.example/research",
    "https://z.example/guide"
  ]);
});

test("auditUrls deduplicates URLs, falls back from unsupported HEAD, and emits one result and line per URL", async () => {
  const calls = [];
  const lines = [];
  const result = await auditUrls(
    ["https://b.example", "https://a.example", "https://b.example"],
    {
      concurrency: 2,
      logger: (line) => lines.push(line),
      fetcher: async (url, options) => {
        calls.push([url, options.method]);
        if (url === "https://a.example" && options.method === "HEAD") return response(405);
        return response(options.method === "GET" ? 204 : 200);
      }
    }
  );

  assert.deepEqual(calls, [
    ["https://a.example", "HEAD"],
    ["https://b.example", "HEAD"],
    ["https://a.example", "GET"]
  ]);
  assert.deepEqual(result.map(({ url, ok, method, status }) => ({ url, ok, method, status })), [
    { url: "https://a.example", ok: true, method: "GET", status: 204 },
    { url: "https://b.example", ok: true, method: "HEAD", status: 200 }
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^OK GET 204 https:\/\/a\.example$/);
  assert.match(lines[1], /^OK HEAD 200 https:\/\/b\.example$/);
});

test("auditUrls treats redirects as reachable and cancels response bodies", async () => {
  let cancelCount = 0;
  const results = await auditUrls(["https://redirect.example"], {
    logger: () => {},
    fetcher: async () => response(302, {
      redirected: true,
      cancel: async () => { cancelCount += 1; }
    })
  });

  assert.equal(results[0].ok, true);
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
    { fetcher, concurrency: 2, logger: () => {} }
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
  const results = await auditUrls(["https://slow.example"], {
    timeoutMs: 10,
    logger: (line) => lines.push(line),
    fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    })
  });

  assert.equal(observedAbort, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /timed out after 10 ms/i);
  assert.match(lines[0], /^FAIL https:\/\/slow\.example /);
});

test("auditUrls contains thrown fetch errors to their URL and keeps auditing", async () => {
  const results = await auditUrls(["https://bad.example", "https://good.example"], {
    concurrency: 1,
    logger: () => {},
    fetcher: async (url) => {
      if (url === "https://bad.example") throw new Error("DNS lookup failed");
      return response(200);
    }
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ url, ok }) => ({ url, ok })), [
    { url: "https://bad.example", ok: false },
    { url: "https://good.example", ok: true }
  ]);
  assert.match(results[0].error, /DNS lookup failed/);
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
    fetcher: async () => response(404),
    logger: (line) => lines.push(line)
  });

  assert.equal(exitCode, 1);
  assert.match(lines.at(-1), /^0\/1 source URLs reachable$/);
});
