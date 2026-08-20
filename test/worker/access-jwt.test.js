import assert from "node:assert/strict";
import test from "node:test";

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair
} from "jose";

import {
  AccessDeniedError,
  requireAccessJwt
} from "../../worker/access-jwt.js";

const issuer = "https://family.cloudflareaccess.com";
const audience = "surfcams-access-audience";
const email = "approved@example.com";

const { privateKey, publicKey } = await generateKeyPair("ES256");
const publicJwk = await exportJWK(publicKey);
const keySet = createLocalJWKSet({
  keys: [{ ...publicJwk, alg: "ES256", kid: "test-key", use: "sig" }]
});

const env = {
  ACCESS_TEAM_DOMAIN: issuer,
  ACCESS_AUD: audience
};

function requestWithAssertion(assertion, { url = "https://surfcams.example/api/playback/camera" } = {}) {
  const headers = new Headers();
  if (assertion !== undefined) {
    headers.set("Cf-Access-Jwt-Assertion", assertion);
  }
  return new Request(url, { headers });
}

async function signAssertion({
  signingKey = privateKey,
  tokenIssuer = issuer,
  tokenAudience = audience,
  expiration = "5m",
  includeExpiration = true
} = {}) {
  let assertion = new SignJWT({ email })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject("family-member")
    .setIssuedAt();
  if (includeExpiration) assertion = assertion.setExpirationTime(expiration);
  return assertion.sign(signingKey);
}

function assertSanitizedDenial(error, sensitiveValues = []) {
  assert.equal(error instanceof AccessDeniedError, true);
  assert.equal(error.name, "AccessDeniedError");
  assert.equal(error.message, "Access denied");
  assert.equal(error.cause, undefined);

  const diagnosticSurface = [
    error.name,
    error.message,
    error.cause
  ].join("\n");
  const fullError = `${diagnosticSurface}\n${error.stack}`;
  for (const sensitive of sensitiveValues) {
    assert.equal(fullError.includes(String(sensitive)), false);
  }
  assert.doesNotMatch(diagnosticSurface, /JWT|JWKS|JOSE|signature verification failed/i);
  return true;
}

async function expectDenied(promise, sensitiveValues = []) {
  await assert.rejects(
    promise,
    (error) => assertSanitizedDenial(error, sensitiveValues)
  );
}

test("verifies a valid Cloudflare Access assertion", async () => {
  const assertion = await signAssertion();

  const payload = await requireAccessJwt(
    requestWithAssertion(assertion),
    env,
    { keySet }
  );

  assert.equal(payload.email, email);
  assert.equal(payload.iss, issuer);
  assert.equal(payload.aud, audience);
  assert.equal(payload.sub, "family-member");
  assert.equal(Number.isFinite(payload.exp), true);
});

test("rejects a missing Access assertion", async () => {
  await expectDenied(
    requireAccessJwt(requestWithAssertion(undefined), env, { keySet }),
    [email, issuer, audience]
  );
});

test("rejects an Access assertion over 16 KiB", async () => {
  const oversized = "x".repeat(16_385);
  await expectDenied(
    requireAccessJwt(requestWithAssertion(oversized), env, { keySet }),
    [oversized, email, issuer, audience]
  );
});

test("rejects missing or oversized Access bindings", async (t) => {
  const assertion = await signAssertion();
  const invalidBindings = [
    {},
    { ACCESS_AUD: audience },
    { ACCESS_TEAM_DOMAIN: issuer },
    { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: "x".repeat(513) }
  ];

  for (const invalidEnv of invalidBindings) {
    await t.test(JSON.stringify(Object.keys(invalidEnv)), async () => {
      await expectDenied(
        requireAccessJwt(requestWithAssertion(assertion), invalidEnv, { keySet }),
        [assertion, email, issuer, audience]
      );
    });
  }
});

test("rejects malformed or untrusted Access team domains", async (t) => {
  const assertion = await signAssertion();
  const invalidDomains = [
    "family.cloudflareaccess.com",
    "http://family.cloudflareaccess.com",
    "https://cloudflareaccess.com",
    "https://family.cloudflareaccess.com.evil.example",
    "https://user@family.cloudflareaccess.com",
    "https://family.cloudflareaccess.com:8443",
    "https://family.cloudflareaccess.com/path",
    "https://family.cloudflareaccess.com/?query=1",
    "https://family.cloudflareaccess.com/#fragment"
  ];

  for (const invalidDomain of invalidDomains) {
    await t.test(invalidDomain, async () => {
      await expectDenied(
        requireAccessJwt(
          requestWithAssertion(assertion),
          { ...env, ACCESS_TEAM_DOMAIN: invalidDomain },
          { keySet }
        ),
        [assertion, email, invalidDomain, audience]
      );
    });
  }
});

test("rejects an assertion signed by an untrusted key", async () => {
  const { privateKey: untrustedKey } = await generateKeyPair("ES256");
  const assertion = await signAssertion({ signingKey: untrustedKey });

  await expectDenied(
    requireAccessJwt(requestWithAssertion(assertion), env, { keySet }),
    [assertion, email, issuer, audience]
  );
});

test("rejects an assertion without an expiry", async () => {
  const assertion = await signAssertion({ includeExpiration: false });

  await expectDenied(
    requireAccessJwt(requestWithAssertion(assertion), env, { keySet }),
    [assertion, email, issuer, audience]
  );
});

test("rejects an expired assertion", async () => {
  const assertion = await signAssertion({
    expiration: Math.floor(Date.now() / 1000) - 60
  });

  await expectDenied(
    requireAccessJwt(requestWithAssertion(assertion), env, { keySet }),
    [assertion, email, issuer, audience]
  );
});

test("rejects an assertion from the wrong issuer", async () => {
  const wrongIssuer = "https://outsider.cloudflareaccess.com";
  const assertion = await signAssertion({ tokenIssuer: wrongIssuer });

  await expectDenied(
    requireAccessJwt(requestWithAssertion(assertion), env, { keySet }),
    [assertion, email, issuer, wrongIssuer, audience]
  );
});

test("rejects an assertion for the wrong audience", async () => {
  const wrongAudience = "another-access-audience";
  const assertion = await signAssertion({ tokenAudience: wrongAudience });

  await expectDenied(
    requireAccessJwt(requestWithAssertion(assertion), env, { keySet }),
    [assertion, email, issuer, audience, wrongAudience]
  );
});

test("does not accept assertions from cookies, authorization, or query parameters", async (t) => {
  const assertion = await signAssertion();
  const alternateRequests = [
    new Request("https://surfcams.example/api/playback/camera", {
      headers: { cookie: `CF_Authorization=${assertion}` }
    }),
    new Request("https://surfcams.example/api/playback/camera", {
      headers: { authorization: `Bearer ${assertion}` }
    }),
    new Request(`https://surfcams.example/api/playback/camera?token=${encodeURIComponent(assertion)}`)
  ];

  for (const [index, request] of alternateRequests.entries()) {
    await t.test(String(index), async () => {
      await expectDenied(
        requireAccessJwt(request, env, { keySet }),
        [assertion, email, issuer, audience]
      );
    });
  }
});
