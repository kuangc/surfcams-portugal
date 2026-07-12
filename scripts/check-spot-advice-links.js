#!/usr/bin/env node

import dns from "node:dns/promises";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const HEAD_FALLBACK_STATUSES = new Set([403, 405, 501]);
const AUDIT_USER_AGENT = "undici";

class BlockedTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedTargetError";
    this.blocked = true;
  }
}

class AttemptTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`${method} timed out after ${timeoutMs} ms`);
    this.name = "AttemptTimeoutError";
    this.timedOut = true;
  }
}

class RedirectAuditError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "RedirectAuditError";
    this.redirectFailure = true;
    this.status = status;
  }
}

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function ipv4Number(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return octets.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv4InCidr(address, base, prefix) {
  const value = ipv4Number(address);
  const baseValue = ipv4Number(base);
  if (value === null || baseValue === null) return false;
  const shift = 32n - BigInt(prefix);
  return (value >> shift) === (baseValue >> shift);
}

const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

function ipv6Number(address) {
  let normalized = address.toLowerCase().split("%")[0];
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    const value = ipv4Number(ipv4);
    if (value === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(value >> 16n).toString(16)}:${(value & 0xffffn).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6InCidr(address, base, prefix) {
  const value = ipv6Number(address);
  const baseValue = ipv6Number(base);
  if (value === null || baseValue === null) return false;
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (baseValue >> shift);
}

const BLOCKED_IPV6_CIDRS = [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
];

function isPublicAddress(address) {
  const normalized = stripIpv6Brackets(String(address).toLowerCase());
  const family = net.isIP(normalized);
  if (family === 4) {
    return !BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(normalized, base, prefix));
  }
  if (family === 6) {
    if (!ipv6InCidr(normalized, "2000::", 3)) return false;
    return !BLOCKED_IPV6_CIDRS.some(([base, prefix]) => ipv6InCidr(normalized, base, prefix));
  }
  return false;
}

function parsedHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BlockedTargetError("URL is missing or invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new BlockedTargetError("URL is malformed");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedTargetError("Only HTTP(S) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new BlockedTargetError("URLs containing credentials are blocked");
  }
  if (parsed.port) {
    throw new BlockedTargetError("Non-default URL ports are blocked");
  }

  const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase());
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BlockedTargetError("Localhost targets are blocked");
  }
  const family = net.isIP(hostname);
  if (family && !isPublicAddress(hostname)) {
    throw new BlockedTargetError("Non-public IP targets are blocked");
  }
  parsed.hash = "";
  return parsed;
}

function canonicalAcceptedUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    const query = parsed.search ? "?[REDACTED]" : "";
    const fragment = parsed.hash ? "#[REDACTED]" : "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}${fragment}`;
  } catch {
    return "[invalid URL]";
  }
}

function normalizeResolvedAddresses(records) {
  const values = Array.isArray(records) ? records : [records];
  return values
    .map((record) => typeof record === "string" ? record : record?.address)
    .filter((address) => typeof address === "string" && address.length > 0);
}

