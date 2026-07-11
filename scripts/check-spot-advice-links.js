#!/usr/bin/env node

import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const HEAD_FALLBACK_STATUSES = new Set([403, 405, 501]);

function isSafeHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function collectAcceptedUrls(document) {
  const urls = new Set();
  const add = (url) => {
    if (isSafeHttpUrl(url)) urls.add(url.trim());
  };

  for (const claim of document?.advice ?? []) {
    if (claim?.publicationStatus !== "published") continue;
    for (const evidence of claim.evidence ?? []) {
      if (evidence?.status === "accepted") add(evidence.url);
    }
  }

  for (const research of document?.spotResearch ?? []) {
    for (const source of research?.checkedSources ?? []) {
      if (source?.decision === "accepted") add(source.url);
    }
  }

  return [...urls].sort();
}

async function closeResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Link health is determined by the response, not best-effort body cleanup.
  }
}

async function fetchWithTimeout(url, method, { fetcher, timeoutMs }) {
  const controller = new AbortController();
  const timeoutError = new Error(`${method} timed out after ${timeoutMs} ms`);
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetcher(url, {
        method,
        redirect: "follow",
        signal: controller.signal
      }),
      timeout
    ]);
    await closeResponseBody(response);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function isReachable(response) {
  return Number.isInteger(response?.status) && response.status >= 200 && response.status < 400;
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function auditUrl(url, options) {
  const attempts = [];
  let head;
  try {
    head = await fetchWithTimeout(url, "HEAD", options);
    attempts.push({ method: "HEAD", status: head.status });
    if (isReachable(head)) {
      return { url, ok: true, method: "HEAD", status: head.status, error: null, attempts };
    }
    if (!HEAD_FALLBACK_STATUSES.has(head.status)) {
      return {
        url,
        ok: false,
        method: "HEAD",
        status: head.status,
        error: `HEAD returned HTTP ${head.status}`,
        attempts
      };
    }
  } catch (error) {
    attempts.push({ method: "HEAD", status: null, error: errorMessage(error) });
  }

  try {
    const get = await fetchWithTimeout(url, "GET", options);
    attempts.push({ method: "GET", status: get.status });
    if (isReachable(get)) {
      return { url, ok: true, method: "GET", status: get.status, error: null, attempts };
    }
    return {
      url,
      ok: false,
      method: "GET",
      status: get.status,
      error: `GET returned HTTP ${get.status}`,
      attempts
    };
  } catch (error) {
    const message = errorMessage(error);
    attempts.push({ method: "GET", status: null, error: message });
    return { url, ok: false, method: "GET", status: null, error: message, attempts };
  }
}

function statusLine(result) {
  if (result.ok) return `OK ${result.method} ${result.status} ${result.url}`;
  const status = result.status === null ? "ERROR" : `HTTP ${result.status}`;
  return `FAIL ${result.url} ${result.method} ${status}: ${result.error}`;
}

export async function auditUrls(urls, {
  fetcher = globalThis.fetch,
  concurrency = 4,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console.log
} = {}) {
  if (typeof fetcher !== "function") throw new TypeError("auditUrls requires a fetcher");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }

  const uniqueUrls = [...new Set(urls)].sort();
  const results = new Array(uniqueUrls.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= uniqueUrls.length) return;
      results[index] = await auditUrl(uniqueUrls[index], { fetcher, timeoutMs });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, () => worker())
  );
  for (const result of results) logger(statusLine(result));
  return results;
}

export async function runCli({
  readFile = fs.readFile,
  fetcher = globalThis.fetch,
  logger = console.log
} = {}) {
  const document = JSON.parse(await readFile("data/spot-advice.json", "utf8"));
  const urls = collectAcceptedUrls(document);
  logger(`Auditing ${urls.length} accepted spot-advice source URLs (manual, non-CI check)`);
  const results = await auditUrls(urls, { fetcher, logger });
  const failures = results.filter((result) => !result.ok);
  logger(`${results.length - failures.length}/${results.length} source URLs reachable`);
  return failures.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`Spot advice link audit failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
