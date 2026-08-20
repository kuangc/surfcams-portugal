#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveMeoPlaybackCameras } from "../src/feed-policy.js";
import { fetchMeoToken, signMeoPlaylistUrl } from "../worker/meo-token.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAMERA_DB_PATH = path.join(ROOT, "data", "beachcam-cameras.json");
const MEO_HLS_HOST = "video-auth1.iol.pt";
const PROBE_ORIGIN = "https://surfcams-portugal.invalid";
const PROBE_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SEGMENT_BYTES = 1024;
const MEO_HLS_PATH = /^\/(?:auth-)?beachcam\//i;
const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl"
]);
const SEGMENT_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "video/mpeg",
  "video/mp2t"
]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function invalidHlsUri() {
  return new Error("Invalid MEO HLS URI");
}

function parseCanonicalMeoUrl(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\r\n\0]/u.test(value)
  ) {
    throw invalidHlsUri();
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.hostname !== MEO_HLS_HOST
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || url.hash
      || !MEO_HLS_PATH.test(url.pathname)
    ) {
      throw invalidHlsUri();
    }
    return url;
  } catch {
    throw invalidHlsUri();
  }
}

export function parseHlsUris(manifestText) {
  if (typeof manifestText !== "string") return [];
  return manifestText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function resolveHlsUri(parentUrl, childReference) {
  const parent = parseCanonicalMeoUrl(parentUrl);
  if (
    typeof childReference !== "string"
    || !childReference
    || childReference !== childReference.trim()
    || childReference.length > 8192
    || /[\r\n\0]/u.test(childReference)
  ) {
    throw invalidHlsUri();
  }

  try {
    return parseCanonicalMeoUrl(new URL(childReference, parent).toString()).toString();
  } catch {
    throw invalidHlsUri();
  }
}

export function publicProbeResult(result) {
  const duration = Number(result?.durationMs);
  const status = Number(result?.status);
  return {
    cameraId: typeof result?.cameraId === "string" ? result.cameraId : "unknown",
    phase: typeof result?.phase === "string" ? result.phase : "unknown",
    status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
    durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0,
    authorizationOk: Boolean(result?.authorizationOk),
    corsOk: Boolean(result?.corsOk)
  };
}

async function cancelResponseBody(response) {
  if (!response?.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Probe failures are deliberately reduced to redacted status fields.
  }
}

async function readBoundedBody(response, maximumBytes, signal) {
  const declaredLength = response.headers?.get("content-length");
  if (/^\d+$/u.test(declaredLength || "") && Number(declaredLength) > maximumBytes) {
    await cancelResponseBody(response);
    throw new Error("Probe response rejected");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const cancelOnAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal?.aborted) {
    await reader.cancel();
    throw new Error("Probe response rejected");
  }
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || byteLength + value.byteLength > maximumBytes) {
        await reader.cancel();
        throw new Error("Probe response rejected");
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The public result never includes the body-reader error.
    }
    throw new Error("Probe response rejected");
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function contentType(response) {
  return (response.headers?.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function hasPermissiveCors(response) {
  const allowOrigin = response.headers?.get("access-control-allow-origin")?.trim();
  return allowOrigin === "*" || allowOrigin === PROBE_ORIGIN;
}

function hasAuthorizationQuery(url, phase) {
  try {
    const parsed = parseCanonicalMeoUrl(url);
    if (phase === "master") {
      return parsed.searchParams.getAll("wmsAuthSign").length === 1
        && Boolean(parsed.searchParams.get("wmsAuthSign"));
    }
    return ["wmsAuthSign", "nimblesessionid"].some((name) => (
      parsed.searchParams.getAll(name).length === 1
      && Boolean(parsed.searchParams.get(name))
    ));
  } catch {
    return false;
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, performance.now() - startedAt);
}

function failedPhase(cameraId, phase) {
  return {
    ok: false,
    result: publicProbeResult({
      cameraId,
      phase,
      status: 0,
      durationMs: 0,
      authorizationOk: false,
      corsOk: false
    })
  };
}

async function probeResource({ cameraId, fetcher, phase, timeoutMs, url }) {
  const startedAt = performance.now();
  let status = 0;
  let corsOk = false;
  const authorizationOk = hasAuthorizationQuery(url, phase);
  let timeoutId;

  try {
    const canonicalUrl = parseCanonicalMeoUrl(url).toString();
    const headers = new Headers({ Origin: PROBE_ORIGIN });
    if (phase === "segment") headers.set("Range", "bytes=0-1023");
    const controller = new AbortController();
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Probe request timed out"));
      }, timeoutMs);
    });
    let response;
    response = await Promise.race([
      fetcher(canonicalUrl, {
        cache: "no-store",
        credentials: "omit",
        headers,
        redirect: "error",
        signal: controller.signal
      }),
      timeout
    ]);
    status = Number.isInteger(response?.status) ? response.status : 0;
    corsOk = hasPermissiveCors(response);

    const expectedStatus = phase === "segment" ? 206 : 200;
    const expectedMime = phase === "segment" ? SEGMENT_CONTENT_TYPES : HLS_CONTENT_TYPES;
    if (
      status !== expectedStatus
      || !authorizationOk
      || !corsOk
      || !expectedMime.has(contentType(response))
    ) {
      await cancelResponseBody(response);
      return {
        ok: false,
        result: publicProbeResult({
          cameraId,
          phase,
          status,
          durationMs: elapsedMilliseconds(startedAt),
          authorizationOk,
          corsOk
        })
      };
    }

    const body = await Promise.race([
      readBoundedBody(
        response,
        phase === "segment" ? MAX_SEGMENT_BYTES : MAX_MANIFEST_BYTES,
        controller.signal
      ),
      timeout
    ]);
    let manifestText;
    let contentOk = body.byteLength > 0;
    if (phase !== "segment") {
      manifestText = textDecoder.decode(body);
      contentOk = manifestText.trimStart().startsWith("#EXTM3U");
    }

    return {
      ok: contentOk,
      manifestText,
      result: publicProbeResult({
        cameraId,
        phase,
        status,
        durationMs: elapsedMilliseconds(startedAt),
        authorizationOk,
        corsOk
      })
    };
  } catch {
    return {
      ok: false,
      result: publicProbeResult({
        cameraId,
        phase,
        status,
        durationMs: elapsedMilliseconds(startedAt),
        authorizationOk,
        corsOk
      })
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function representativeCameraIds(cameras) {
  const sorted = [...cameras].sort((left, right) => left.id.localeCompare(right.id));
  const representatives = new Set();
  for (const namespace of ["/auth-beachcam/", "/beachcam/"]) {
    const camera = sorted.find(({ streamUrl }) => new URL(streamUrl).pathname.startsWith(namespace));
    if (camera) representatives.add(camera.id);
  }
  return representatives;
}

async function probeCamera({ camera, fetcher, representative, signUrl, timeoutMs, token }) {
  let masterUrl;
  try {
    masterUrl = signUrl(camera.streamUrl, token);
  } catch {
    return [failedPhase(camera.id, "master")];
  }

  const master = await probeResource({
    cameraId: camera.id,
    fetcher,
    phase: "master",
    timeoutMs,
    url: masterUrl
  });
  const phases = [master];
  if (!representative || !master.ok) return phases;

  const childReference = parseHlsUris(master.manifestText)[0];
  let childUrl;
  try {
    childUrl = resolveHlsUri(masterUrl, childReference);
  } catch {
    phases.push(failedPhase(camera.id, "child"));
    return phases;
  }
  const child = await probeResource({
    cameraId: camera.id,
    fetcher,
    phase: "child",
    timeoutMs,
    url: childUrl
  });
  phases.push(child);
  if (!child.ok) return phases;

  const segmentReference = parseHlsUris(child.manifestText)[0];
  let segmentUrl;
  try {
    segmentUrl = resolveHlsUri(childUrl, segmentReference);
  } catch {
    phases.push(failedPhase(camera.id, "segment"));
    return phases;
  }
  phases.push(await probeResource({
    cameraId: camera.id,
    fetcher,
    phase: "segment",
    timeoutMs,
    url: segmentUrl
  }));
  return phases;
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

export async function probeSignedStreams({
  cameraDb,
  fetcher = globalThis.fetch,
  fetchToken = fetchMeoToken,
  signUrl = signMeoPlaylistUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const cameras = resolveMeoPlaybackCameras(cameraDb);
  if (cameras.length === 0) {
    return { ok: false, cameraCount: 0, results: [] };
  }

  let token;
  try {
    token = await fetchToken({ fetcher, timeoutMs });
  } catch {
    return {
      ok: false,
      cameraCount: cameras.length,
      results: cameras.map((camera) => failedPhase(camera.id, "master").result)
    };
  }

  const representativeIds = representativeCameraIds(cameras);
  const cameraPhases = await mapWithConcurrency(
    cameras,
    PROBE_CONCURRENCY,
    (camera) => probeCamera({
      camera,
      fetcher,
      representative: representativeIds.has(camera.id),
      signUrl,
      timeoutMs,
      token
    })
  );
  token = undefined;

  const internalResults = cameraPhases.flat();
  return {
    ok: internalResults.every((phase) => phase.ok),
    cameraCount: cameras.length,
    results: internalResults.map((phase) => phase.result)
  };
}

async function run() {
  const cameraDb = JSON.parse(await fs.readFile(CAMERA_DB_PATH, "utf8"));
  const report = await probeSignedStreams({ cameraDb });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stderr.write("MEO signed-stream probe failed\n");
    process.exitCode = 1;
  });
}