async function defaultResolver(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function validateTarget(parsed, resolver) {
  const safe = parsedHttpUrl(parsed.href);
  const hostname = stripIpv6Brackets(safe.hostname.toLowerCase());
  if (net.isIP(hostname)) return { url: safe, addresses: [hostname] };

  let records;
  try {
    records = await resolver(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedTargetError("DNS resolution failed");
  }
  const addresses = normalizeResolvedAddresses(records);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new BlockedTargetError("DNS returned a non-public or invalid address");
  }
  return { url: safe, addresses: [...new Set(addresses)].sort() };
}

function responseHeaders(headers) {
  return {
    get(name) {
      const value = headers?.[String(name).toLowerCase()];
      if (Array.isArray(value)) return value.join(", ");
      return value ?? null;
    }
  };
}

export function createPinnedRequester({
  httpRequest = http.request,
  httpsRequest = https.request
} = {}) {
  return ({ url, address, method, signal }) => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const originalHostname = stripIpv6Brackets(parsed.hostname);
    const isHttps = parsed.protocol === "https:";
    const options = {
      protocol: parsed.protocol,
      hostname: address,
      family: net.isIP(address),
      port: parsed.port || (isHttps ? 443 : 80),
      method,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        Host: parsed.host,
        "User-Agent": AUDIT_USER_AGENT
      },
      signal,
      agent: false
    };
    if (isHttps && !net.isIP(originalHostname)) {
      options.servername = originalHostname;
      options.checkServerIdentity = (_hostname, certificate) => (
        tls.checkServerIdentity(originalHostname, certificate)
      );
    }

    const request = (isHttps ? httpsRequest : httpRequest)(options, (response) => {
      resolve({
        status: response.statusCode,
        headers: responseHeaders(response.headers),
        body: {
          cancel: async () => { response.destroy(); }
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function requesterFromFetcher(fetcher) {
  return ({ url, address, method, signal }) => fetcher(url, {
    method,
    redirect: "manual",
    signal,
    validatedAddress: address
  });
}

export function collectAcceptedUrls(document) {
  const urls = new Set();
  const add = (url) => {
    const canonical = canonicalAcceptedUrl(url);
    if (canonical) urls.add(canonical);
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

async function fetchHop(parsed, method, {
  requester,
  resolver,
  timeoutMs,
  onTimeout
}) {
  const controller = new AbortController();
  const timeoutError = new AttemptTimeoutError(method, timeoutMs);
  let timer;
  const operation = (async () => {
    const target = await validateTarget(parsed, resolver);
    let lastError;
    for (const address of target.addresses) {
      if (controller.signal.aborted) throw timeoutError;
      try {
        const response = await requester({
          url: target.url.href,
          address,
          method,
          signal: controller.signal
        });
        await closeResponseBody(response);
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No validated address was available");
  })();
  operation.catch(() => {});

  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function isRedirectStatus(status) {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

async function requestFollowingRedirects(startUrl, method, options) {
  let current = parsedHttpUrl(startUrl);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchHop(current, method, options);
    if (!isRedirectStatus(response?.status)) return response;

    if (redirectCount >= options.maxRedirects) {
      throw new RedirectAuditError(`Redirect limit of ${options.maxRedirects} exceeded`, response.status);
    }
    const location = response.headers?.get?.("location");
    if (typeof location !== "string" || location.trim() === "") {
      throw new RedirectAuditError("Redirect response is missing Location", response.status);
    }
    try {
      current = new URL(location, current);
    } catch {
      throw new RedirectAuditError("Redirect response has a malformed Location", response.status);
    }
  }
}

function isReachable(response) {
  return Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
}

function safeFailureMessage(error, method) {
  if (error instanceof AttemptTimeoutError || error instanceof BlockedTargetError || error instanceof RedirectAuditError) {
    return error.message;
  }
  return `${method} request failed`;
}

function failedResult(url, method, error, attempts, status = null) {
  const finalStatus = error?.status ?? status;
  return {
    url: redactUrl(url),
    ok: false,
    method,
    status: finalStatus,
    error: error instanceof RedirectAuditError
      ? error.message
      : finalStatus === null
        ? safeFailureMessage(error, method)
        : `${method} returned HTTP ${finalStatus}`,
    attempts,
    blocked: error instanceof BlockedTargetError,
    timedOut: error instanceof AttemptTimeoutError
  };
}

async function auditUrl(url, options) {
  const attempts = [];
  try {
    const head = await requestFollowingRedirects(url, "HEAD", options);
    attempts.push({ method: "HEAD", status: head.status });
    if (isReachable(head)) {
      return {
        url: redactUrl(url),
        ok: true,
        method: "HEAD",
        status: head.status,
        error: null,
        attempts,
        blocked: false,
        timedOut: false
      };
    }
    if (!HEAD_FALLBACK_STATUSES.has(head.status)) {
      return failedResult(url, "HEAD", new Error(`HEAD returned HTTP ${head.status}`), attempts, head.status);
    }
  } catch (error) {
    const message = safeFailureMessage(error, "HEAD");
    attempts.push({ method: "HEAD", status: error?.status ?? null, error: message });
    if (error instanceof AttemptTimeoutError || error instanceof BlockedTargetError || error instanceof RedirectAuditError) {
      return failedResult(url, "HEAD", error, attempts);
    }
  }

  try {
    const get = await requestFollowingRedirects(url, "GET", options);
    attempts.push({ method: "GET", status: get.status });
    if (isReachable(get)) {
      return {
        url: redactUrl(url),
        ok: true,
        method: "GET",
        status: get.status,
        error: null,
        attempts,
        blocked: false,
        timedOut: false
      };
    }
    return failedResult(url, "GET", new Error(`GET returned HTTP ${get.status}`), attempts, get.status);
  } catch (error) {
    const message = safeFailureMessage(error, "GET");
    attempts.push({ method: "GET", status: error?.status ?? null, error: message });
    return failedResult(url, "GET", error, attempts);
  }
}

function statusLine(result) {
  if (result.ok) return `OK ${result.method} ${result.status} ${result.url}`;
  if (result.notAttempted) return `FAIL ${result.url} NOT_ATTEMPTED: ${result.error}`;
  const status = result.status === null ? "ERROR" : `HTTP ${result.status}`;
  return `FAIL ${result.url} ${result.method} ${status}: ${result.error}`;
}

export async function auditUrls(urls, {
  fetcher,
  requester,
  resolver = defaultResolver,
  concurrency = 4,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  logger = console.log
} = {}) {
  if (fetcher !== undefined && typeof fetcher !== "function") {
    throw new TypeError("fetcher must be a function");
  }
  if (requester !== undefined && typeof requester !== "function") {
    throw new TypeError("requester must be a function");
  }
  const effectiveRequester = requester
    ?? (fetcher ? requesterFromFetcher(fetcher) : createPinnedRequester());
  if (typeof resolver !== "function") throw new TypeError("auditUrls requires a DNS resolver");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("maxRedirects must be a non-negative integer");
  }

  const uniqueUrls = [...new Set(urls)].sort();
  const results = new Array(uniqueUrls.length);
  let nextIndex = 0;
  let circuitOpen = false;
  const openCircuit = () => { circuitOpen = true; };

  async function worker() {
    while (!circuitOpen) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= uniqueUrls.length) return;
      results[index] = await auditUrl(uniqueUrls[index], {
        requester: effectiveRequester,
        resolver,
        timeoutMs,
        maxRedirects,
        onTimeout: openCircuit
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, () => worker())
  );
  for (let index = 0; index < results.length; index += 1) {
    if (results[index]) continue;
    results[index] = {
      url: redactUrl(uniqueUrls[index]),
      ok: false,
      method: null,
      status: null,
      error: "Not attempted after another URL timed out",
      attempts: [],
      blocked: false,
      timedOut: false,
      notAttempted: true
    };
  }
  for (const result of results) logger(statusLine(result));
  return results;
}

export async function runCli({
  readFile = fs.readFile,
  fetcher,
  requester,
  resolver = defaultResolver,
  logger = console.log
} = {}) {
  const document = JSON.parse(await readFile("data/spot-advice.json", "utf8"));
  const urls = collectAcceptedUrls(document);
  logger(`Auditing ${urls.length} accepted spot-advice source URLs (manual, non-CI check)`);
  const results = await auditUrls(urls, { fetcher, requester, resolver, logger });
  const failures = results.filter((result) => !result.ok);
  logger(`${results.length - failures.length}/${results.length} source URLs reachable`);
  return failures.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`Spot advice link audit failed: ${safeFailureMessage(error, "audit")}`);
      process.exitCode = 1;
    });
}
