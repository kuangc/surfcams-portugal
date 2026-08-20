const DEFAULT_BASE_PATH = "/api/playback";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_REVISION_BYTES = 256;
const MEO_PLAYLIST_PATH = /^\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

class InternalPlaybackError extends Error {}

export class PlaybackBrokerError extends Error {
  constructor() {
    super("Playback unavailable");
    this.name = "PlaybackBrokerError";
  }
}

function internalError() {
  return new InternalPlaybackError();
}

function unavailable() {
  return new PlaybackBrokerError();
}

function cancelSafely(cancelable) {
  if (!cancelable || typeof cancelable.cancel !== "function") return;
  try {
    Promise.resolve(cancelable.cancel()).catch(() => {});
  } catch {
    // Cancellation details are private and never replace the public error.
  }
}

function validCameraId(cameraId) {
  return Boolean(
    typeof cameraId === "string"
    && cameraId.trim()
    && !/\p{Cc}/u.test(cameraId)
  );
}

function validRevision(revision) {
  if (
    typeof revision !== "string"
    || !revision.trim()
    || revision.length > MAX_REVISION_BYTES
    || /\p{Cc}/u.test(revision)
  ) {
    return false;
  }
  return textEncoder.encode(revision).byteLength <= MAX_REVISION_BYTES;
}

function validPlaylistUrl(playlistUrl) {
  if (
    typeof playlistUrl !== "string"
    || !playlistUrl
    || playlistUrl !== playlistUrl.trim()
    || /\p{Cc}/u.test(playlistUrl)
    || !playlistUrl.startsWith("https://video-auth1.iol.pt/")
  ) {
    return false;
  }

  try {
    const url = new URL(playlistUrl);
    if (
      url.href !== playlistUrl
      || url.protocol !== "https:"
      || url.hostname !== "video-auth1.iol.pt"
      || url.username
      || url.password
      || url.port
      || url.hash
      || !MEO_PLAYLIST_PATH.test(url.pathname)
    ) {
      return false;
    }
    const entries = [...url.searchParams.entries()];
    if (
      entries.length !== 1
      || entries[0][0] !== "wmsAuthSign"
      || !entries[0][1]
      || /\p{Cc}/u.test(entries[0][1])
    ) {
      return false;
    }
    return url.search === `?${url.searchParams.toString()}`;
  } catch {
    return false;
  }
}

function exactPlaybackShape(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === 4
    && keys[0] === "cameraId"
    && keys[1] === "playlistUrl"
    && keys[2] === "refreshAt"
    && keys[3] === "revision";
}

function validatePlaybackRecord(value, requestedCameraId, timestamp) {
  if (
    !exactPlaybackShape(value)
    || value.cameraId !== requestedCameraId
    || !validPlaylistUrl(value.playlistUrl)
    || !validRevision(value.revision)
    || typeof value.refreshAt !== "string"
    || !Number.isFinite(timestamp)
  ) {
    throw internalError();
  }
  const expiresAt = Date.parse(value.refreshAt);
  if (
    !Number.isFinite(expiresAt)
    || expiresAt <= timestamp
    || new Date(expiresAt).toISOString() !== value.refreshAt
  ) {
    throw internalError();
  }
  return Object.freeze({
    cameraId: value.cameraId,
    playlistUrl: value.playlistUrl,
    revision: value.revision,
    refreshAt: value.refreshAt,
    expiresAt
  });
}

function cloneRecord(record) {
  return {
    cameraId: record.cameraId,
    playlistUrl: record.playlistUrl,
    revision: record.revision,
    refreshAt: record.refreshAt
  };
}

async function readBoundedJson(response, setCancelable) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") throw internalError();

  const declaredLength = response.headers?.get?.("content-length");
  if (
    /^\d+$/.test(declaredLength ?? "")
    && Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    cancelSafely(body);
    throw internalError();
  }

  let reader;
  let byob = false;
  try {
    reader = body.getReader({ mode: "byob" });
    byob = true;
  } catch {
    try {
      reader = body.getReader();
    } catch {
      cancelSafely(body);
      throw internalError();
    }
  }
  setCancelable(reader);

  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = byob
        ? await reader.read(new Uint8Array(MAX_RESPONSE_BYTES + 1 - byteLength))
        : await reader.read();
      if (!result || typeof result !== "object") throw internalError();
      const { done, value } = result;
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        throw internalError();
      }
      if (value.byteLength > MAX_RESPONSE_BYTES - byteLength) {
        cancelSafely(reader);
        throw internalError();
      }
      byteLength += value.byteLength;
      chunks.push(value.slice());
    }
  } catch {
    cancelSafely(reader);
    throw internalError();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw internalError();
  }
}

