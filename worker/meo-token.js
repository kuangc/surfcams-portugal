export const MEO_BROKER_TTL_MS = 72_000_000;
export const MEO_TOKEN_ENDPOINTS = Object.freeze([
  "https://beachcam.meo.pt/api/video-token",
  "https://beachcam.meo.pt/api/livecam/access"
]);

const MAX_TOKEN_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 5000;
const MEO_PLAYLIST_PATH = /^\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class MeoTokenUnavailableError extends Error {
  constructor() {
    super("MEO token unavailable");
    this.name = "MeoTokenUnavailableError";
  }
}

function unavailable() {
  return new MeoTokenUnavailableError();
}

export function validateMeoToken(body) {
  if (typeof body !== "string") throw unavailable();
  const token = body.trim();
  if (token.length > MAX_TOKEN_BYTES) throw unavailable();
  const byteLength = textEncoder.encode(token).byteLength;
  if (
    byteLength < 1
    || byteLength > MAX_TOKEN_BYTES
    || /\p{Cc}/u.test(token)
  ) {
    throw unavailable();
  }
  return token;
}

async function cancelBody(body) {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // Endpoint failures are intentionally collapsed into one sanitized error.
  }
}

async function readBoundedBody(response) {
  if (!response.body) return "";

  let reader;
  try {
    reader = response.body.getReader({ mode: "byob" });
  } catch {
    await cancelBody(response.body);
    throw unavailable();
  }
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read(
        new Uint8Array(MAX_TOKEN_BYTES + 1 - byteLength)
      );
      const { done, value } = result;
      if (done) break;
      if (!(value instanceof Uint8Array)) throw unavailable();
      byteLength += value.byteLength;
      if (byteLength > MAX_TOKEN_BYTES) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The final public error remains generic even when cancellation fails.
    }
    throw unavailable();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return textDecoder.decode(body);
  } catch {
    throw unavailable();
  }
}

async function tokenFromEndpoint(fetcher, endpoint, timeoutMs) {
  const response = await fetcher(endpoint, {
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)
  });
  if (!response?.ok) {
    await cancelBody(response?.body);
    throw unavailable();
  }

  const contentType = response.headers?.get("content-type") ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "text/plain") {
    await cancelBody(response.body);
    throw unavailable();
  }

  const declaredLength = response.headers.get("content-length");
  if (/^\d+$/.test(declaredLength ?? "") && Number(declaredLength) > MAX_TOKEN_BYTES) {
    await cancelBody(response.body);
    throw unavailable();
  }

  return validateMeoToken(await readBoundedBody(response));
}

export async function fetchMeoToken({
  fetcher = globalThis.fetch,
  endpoints = MEO_TOKEN_ENDPOINTS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  for (const endpoint of endpoints) {
    try {
      return await tokenFromEndpoint(fetcher, endpoint, timeoutMs);
    } catch {
      // Try the next fixed endpoint without exposing upstream failure details.
    }
  }
  throw unavailable();
}

function parseMeoPlaylistUrl(streamUrl) {
  if (
    typeof streamUrl !== "string"
    || !streamUrl
    || streamUrl !== streamUrl.trim()
  ) {
    throw unavailable();
  }
  try {
    const url = new URL(streamUrl);
    if (
      url.protocol !== "https:"
      || url.hostname !== "video-auth1.iol.pt"
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || !MEO_PLAYLIST_PATH.test(url.pathname)
    ) {
      throw unavailable();
    }
    return url;
  } catch {
    throw unavailable();
  }
}

export function signMeoPlaylistUrl(streamUrl, tokenBody) {
  const token = validateMeoToken(tokenBody);
  const signedUrl = new URL(parseMeoPlaylistUrl(streamUrl));
  signedUrl.searchParams.set("wmsAuthSign", token);
  return signedUrl.toString();
}
