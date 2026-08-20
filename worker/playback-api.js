import { signMeoPlaylistUrl } from "./meo-token.js";
import { findPlaybackCamera } from "./playback-catalog.js";

const MAX_REQUEST_BODY_BYTES = 1024;
const jsonDecoder = new TextDecoder("utf-8", { fatal: true });
const API_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff"
});

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

function apiJson(body, status) {
  return Response.json(body, {
    status,
    headers: API_HEADERS
  });
}

function notFound() {
  return apiJson({ error: "Not found" }, 404);
}

function methodNotAllowed() {
  return apiJson({ error: "Method not allowed" }, 405);
}

function invalidRequest() {
  return apiJson({ error: "Invalid request" }, 400);
}

function parsePlaybackRoute(request) {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/playback\/([^/]+)(\/refresh)?$/.exec(path);
  if (!match || match[1].includes("%")) return null;
  return {
    cameraId: match[1],
    operation: match[2] ? "refresh" : "get"
  };
}

async function cancelBody(body) {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // Request failures are intentionally collapsed into bounded JSON errors.
  }
}

async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // Cancellation failure must not replace the bounded public response.
  }
}

async function readBoundedJson(request) {
  const body = request.body;
  if (!body) throw new InvalidRequestBodyError();

  let reader;
  try {
    reader = body.getReader({ mode: "byob" });
  } catch {
    await cancelBody(body);
    throw new InvalidRequestBodyError();
  }

  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(
        new Uint8Array(MAX_REQUEST_BODY_BYTES + 1 - byteLength)
      );
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        throw new InvalidRequestBodyError();
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        await cancelReader(reader);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    await cancelReader(reader);
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new InvalidRequestBodyError();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = jsonDecoder.decode(bytes);
  } catch {
    throw new InvalidRequestBodyError();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidRequestBodyError();
  }
}

function validRefreshBody(body) {
  if (
    body === null
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.getPrototypeOf(body) !== Object.prototype
  ) {
    return false;
  }
  const keys = Object.keys(body);
  return Boolean(
    keys.length === 1
    && keys[0] === "failedRevision"
    && typeof body.failedRevision === "string"
    && body.failedRevision.trim()
  );
}

function disposeRpcRecord(record) {
  if (
    record === null
    || (typeof record !== "object" && typeof record !== "function")
  ) return;
  try {
    const dispose = record[Symbol.dispose];
    if (typeof dispose === "function") dispose.call(record);
  } catch {
    // Disposer diagnostics can contain RPC detail and are never public.
  }
}

async function playbackResponse({ camera, coordinator, operation, failedRevision, signUrl }) {
  let record;
  try {
    record = operation === "get"
      ? await coordinator.getToken()
      : await coordinator.refreshToken(failedRevision);
    if (
      record === null
      || (typeof record !== "object" && typeof record !== "function")
    ) {
      throw new Error("Invalid coordinator record");
    }
    const token = record.token;
    const revision = record.revision;
    const refreshAt = record.refreshAt;
    if (
      typeof token !== "string"
      || typeof revision !== "string"
      || !revision.trim()
      || !Number.isFinite(refreshAt)
    ) {
      throw new Error("Invalid coordinator record");
    }
    const playlistUrl = signUrl(camera.streamUrl, token);
    if (typeof playlistUrl !== "string") {
      throw new Error("Invalid signed URL");
    }
    return apiJson({
      cameraId: camera.id,
      playlistUrl,
      revision,
      refreshAt: new Date(refreshAt).toISOString()
    }, 200);
  } finally {
    disposeRpcRecord(record);
  }
}

export function createPlaybackApi({
  findCamera = findPlaybackCamera,
  signUrl = signMeoPlaylistUrl
} = {}) {
  return async function playbackApi(request, env) {
    let route;
    try {
      route = parsePlaybackRoute(request);
    } catch {
      return notFound();
    }
    if (!route) return notFound();

    let camera;
    try {
      camera = findCamera(route.cameraId);
    } catch {
      return apiJson({ error: "Playback unavailable" }, 503);
    }
    if (
      !camera
      || camera.id !== route.cameraId
      || typeof camera.streamUrl !== "string"
      || !camera.streamUrl
    ) {
      return notFound();
    }

    if (route.operation === "get" && request.method !== "GET") {
      return methodNotAllowed();
    }
    if (route.operation === "refresh" && request.method !== "POST") {
      return methodNotAllowed();
    }

    let failedRevision;
    if (route.operation === "refresh") {
      if (request.headers.get("content-type") !== "application/json") {
        return apiJson({ error: "Unsupported media type" }, 415);
      }
      const declaredLength = request.headers.get("content-length");
      if (
        /^\d+$/.test(declaredLength ?? "")
        && Number(declaredLength) > MAX_REQUEST_BODY_BYTES
      ) {
        await cancelBody(request.body);
        return apiJson({ error: "Request body too large" }, 413);
      }

      let body;
      try {
        body = await readBoundedJson(request);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return apiJson({ error: "Request body too large" }, 413);
        }
        return invalidRequest();
      }
      if (!validRefreshBody(body)) return invalidRequest();
      failedRevision = body.failedRevision;
    }

    try {
      const coordinator = env.MEO_TOKEN_COORDINATOR.getByName("global");
      return await playbackResponse({
        camera,
        coordinator,
        operation: route.operation,
        failedRevision,
        signUrl
      });
    } catch {
      return apiJson({ error: "Playback unavailable" }, 503);
    }
  };
}

export const handlePlaybackApi = createPlaybackApi();