export function createPlaybackBrokerClient({
  fetcher = globalThis.fetch,
  now = () => Date.now(),
  basePath = DEFAULT_BASE_PATH,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  const cache = new Map();
  const resolveInFlight = new Map();
  const refreshInFlight = new Map();
  let refreshEpoch = 0n;
  const timeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
    ? requestTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

  function currentTime() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw internalError();
    return timestamp;
  }

  async function requestJson(path, init) {
    if (typeof fetcher !== "function") throw internalError();
    const controller = new AbortController();
    let cancelable = null;
    let rejectTimeout;
    const timeout = new Promise((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timerId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // Abort details remain private.
      }
      cancelSafely(cancelable);
      rejectTimeout(internalError());
    }, timeoutMs);

    const operation = (async () => {
      let response;
      try {
        response = await fetcher(path, {
          ...init,
          signal: controller.signal
        });
      } catch {
        throw internalError();
      }
      if (controller.signal.aborted) {
        cancelSafely(response?.body);
        throw internalError();
      }
      if (!response || response.ok !== true) {
        cancelSafely(response?.body);
        throw internalError();
      }
      cancelable = response.body;
      return readBoundedJson(response, (nextCancelable) => {
        cancelable = nextCancelable;
      });
    })();

    try {
      return await Promise.race([operation, timeout]);
    } catch {
      throw internalError();
    } finally {
      clearTimeout(timerId);
    }
  }

  function requestOptions(method, body) {
    const headers = method === "GET"
      ? { Accept: "application/json" }
      : {
          Accept: "application/json",
          "Content-Type": "application/json"
        };
    const options = {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers
    };
    if (body !== undefined) options.body = body;
    return options;
  }

  async function networkGet(cameraId, epoch) {
    let encodedCameraId;
    try {
      encodedCameraId = encodeURIComponent(cameraId);
    } catch {
      throw internalError();
    }
    const value = await requestJson(
      `${basePath}/${encodedCameraId}`,
      requestOptions("GET")
    );
    return {
      epoch,
      record: validatePlaybackRecord(value, cameraId, currentTime())
    };
  }

  async function waitForActiveRefreshes() {
    while (refreshInFlight.size > 0) {
      const barriers = [...refreshInFlight.values()]
        .map((entry) => entry.barrier);
      await Promise.allSettled(barriers);
    }
  }

  async function networkGetAfterRefreshPreflight(cameraId) {
    while (true) {
      if (refreshInFlight.size > 0) {
        await waitForActiveRefreshes();
        continue;
      }
      const epoch = refreshEpoch;
      return networkGet(cameraId, epoch);
    }
  }

  function cacheRecord(record) {
    cache.set(record.cameraId, record);
    return record;
  }

  function isCurrentGet(result) {
    return result.epoch === refreshEpoch && refreshInFlight.size === 0;
  }

  async function resolveFromNetwork(cameraId) {
    const first = await networkGetAfterRefreshPreflight(cameraId);
    if (isCurrentGet(first)) return cacheRecord(first.record);

    const second = await networkGetAfterRefreshPreflight(cameraId);
    if (!isCurrentGet(second)) throw internalError();
    return cacheRecord(second.record);
  }

  function startResolve(cameraId, { useCache }) {
    if (useCache) {
      const cached = cache.get(cameraId);
      if (cached && currentTime() < cached.expiresAt) return Promise.resolve(cached);
      if (cached) cache.delete(cameraId);
    }

    const existing = resolveInFlight.get(cameraId);
    if (existing) return existing;

    let operation;
    operation = (async () => {
      await Promise.resolve();
      try {
        return await resolveFromNetwork(cameraId);
      } finally {
        if (resolveInFlight.get(cameraId) === operation) {
          resolveInFlight.delete(cameraId);
        }
      }
    })();
    resolveInFlight.set(cameraId, operation);
    return operation;
  }

  function evictRevision(failedRevision) {
    for (const [cameraId, record] of cache) {
      if (record.revision === failedRevision) cache.delete(cameraId);
    }
  }

  async function networkRefresh(cameraId, failedRevision) {
    let encodedCameraId;
    try {
      encodedCameraId = encodeURIComponent(cameraId);
    } catch {
      throw internalError();
    }
    const value = await requestJson(
      `${basePath}/${encodedCameraId}/refresh`,
      requestOptions("POST", JSON.stringify({ failedRevision }))
    );
    const record = validatePlaybackRecord(value, cameraId, currentTime());
    if (record.revision === failedRevision) throw internalError();
    return record;
  }

  function createRefreshEntry(cameraId, failedRevision) {
    refreshEpoch += 1n;
    const epoch = refreshEpoch;
    const entry = { cameraId, epoch, barrier: null };
    let barrier;
    barrier = (async () => {
      await Promise.resolve();
      try {
        return await networkRefresh(cameraId, failedRevision);
      } finally {
        if (refreshInFlight.get(failedRevision)?.barrier === barrier) {
          refreshInFlight.delete(failedRevision);
        }
      }
    })();
    entry.barrier = barrier;
    refreshInFlight.set(failedRevision, entry);
    return entry;
  }

  async function settleRefresh(entry, cameraId, { sameCamera }) {
    const record = await entry.barrier;
    if (sameCamera && entry.epoch === refreshEpoch) {
      return cacheRecord(record);
    }
    await waitForActiveRefreshes();
    return startResolve(cameraId, { useCache: false });
  }

  function resolveInternal(cameraId) {
    if (!validCameraId(cameraId)) throw internalError();
    return startResolve(cameraId, { useCache: true });
  }

  function refreshInternal(cameraId, failedRevision) {
    if (!validCameraId(cameraId) || !validRevision(failedRevision)) {
      throw internalError();
    }
    evictRevision(failedRevision);
    const existing = refreshInFlight.get(failedRevision);
    const entry = existing ?? createRefreshEntry(cameraId, failedRevision);
    return settleRefresh(entry, cameraId, {
      sameCamera: entry.cameraId === cameraId
    });
  }

  function publicOperation(createOperation) {
    let operation;
    try {
      operation = createOperation();
    } catch {
      return Promise.reject(unavailable());
    }
    return Promise.resolve(operation).then(
      (record) => cloneRecord(record),
      () => { throw unavailable(); }
    );
  }

  return {
    resolve(cameraId) {
      return publicOperation(() => resolveInternal(cameraId));
    },
    refresh(cameraId, failedRevision) {
      return publicOperation(() => refreshInternal(cameraId, failedRevision));
    }
  };
}
