import { env, exports } from "cloudflare:workers";
import {
  SignJWT,
  exportJWK,
  generateKeyPair
} from "jose";
import { test, vi } from "vitest";

const issuer = "https://family.cloudflareaccess.com";
const audience = "surfcams-access-audience";
const jwksUrl = `${issuer}/cdn-cgi/access/certs`;
const primaryTokenUrl = "https://beachcam.meo.pt/api/video-token";
const fallbackTokenUrl = "https://beachcam.meo.pt/api/livecam/access";
const knownCameraId = "praia-de-carcavelos";
const knownStreamUrl = "https://video-auth1.iol.pt/auth-beachcam/carcavelos/playlist.m3u8";

// One issuer uses one RSA key/JWK for this suite so jose's remote-key cache
// never observes a different key for the same immutable issuer.
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = {
  ...await exportJWK(publicKey),
  alg: "RS256",
  kid: "workerd-routing-key",
  use: "sig"
};

async function accessAssertion(tokenAudience = audience) {
  return new SignJWT({ email: "approved@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setSubject("approved-family-member")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function request(path, assertion) {
  const headers = new Headers();
  if (assertion !== undefined) {
    headers.set("Cf-Access-Jwt-Assertion", assertion);
  }
  return new Request(`https://surfcams.example${path}`, { headers });
}

async function expectPrivateJson(response, status, body, expect) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.json()).toEqual(body);
}

test("real Worker authenticates API routes and uses only explicit local outbound fixtures", async ({ expect }) => {
  const outbound = [];
  const counts = new Map([
    [jwksUrl, 0],
    [primaryTokenUrl, 0],
    [fallbackTokenUrl, 0]
  ]);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const outboundRequest = new Request(input, init);
    if (!counts.has(outboundRequest.url)) {
      throw new Error("Unexpected outbound request");
    }
    outbound.push(outboundRequest.url);
    counts.set(outboundRequest.url, counts.get(outboundRequest.url) + 1);
    if (outboundRequest.url === jwksUrl) {
      expect(outboundRequest.method).toBe("GET");
      return Response.json({ keys: [publicJwk] });
    }
    expect(outboundRequest.method).toBe("GET");
    expect(outboundRequest.headers.get("cache-control")).toBe(null);
    if (outboundRequest.url === primaryTokenUrl) {
      return new Response("bounded primary failure", {
        status: 503,
        headers: { "content-type": "text/plain" }
      });
    }
    return new Response("workerd-fixture-token", {
      status: 200,
      headers: { "content-type": "text/plain" }
    });
  });

  try {
    const missing = await exports.default.fetch(
      request(`/api/playback/${knownCameraId}`)
    );
    await expectPrivateJson(missing, 403, { error: "Access denied" }, expect);
    expect(outbound).toEqual([]);

    const invalid = await exports.default.fetch(
      request(`/api/playback/${knownCameraId}`, await accessAssertion("wrong-audience"))
    );
    await expectPrivateJson(invalid, 403, { error: "Access denied" }, expect);
    expect(outbound).toEqual([jwksUrl]);

    const valid = await exports.default.fetch(
      request(`/api/playback/${knownCameraId}`, await accessAssertion())
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toBe("private, no-store");
    expect(valid.headers.get("x-content-type-options")).toBe("nosniff");
    const playback = await valid.json();
    expect(playback.cameraId).toBe(knownCameraId);
    expect(
      typeof playback.revision === "string"
      && /^[0-9a-f-]{36}$/i.test(playback.revision)
    ).toBe(true);
    expect(Number.isFinite(Date.parse(playback.refreshAt))).toBe(true);
    expect(
      playback.playlistUrl === `${knownStreamUrl}?wmsAuthSign=workerd-fixture-token`
    ).toBe(true);

    const refreshed = await exports.default.fetch(new Request(
      `https://surfcams.example/api/playback/${knownCameraId}/refresh`,
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": await accessAssertion(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ failedRevision: playback.revision })
      }
    ));
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("cache-control")).toBe("private, no-store");
    const replacement = await refreshed.json();
    expect(replacement.cameraId).toBe(knownCameraId);
    expect(replacement.revision === playback.revision).toBe(false);
    expect(
      replacement.playlistUrl === `${knownStreamUrl}?wmsAuthSign=workerd-fixture-token`
    ).toBe(true);

    const unknown = await exports.default.fetch(
      request("/api/not-a-route", await accessAssertion())
    );
    await expectPrivateJson(unknown, 404, { error: "Not found" }, expect);

    expect(outbound).toEqual([
      jwksUrl,
      primaryTokenUrl,
      fallbackTokenUrl,
      primaryTokenUrl,
      fallbackTokenUrl
    ]);
    expect([...counts.entries()]).toEqual([
      [jwksUrl, 1],
      [primaryTokenUrl, 2],
      [fallbackTokenUrl, 2]
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  } finally {
    fetchSpy.mockRestore();
  }
});
