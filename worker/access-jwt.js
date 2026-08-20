import {
  createRemoteJWKSet,
  jwtVerify
} from "jose";

const remoteKeySets = new Map();

export class AccessDeniedError extends Error {
  constructor() {
    super("Access denied");
    this.name = "AccessDeniedError";
  }
}

function accessOrigin(value) {
  const url = new URL(String(value || ""));
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || !host.endsWith(".cloudflareaccess.com")
    || host === "cloudflareaccess.com"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) throw new AccessDeniedError();
  return "https://" + host;
}

function remoteKeySet(origin) {
  if (!remoteKeySets.has(origin)) {
    remoteKeySets.set(
      origin,
      createRemoteJWKSet(new URL(origin + "/cdn-cgi/access/certs"))
    );
  }
  return remoteKeySets.get(origin);
}

export async function requireAccessJwt(request, env, { keySet } = {}) {
  try {
    const issuer = accessOrigin(env?.ACCESS_TEAM_DOMAIN);
    const audience = String(env?.ACCESS_AUD || "").trim();
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (
      !audience
      || audience.length > 512
      || !assertion
      || assertion.length > 16_384
    ) {
      throw new AccessDeniedError();
    }
    const verified = await jwtVerify(
      assertion,
      keySet || remoteKeySet(issuer),
      { issuer, audience }
    );
    if (
      !Number.isFinite(verified.payload.exp)
      || (verified.payload.exp * 1000) <= Date.now()
    ) throw new AccessDeniedError();
    return verified.payload;
  } catch {
    throw new AccessDeniedError();
  }
}
