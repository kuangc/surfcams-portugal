# Private MEO Worker Migration Implementation Plan

> **Status: Superseded on 2026-08-22. Do not execute.** The user does not
> operate a Cloudflare account. The approved replacement uses Sites-managed
> hosting and is specified in
> `../specs/2026-08-22-sites-managed-private-surfcams-design.md`. A replacement
> implementation plan will be written after that specification's review gate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Surfcams experience as a Google-authenticated Cloudflare Worker, obtain MEO’s temporary playback token server-side, retain Surfline wave intelligence, and remove every direct or Surfline-camera media path without regressing the accepted desktop or iPhone UX.

**Architecture:** One Cloudflare Worker serves a deterministic allowlisted static package and authenticates playback API calls with Cloudflare Access JWTs. A single named SQLite Durable Object serializes MEO token acquisition and revision-based invalidation; authenticated browsers receive the exact signed MEO master URL and continue streaming HLS directly from MEO. One shared in-memory browser client supplies gallery, Focus/Compare, Favorites-entry, and Explore players, with one bounded token refresh per player generation.

**Tech Stack:** Vanilla ESM JavaScript, Node.js 22.23.2, Node test runner, Vitest with Cloudflare Workers pool, Cloudflare Workers Static Assets, Cloudflare Access with Google identity, SQLite Durable Objects, Wrangler 4.124.0, `jose` 6.2.9.

---

## Execution rules

- Work only in `/Users/kuangchen/workspace/surfcams-portugal/.worktrees/meo-only-cameras` on branch `codex/meo-only-cameras`.
- This plan and its approved design-status update are committed by the plan author before Task 1 begins; they are not part of the dirty MEO integration snapshot.
- Apply superpowers:test-driven-development for every behavior change: add one focused failing test, run it and record the expected RED, implement the minimum production change, rerun to GREEN, then commit.
- Apply superpowers:verification-before-completion before every completion claim.
- Preserve unrelated user work. The pre-existing minimal untracked `package-lock.json` is explicitly excluded from Task 1 and replaced only after dependency pins are added in Task 2.
- Never log a MEO token, signed playlist URL/query, Access assertion, Google OAuth secret, or opaque token revision. Persist the MEO token/revision only in the single named Durable Object; authorized browser responses and player/client state remain memory-only, and every other storage surface is forbidden.
- Do not modify `.github/workflows/update-surfline-conditions.yml`. Its accepted blob at the planning base is `83444c23091be79bc735c3d54391efe6a70a4b7a`.
- Tasks 1–10 are repository work. Tasks 11–14 include named owner-operated Cloudflare, Google, GitHub, live-network, and physical-device actions; stop at any external gate that lacks credentials or owner authority.
- Cloudflare does not create Preview URLs for a Worker with Durable Objects. The Access-protected final `workers.dev` hostname is the staging surface while GitHub Pages remains live.
- Tasks 11–14 maintain a secret-free working record at ignored `.wrangler/private-meo-release-record.md`. It must contain no email address, JWT, token, signed URL/query, OAuth value, or secret. Task 13 turns it into a draft GitHub Release named `private-worker-cutover-2026-08-19`; Task 14 publishes that sanitized release as the durable external audit record.

## Task 1: Snapshot the already-verified MEO catalog integration

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `data/beachcam-cameras.json`
- Modify: `data/coast-exposures.json`
- Modify: `data/lisbon-drive-estimates.json`
- Delete: `data/local-stream-overrides.example.json`
- Delete: `data/local-stream-overrides.json`
- Modify: `data/meo-spots.json`
- Modify: `data/meo-surfline-matches.json`
- Modify: `data/portugal-tides.json`
- Modify: `data/promoted-spots.json`
- Modify: `data/spot-advice-resolved.json`
- Modify: `data/spot-metadata-enrichment.json`
- Modify: `data/surfline-mapping-review.json`
- Modify: `data/surfline-spots.json`
- Modify: `docs/architecture.md`
- Modify: `docs/surfline-mapping-review.md`
- Modify: `docs/surfline-meo-metadata-comparison.md`
- Modify: `docs/surfline-promotion-design.md`
- Modify: `docs/surfline-promotion-map.html`
- Modify: `index.html`
- Modify: `scripts/build-promoted-spots.js`
- Modify: `scripts/build-surfline-spots.js`
- Modify: `scripts/cache-surfline-pages.js`
- Modify: `scripts/crawl-beachcam.cjs`
- Modify: `scripts/lib/surfline-extract.js`
- Modify: `scripts/validate-meo-crawl.cjs`
- Modify: `src/config.js`
- Modify: `src/favorites.js`
- Modify: `src/feed-policy.js`
- Create: `src/explore-catalog.js`
- Modify: `src/main.js`
- Modify: `src/mobile-ux.js`
- Modify: `src/styles/app.css`
- Modify: `test/camera-data.test.js`
- Modify: `test/crawl-beachcam.test.js`
- Create: `test/explore-catalog.test.js`
- Create: `test/explore-information-source.test.js`
- Modify: `test/favorites.test.js`
- Modify: `test/feed-policy.test.js`
- Modify: `test/index.test.js`
- Modify: `test/meo-crawl-validation.test.js`
- Create: `test/meo-provider-data-integrity.test.js`
- Modify: `test/mobile-ux.test.js`
- Modify: `test/promoted-spots-build.test.js`
- Modify: `test/runtime-ux-regressions.test.js`
- Modify: `test/source-safety.test.js`
- Modify: `test/spot-advice-runtime.test.js`
- Modify: `test/spot-advice-subjects.test.js`
- Modify: `test/spot-data.test.js`
- Create: `test/surfline-media-boundary.test.js`
- Modify: `test/surfline-extract.test.js`
- Exclude: `package-lock.json`

- [ ] **Step 1: Confirm the snapshot boundary**

Run:

~~~bash
git status --short
git diff --check
~~~

Expected: only the files enumerated above plus untracked `package-lock.json` appear; `git diff --check` exits 0.

- [ ] **Step 2: Re-run the already-created test-first MEO integration**

Run:

~~~bash
npm test
npm run check-spot-advice
node --check src/main.js
node --check src/feed-policy.js
~~~

Expected: 616 tests pass, the advice check exits 0, and both syntax checks exit 0. If the total has legitimately increased, every test must pass and the change in count must be explained in the Task 1 commit message or handoff note.

- [ ] **Step 3: Assert the accepted provider boundary**

Run:

~~~bash
node --test test/meo-provider-data-integrity.test.js test/surfline-media-boundary.test.js test/explore-catalog.test.js test/explore-information-source.test.js
rg -n "hls\.cdn-surfline\.com|camstills\.cdn-surfline\.com|__rawSurflineFeeds" index.html src data
~~~

Expected: focused tests pass; `rg` returns no production camera-media match. Surfline report, forecast, condition, advice, and favicon references remain allowed.

- [ ] **Step 4: Stage only the verified integration**

Run:

~~~bash
git add CLAUDE.md README.md index.html
git add data/beachcam-cameras.json data/coast-exposures.json data/lisbon-drive-estimates.json data/local-stream-overrides.example.json data/local-stream-overrides.json data/meo-spots.json data/meo-surfline-matches.json data/portugal-tides.json data/promoted-spots.json data/spot-advice-resolved.json data/spot-metadata-enrichment.json data/surfline-mapping-review.json data/surfline-spots.json
git add docs/architecture.md docs/surfline-mapping-review.md docs/surfline-meo-metadata-comparison.md docs/surfline-promotion-design.md docs/surfline-promotion-map.html
git add scripts/build-promoted-spots.js scripts/build-surfline-spots.js scripts/cache-surfline-pages.js scripts/crawl-beachcam.cjs scripts/lib/surfline-extract.js scripts/validate-meo-crawl.cjs
git add src/config.js src/explore-catalog.js src/favorites.js src/feed-policy.js src/main.js src/mobile-ux.js src/styles/app.css
git add test/camera-data.test.js test/crawl-beachcam.test.js test/explore-catalog.test.js test/explore-information-source.test.js test/favorites.test.js test/feed-policy.test.js test/index.test.js test/meo-crawl-validation.test.js test/meo-provider-data-integrity.test.js test/mobile-ux.test.js test/promoted-spots-build.test.js test/runtime-ux-regressions.test.js test/source-safety.test.js test/spot-advice-runtime.test.js test/spot-advice-subjects.test.js test/spot-data.test.js test/surfline-extract.test.js test/surfline-media-boundary.test.js
git diff --cached --name-only
~~~

Expected: the cached list is exactly the Task 1 file list and does not contain `package-lock.json` or `docs/superpowers/`.

- [ ] **Step 5: Commit the stable base**

Run:

~~~bash
git commit -m "feat: complete provider-native MEO catalog migration"
git status --short
~~~

Expected: commit succeeds; only `?? package-lock.json` remains.

## Task 2: Pin the toolchain and build a deterministic runtime package

**Files:**

- Create: `.node-version`
- Modify: `.gitignore`
- Modify: `package.json`
- Replace: `package-lock.json`
- Create: `scripts/build-runtime-assets.js`
- Create: `test/runtime-package.test.js`

- [ ] **Step 1: Add the runtime-package contract and capture RED**

Create `test/runtime-package.test.js` with a temporary output directory and these exact public assertions:

~~~js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_DATA_FILES,
  RUNTIME_ROOT_FILES,
  assertSafeOutputDirectory,
  buildRuntimeAssets,
  validateRuntimeInput
} from "../scripts/build-runtime-assets.js";

const expectedRoot = [
  "apple-touch-icon.png",
  "index.html",
  "manifest.webmanifest"
];

const expectedData = [
  "beachcam-cameras.json",
  "coast-exposures.json",
  "lisbon-drive-estimates.json",
  "meo-spots.json",
  "meo-surfline-matches.json",
  "portugal-tides.json",
  "promoted-spots.json",
  "spot-advice-resolved.json",
  "spot-metadata-enrichment.json",
  "stretches.json",
  "surfline-conditions.json",
  "surfline-spots.json"
];

test("runtime package exports the reviewed allowlist", () => {
  assert.deepEqual(RUNTIME_ROOT_FILES, expectedRoot);
  assert.deepEqual(RUNTIME_DATA_FILES, expectedData);
});

test("two builds of one tree produce the same manifest", async () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "surfcams-dist-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "surfcams-dist-b-"));
  const manifestA = await buildRuntimeAssets({ rootDir: process.cwd(), outputDir: first });
  const manifestB = await buildRuntimeAssets({ rootDir: process.cwd(), outputDir: second });
  assert.deepEqual(manifestA, manifestB);
  assert.equal(Object.hasOwn(manifestA, "generatedAt"), false);
  assert.equal(Object.hasOwn(manifestA, "gitSha"), false);
});

test("runtime package excludes repository and Surfline camera media", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfcams-dist-"));
  await buildRuntimeAssets({ rootDir: process.cwd(), outputDir });
  const names = fs.readdirSync(outputDir, { recursive: true }).map(String);
  for (const forbidden of [".git", "docs", "scripts", "test", ".dev.vars"]) {
    assert.equal(names.some((name) => name.includes(forbidden)), false);
  }
  const text = names
    .filter((name) => name.endsWith(".html") || name.endsWith(".js") || name.endsWith(".json"))
    .map((name) => fs.readFileSync(path.join(outputDir, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(text, /hls\.cdn-surfline\.com|camstills\.cdn-surfline\.com|__rawSurflineFeeds/);
});

test("pure output guard refuses every destructive target class", () => {
  const rootDir = process.cwd();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "surfcams-output-"));
  const target = path.join(sandbox, "target");
  const linkedOutput = path.join(sandbox, "linked-output");
  fs.mkdirSync(target);
  fs.symlinkSync(target, linkedOutput, "dir");

  for (const outputDir of [
    rootDir,
    path.dirname(rootDir),
    path.parse(rootDir).root,
    path.join(rootDir, "src", "dist"),
    path.join(rootDir, "data", "dist"),
    path.join(rootDir, "icons", "dist"),
    path.join(rootDir, "test"),
    path.join(rootDir, "scripts"),
    path.join(rootDir, "docs"),
    path.join(rootDir, ".git"),
    path.join(rootDir, "some-other-output"),
    linkedOutput
  ]) {
    assert.throws(
      () => assertSafeOutputDirectory({ rootDir, outputDir }),
      /unsafe output directory/
    );
  }

  assert.doesNotThrow(() => assertSafeOutputDirectory({
    rootDir,
    outputDir: path.join(rootDir, "dist")
  }));
});

test("runtime input validation rejects a symbolic link", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "surfcams-input-"));
  const target = path.join(sandbox, "target.json");
  const linkedInput = path.join(sandbox, "linked.json");
  fs.writeFileSync(target, "{}\n");
  fs.symlinkSync(target, linkedInput, "file");
  assert.doesNotThrow(() => validateRuntimeInput(target));
  assert.throws(() => validateRuntimeInput(linkedInput), /regular file/);
});

test("runtime builder CLI prints the exact manifest digest", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/build-runtime-assets.js"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /^runtime-assets manifest-sha256=[a-f0-9]{64}\n$/
  );
});
~~~

Run:

~~~bash
node --test test/runtime-package.test.js
~~~

Expected RED: `ERR_MODULE_NOT_FOUND` for `scripts/build-runtime-assets.js`.

- [ ] **Step 2: Implement the deterministic allowlist builder**

Create `scripts/build-runtime-assets.js` with these exported constants and result shape:

~~~js
export const RUNTIME_ROOT_FILES = Object.freeze([
  "apple-touch-icon.png",
  "index.html",
  "manifest.webmanifest"
]);

export const RUNTIME_DATA_FILES = Object.freeze([
  "beachcam-cameras.json",
  "coast-exposures.json",
  "lisbon-drive-estimates.json",
  "meo-spots.json",
  "meo-surfline-matches.json",
  "portugal-tides.json",
  "promoted-spots.json",
  "spot-advice-resolved.json",
  "spot-metadata-enrichment.json",
  "stretches.json",
  "surfline-conditions.json",
  "surfline-spots.json"
]);
~~~

The module must also export the pure guards `assertSafeOutputDirectory({ rootDir, outputDir })` and `validateRuntimeInput(filePath)`, plus `buildRuntimeAssets({ rootDir, outputDir })`. Default `rootDir` to `process.cwd()` and `outputDir` to the repository’s exact `dist/`. Its complete implementation must:

1. use `lstat` to require every allowlisted root/data input to be a regular non-symbolic-link file;
2. walk `icons/` and `src/` in lexicographic order and use the same guard for every copied file;
3. permit a repository-internal output only when its normalized path is exactly `<rootDir>/dist`; reject every other path inside or above the repository, including `.git`, `src`, `data`, `icons`, `docs`, `scripts`, and `test`;
4. permit a test-only output outside the repository only when it is a newly created, empty, real non-symbolic-link directory; never recursively remove an external output directory;
5. reject any canonical `dist` that is a symlink, finish every input/output validation before removal, and recursively remove/recreate only that exact validated `<rootDir>/dist` path;
6. copy regular files with their bytes unchanged;
7. compute each copied file’s SHA-256 and byte count;
8. sort entries by slash-normalized relative path;
9. write and return `{ files: [{ path, bytes, sha256 }] }` as `asset-manifest.json`;
10. include no timestamp, Git value, absolute path, or environment value;
11. invoke itself when run as a CLI, exiting nonzero on any validation/copy failure; and
12. print exactly `runtime-assets manifest-sha256=<64 lowercase hex characters>` for the bytes written to `dist/asset-manifest.json`.

Run:

~~~bash
node --test test/runtime-package.test.js
node scripts/build-runtime-assets.js
find dist -type f | sort
~~~

Expected GREEN: tests pass; output contains only the approved roots, `icons/`, `src/`, approved `data/` JSON, and `asset-manifest.json`.

- [ ] **Step 3: Pin Node and exact dependencies**

Write `.node-version`:

~~~text
22.23.2
~~~

Update `.gitignore` to include:

~~~gitignore
.wrangler/
.dev.vars
.dev.vars.*
.env
.env.*
~~~

Update `package.json` with:

~~~json
{
  "private": true,
  "scripts": {
    "build": "node scripts/build-runtime-assets.js",
    "test:app": "node --test \"test/*.test.js\"",
    "test": "npm run test:app"
  },
  "dependencies": {
    "jose": "6.2.9"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.22.0",
    "vitest": "4.1.11",
    "wrangler": "4.124.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
~~~

Preserve every existing data/build script while adding the shown entries. Regenerate, do not hand-edit, the lock:

~~~bash
npm install --package-lock-only
npm ci
~~~

Expected: install succeeds under Node 22; `package-lock.json` records only the exact direct pins above and their transitive dependencies.

Remove the stale GitHub Pages `homepage` value from `package.json` in the same change. The protected Worker hostname is configured operationally and must not be guessed or committed before it exists.

Do not claim an exact npm executable pin: Node 22.23.2 currently bundles a newer npm than Cloudflare’s build image, while both consume lockfile v3 consistently. The reproducibility boundary is the exact Node major/runtime, committed lockfile, `npm ci`, and exact direct dependency versions.

- [ ] **Step 4: Re-run and commit**

Run:

~~~bash
npm run test:app
npm run build
git diff --check
git add .node-version .gitignore package.json package-lock.json scripts/build-runtime-assets.js test/runtime-package.test.js
git commit -m "build: package deterministic Worker assets"
~~~

Expected: all app tests pass, the build is deterministic, diff check exits 0, and the commit contains exactly the Task 2 files.

## Task 3: Implement the immutable playback catalog and MEO token primitives

**Files:**

- Create: `worker/playback-catalog.js`
- Create: `worker/meo-token.js`
- Create: `test/worker/playback-catalog.test.js`
- Create: `test/worker/meo-token.test.js`

- [ ] **Step 1: Write playback-catalog tests and capture RED**

Create tests that import the real accepted catalog and prove:

~~~js
import assert from "node:assert/strict";
import test from "node:test";

import cameraDb from "../../data/beachcam-cameras.json" with { type: "json" };
import { resolveMeoPlaybackCameras } from "../../src/feed-policy.js";
import {
  createPlaybackCatalog,
  findPlaybackCamera,
  playbackCameraCount
} from "../../worker/playback-catalog.js";

test("compiled playback catalog contains exactly provider-native playable MEO rows", () => {
  const expectedIds = resolveMeoPlaybackCameras(cameraDb).map(({ id }) => id);
  const catalog = createPlaybackCatalog();
  assert.ok(expectedIds.length > 0);
  assert.deepEqual([...catalog.keys()], expectedIds);
  assert.equal(catalog.size, expectedIds.length);
  assert.equal(playbackCameraCount(), expectedIds.length);
  for (const [id, camera] of catalog) {
    assert.equal(camera.id, id);
    assert.match(camera.streamUrl, /^https:\/\/video-auth1\.iol\.pt\/(?:auth-)?beachcam\/[^/?#]+\/playlist\.m3u8$/);
    assert.equal(Object.isFrozen(camera), true);
  }
});

test("catalog rejects caller-controlled and non-camera identities", () => {
  assert.equal(
    findPlaybackCamera("costa-da-caparica-riviera")?.id,
    "costa-da-caparica-riviera"
  );
  assert.equal(findPlaybackCamera("surfline-castelo"), null);
  assert.equal(findPlaybackCamera("../data/beachcam-cameras.json"), null);
  assert.equal(findPlaybackCamera(""), null);
});
~~~

Run:

~~~bash
node --test test/worker/playback-catalog.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Implement the catalog from the accepted source**

Create `worker/playback-catalog.js`:

~~~js
import cameraDb from "../data/beachcam-cameras.json" with { type: "json" };
import { resolveMeoPlaybackCameras } from "../src/feed-policy.js";

const playbackCatalog = new Map(
  resolveMeoPlaybackCameras(cameraDb).map((camera) => [
    camera.id,
    Object.freeze({ id: camera.id, streamUrl: camera.streamUrl })
  ])
);

export function createPlaybackCatalog() {
  return new Map(playbackCatalog);
}

export function findPlaybackCamera(cameraId) {
  if (typeof cameraId !== "string" || !cameraId) return null;
  return playbackCatalog.get(cameraId) || null;
}

export function playbackCameraCount() {
  return playbackCatalog.size;
}
~~~

Run the focused test. Expected GREEN.

- [ ] **Step 3: Write token primitive tests and capture RED**

Test these exact exports and values:

~~~text
MEO_BROKER_TTL_MS = 72_000_000
MEO_TOKEN_ENDPOINTS = [
  https://beachcam.meo.pt/api/video-token,
  https://beachcam.meo.pt/api/livecam/access
]
validateMeoToken(body) -> token string or MeoTokenUnavailableError
fetchMeoToken({ fetcher, endpoints, timeoutMs }) -> Promise<token string>
signMeoPlaylistUrl(streamUrl, token) -> signed URL string
~~~

The tests must cover:

- primary endpoint success without calling fallback;
- network, timeout, non-2xx, wrong content type, blank, control-character, and over-4096-byte primary responses falling back once;
- an oversized declared or streamed response is canceled after at most 4097 bytes rather than buffered without bound;
- both endpoints failing with one sanitized `MeoTokenUnavailableError` whose message contains no body or URL query;
- exact canonical MEO URL validation: HTTPS, no credentials, exact host, default port, no input query/hash, and `/(auth-)?beachcam/<feed>/playlist.m3u8`;
- one URL-encoded `wmsAuthSign` parameter and no mutation of the input string.

Run:

~~~bash
node --test test/worker/meo-token.test.js
~~~

Expected RED: module not found.

- [ ] **Step 4: Implement bounded token acquisition and signing**

Create `worker/meo-token.js` with the exact constants above. `validateMeoToken` accepts only a trimmed 1–4096 byte control-character-free string. `fetchMeoToken` uses a five-second `AbortSignal.timeout` for each endpoint, requires `text/plain` and a successful response, rejects a declared body over 4096 bytes, and otherwise reads the response stream only through byte 4097 before canceling an oversized body. It tries each endpoint once. `signMeoPlaylistUrl` reparses and revalidates the immutable catalog URL, then returns:

~~~js
const signed = new URL(streamUrl);
signed.searchParams.set("wmsAuthSign", token);
return signed.toString();
~~~

Do not log a request, response body, token, or signed URL.

Run:

~~~bash
node --test test/worker/playback-catalog.test.js test/worker/meo-token.test.js
git diff --check
git add worker/playback-catalog.js worker/meo-token.js test/worker/playback-catalog.test.js test/worker/meo-token.test.js
git commit -m "feat: validate MEO playback tokens"
~~~

Expected: both focused suites pass and the commit contains exactly four files.

## Task 4: Validate Cloudflare Access assertions inside the API

**Files:**

- Create: `worker/access-jwt.js`
- Create: `test/worker/access-jwt.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the JWT contract and capture RED**

Create `test/worker/access-jwt.test.js`. Generate an ephemeral ES256 keypair with `jose`, expose its public JWK through `createLocalJWKSet`, and sign assertions with:

~~~js
const issuer = "https://family.cloudflareaccess.com";
const audience = "surfcams-access-audience";

const assertion = await new SignJWT({ email: "approved@example.com" })
  .setProtectedHeader({ alg: "ES256", kid: "test-key" })
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject("family-member")
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(privateKey);
~~~

Cover valid verification plus missing assertion, assertion over 16 KiB, missing binding, malformed team domain, bad signature, missing expiry, expired token, wrong issuer, and wrong audience. Every rejection must be an `AccessDeniedError` with exactly `"Access denied"` and must not expose a JOSE message, JWT, email, issuer, or audience.

Run:

~~~bash
node --test test/worker/access-jwt.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Implement fail-closed validation**

Create `worker/access-jwt.js` with this implementation shape:

~~~js
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
~~~

Use injected `keySet` in unit tests. Do not accept the Access cookie, an Authorization header, query token, or caller-provided issuer/audience.

- [ ] **Step 3: Include nested pure Worker tests in the app test command**

Change only the test scripts in `package.json`:

~~~json
{
  "scripts": {
    "test:app": "node --test \"test/*.test.js\" \"test/worker/*.test.js\"",
    "test": "npm run test:app"
  }
}
~~~

Preserve every other script and dependency.

- [ ] **Step 4: Verify and commit**

Run:

~~~bash
node --test test/worker/access-jwt.test.js
npm run test:app
git diff --check
git add worker/access-jwt.js test/worker/access-jwt.test.js package.json
git commit -m "feat: validate Cloudflare Access assertions"
~~~

Expected: all JWT cases and the complete Node suite pass.

## Task 5: Coordinate one global token revision in a SQLite Durable Object

**Files:**

- Create: `worker/token-coordinator-core.js`
- Create: `worker/meo-token-coordinator.js`
- Create: `worker/index.js`
- Create: `test/worker/token-coordinator-core.test.js`
- Create: `test/workerd/meo-token-coordinator.test.js`
- Create: `test/fixtures/wrangler-dry-run-secrets.env`
- Modify: `test/runtime-package.test.js`
- Create: `vitest.worker.config.js`
- Create: `wrangler.jsonc`
- Modify: `package.json`

- [ ] **Step 1: Test the storage-independent coordinator and capture RED**

Use an in-memory storage double with async `get`, `put`, and `delete` methods. Test:

- first miss fetches once and stores `{ token, revision, fetchedAt, refreshAt }`;
- the boundary is exactly `fetchedAt + 72_000_000` and does not slide on reads;
- a read at `refreshAt - 1` reuses; a read at `refreshAt` replaces;
- concurrent misses share one in-flight fetch;
- `refreshToken(currentRevision)` performs one fetch and one atomic put/overwrite with zero delete calls;
- `refreshToken(staleRevision)` returns the newer current record without fetching;
- concurrent conditional refreshes converge on one new revision;
- invalid/blank revisions fail without touching storage;
- a fetch failure stores no partial record, preserves any prior complete record byte-for-byte, and exposes no token/upstream body;
- while a forced replacement is in flight, other refresh callers share it, but ordinary GET callers may continue receiving a still-fresh prior record; if no fresh prior record exists, GET callers share the in-flight acquisition.

Run:

~~~bash
node --test test/worker/token-coordinator-core.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Implement the coordinator core**

Create `worker/token-coordinator-core.js`:

~~~js
import {
  fetchMeoToken,
  MEO_BROKER_TTL_MS
} from "./meo-token.js";

const STORAGE_KEY = "current-token";

export class TokenCoordinatorCore {
  constructor({
    storage,
    fetchToken = fetchMeoToken,
    now = () => Date.now(),
    createRevision = () => crypto.randomUUID()
  }) {
    this.storage = storage;
    this.fetchToken = fetchToken;
    this.now = now;
    this.createRevision = createRevision;
    this.inFlight = null;
  }

  isFresh(record, timestamp) {
    return Boolean(
      record
      && typeof record.token === "string"
      && record.token
      && typeof record.revision === "string"
      && record.revision
      && Number.isFinite(record.fetchedAt)
      && Number.isFinite(record.refreshAt)
      && record.refreshAt === record.fetchedAt + MEO_BROKER_TTL_MS
      && record.fetchedAt <= timestamp
      && timestamp < record.refreshAt
    );
  }

  async acquire() {
    if (this.inFlight) return this.inFlight;
    const operation = (async () => {
      const token = await this.fetchToken();
      const fetchedAt = this.now();
      const revision = this.createRevision();
      if (typeof revision !== "string" || !revision) {
        throw new Error("Token acquisition unavailable");
      }
      const record = {
        token,
        revision,
        fetchedAt,
        refreshAt: fetchedAt + MEO_BROKER_TTL_MS
      };
      await this.storage.put(STORAGE_KEY, record);
      return record;
    })();
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = null;
    }
  }

  async getToken() {
    const record = await this.storage.get(STORAGE_KEY);
    if (this.isFresh(record, this.now())) return record;
    if (this.inFlight) return this.inFlight;
    return this.acquire();
  }

  async refreshToken(failedRevision) {
    if (typeof failedRevision !== "string" || !failedRevision.trim()) {
      throw new Error("Token refresh unavailable");
    }
    const record = await this.storage.get(STORAGE_KEY);
    if (
      this.isFresh(record, this.now())
      && record.revision !== failedRevision
    ) return record;
    if (this.inFlight) return this.inFlight;
    return this.acquire();
  }
}
~~~

Keep all refresh paths through the single in-flight acquisition shown above. Acquisition overwrites storage only after a new token/revision record is fully validated; it never deletes the previous record first. Add a focused race test before changing the implementation if Workerd storage semantics expose a concurrent case not represented by the pure storage double.

Run the focused Node test. Expected GREEN.

- [ ] **Step 3: Write the Workerd contract/configuration and capture RED**

Create `wrangler.jsonc`:

~~~jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "surfcams-portugal",
  "main": "worker/index.js",
  "compatibility_date": "2026-08-19",
  "workers_dev": true,
  "preview_urls": false,
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api", "/api/*"]
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "MEO_TOKEN_COORDINATOR",
        "class_name": "MeoTokenCoordinator"
      }
    ]
  },
  "exports": {
    "MeoTokenCoordinator": {
      "type": "durable-object",
      "storage": "sqlite"
    }
  },
  "secrets": {
    "required": [
      "ACCESS_TEAM_DOMAIN",
      "ACCESS_AUD"
    ]
  }
}
~~~

Do not add `migrations`, SPA not-found handling, plaintext bindings for Access configuration, or a preview environment.

Create `vitest.worker.config.js`:

~~~js
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ACCESS_TEAM_DOMAIN: "https://family.cloudflareaccess.com",
          ACCESS_AUD: "surfcams-access-audience"
        }
      }
    })
  ],
  test: {
    include: ["test/workerd/**/*.test.js"]
  }
});
~~~

In `test/workerd/meo-token-coordinator.test.js`, import `env` from `cloudflare:workers` and `afterEach`, `test`, `vi` from `vitest`. Mock `globalThis.fetch` and throw on every unexpected URL so the suite cannot reach live network:

~~~js
let tokenSequence = 0;
const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const request = new Request(input, init);
  if (request.url !== "https://beachcam.meo.pt/api/video-token") {
    throw new Error("Unexpected outbound request");
  }
  tokenSequence += 1;
  return new Response("fixture-token-" + tokenSequence, {
    status: 200,
    headers: { "Content-Type": "text/plain" }
  });
});

const coordinator = env.MEO_TOKEN_COORDINATOR.getByName("global");
const [first, second] = await Promise.all([
  coordinator.getToken(),
  coordinator.getToken()
]);
~~~

Restore the global mock after each test. Assert equal revision records, one upstream request, persisted reuse from a second stub reference, and conditional replacement through `refreshToken(first.revision)`. Compare token equality only as a Boolean so no assertion failure prints the token value.

Add to `test/runtime-package.test.js`:

~~~js
test("the public Worker test command builds ignored assets first", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.match(packageJson.scripts["test:worker"], /^npm run build && /);
});
~~~

Also require `check:worker` to use only `test/fixtures/wrangler-dry-run-secrets.env`. Create that fixture with clearly non-production values for the two declared names:

~~~dotenv
ACCESS_TEAM_DOMAIN=https://family.cloudflareaccess.com
ACCESS_AUD=surfcams-local-dry-run-only
~~~

This fixture exists only to let a clean checkout run Wrangler's offline `--dry-run --secrets-file` validation before the real Worker/secrets exist. It is excluded from `dist/`, never used by `deploy`, and contains no production value.

Run:

~~~bash
npm run build
node --test test/runtime-package.test.js
npm exec -- vitest run --config vitest.worker.config.js
~~~

Expected RED: the package script does not yet exist and Workerd cannot load the not-yet-created `worker/index.js`/Durable Object export. No live request is made.

- [ ] **Step 4: Implement the real Durable Object wrapper**

Create `worker/meo-token-coordinator.js`:

~~~js
import { DurableObject } from "cloudflare:workers";
import { TokenCoordinatorCore } from "./token-coordinator-core.js";

export class MeoTokenCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new TokenCoordinatorCore({ storage: ctx.storage });
  }

  async getToken() {
    return this.core.getToken();
  }

  async refreshToken(failedRevision) {
    return this.core.refreshToken(failedRevision);
  }
}
~~~

Create the minimal `worker/index.js` for this cycle:

~~~js
export { MeoTokenCoordinator } from "./meo-token-coordinator.js";

export default {
  async fetch() {
    return new Response("Not Found", { status: 404 });
  }
};
~~~

Update `package.json`:

~~~json
{
  "scripts": {
    "test:worker": "npm run build && vitest run --config vitest.worker.config.js",
    "test": "npm run test:app && npm run test:worker",
    "check:worker": "wrangler deploy --dry-run --config wrangler.jsonc --secrets-file test/fixtures/wrangler-dry-run-secrets.env --outdir .wrangler/dry-run"
  }
}
~~~

- [ ] **Step 5: Reach Workerd GREEN from a clean public command**

Run:

~~~bash
node --test test/runtime-package.test.js
npm test
npm run check:worker
~~~

Expected: the package contract passes; `test:worker` builds `dist/` before Workerd starts; the SQLite-backed namespace test passes with only the mocked MEO request; Wrangler dry-run succeeds using declarative `exports`; no deployment occurs.

- [ ] **Step 6: Commit**

Run:

~~~bash
git diff --check
git add package.json worker/index.js worker/meo-token-coordinator.js worker/token-coordinator-core.js test/fixtures/wrangler-dry-run-secrets.env test/runtime-package.test.js test/worker/token-coordinator-core.test.js test/workerd/meo-token-coordinator.test.js vitest.worker.config.js wrangler.jsonc
git commit -m "feat: coordinate MEO token revisions"
~~~

Expected: exactly the Task 5 files are committed.

## Task 6: Add the authenticated playback API and deny-only bootstrap

**Files:**

- Create: `worker/playback-api.js`
- Create: `worker/router.js`
- Modify: `worker/index.js`
- Create: `worker/bootstrap.js`
- Create: `wrangler.bootstrap.jsonc`
- Create: `test/worker/playback-api.test.js`
- Create: `test/worker/index.test.js`
- Create: `test/worker/bootstrap.test.js`
- Create: `test/workerd/worker-routing.test.js`
- Modify: `test/runtime-package.test.js`
- Modify: `package.json`

- [ ] **Step 1: Test the pure API router and capture RED**

Create `test/worker/playback-api.test.js` against an injected camera finder, URL signer, and coordinator double. Cover:

- `GET /api/playback/<known-id>` calls `getToken()` and returns only `cameraId`, `playlistUrl`, `revision`, and ISO `refreshAt`;
- unknown, Surfline, promoted, streamless, malformed, and encoded-path IDs return 404 without calling the coordinator;
- `POST /api/playback/<known-id>/refresh` requires exact `Content-Type: application/json`, rejects a declared `Content-Length` above 1024 before reading, and uses a streaming reader that cancels/rejects as soon as byte 1025 is observed when the header is absent, false, or understated;
- the only accepted object shape is `{ "failedRevision": "revision-1" }`, with any other nonblank opaque revision accepted by the same schema;
- extra keys, arrays, invalid JSON, empty revision, wrong method, and trailing path return bounded 400/405/413/404 JSON;
- the coordinator receives only the opaque failed revision;
- all API responses include `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`;
- provider/coordinator failure returns generic 503 without a token, signed URL, request query, provider body, or stack.

Run:

~~~bash
node --test test/worker/playback-api.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Add router, Workerd, asset-delegation, and script contracts; capture RED**

Create `test/worker/index.test.js` before changing production routing. Import `createWorker` from the not-yet-created pure `worker/router.js`, inject authentication/playback doubles, and pass a fake `env.ASSETS.fetch`. Keeping this seam outside `worker/index.js` is required because plain Node cannot import the Workerd-only `cloudflare:workers` Durable Object module. Prove:

- `/api`, `/api/*`, and unknown API routes authenticate before playback routing;
- authentication failure is a generic private/no-store 403 and does not call playback;
- a non-API request delegates the original request exactly once to `ASSETS`;
- a fake asset 404 is returned unchanged, so the Worker does not turn typos into `index.html`.

Create `test/worker/bootstrap.test.js` before creating the bootstrap. Require its default handler to return exactly bounded 503 JSON with `no-store`/`nosniff` for every path, and prove the body contains no app/data/API/token detail. Extend `test/runtime-package.test.js` to require `wrangler.bootstrap.jsonc` to target the same exact Worker name with only `worker/bootstrap.js`, `workers_dev: true`, and `preview_urls: false`—no assets, Durable Object, route, or secret declaration.

Create `test/workerd/worker-routing.test.js` before replacing the minimal Task 5 Worker. Use only current Cloudflare Vitest APIs: import `env` and `exports` from `cloudflare:workers`, and `vi` from `vitest`; do not use deprecated `SELF` or removed `fetchMock`. Generate a local signing key/JWK and a matching Access JWT. Intercept `globalThis.fetch` with `vi.spyOn` so:

- the exact `https://family.cloudflareaccess.com/cdn-cgi/access/certs` request returns the locally generated public JWK;
- the exact primary and fallback MEO token endpoints return bounded fixture responses when expected;
- every other outbound request throws `Unexpected outbound request`;
- the spy is restored after each test and all expected mocked calls are consumed.

Through `exports.default.fetch()`, prove missing/invalid Access assertions return generic 403 before any MEO call, a locally signed valid assertion reaches one known immutable camera through the real Durable Object and returns a signed URL, and an authenticated unknown API path returns JSON 404. Do not make asset assertions through `exports`: Cloudflare's `exports` test helper does not expose Static Assets. The injected Node router test above covers delegation; Task 2 covers the exact packaged assets; Task 12 covers the deployed binding.

Add a pre-production contract to `test/runtime-package.test.js` requiring `test:worker` to begin with `npm run build &&`, and requiring local `cf:bootstrap` and `deploy` scripts to use the two named Wrangler configs. Run:

~~~bash
node --test test/worker/bootstrap.test.js test/worker/index.test.js test/runtime-package.test.js
npm run build
npm exec -- vitest run --config vitest.worker.config.js
~~~

Expected RED: `createWorker` and the API behavior are absent, the Task 5 Worker returns 404 instead of enforcing Access, and the deployment scripts do not yet exist. The outbound spy proves no live network is reached.

- [ ] **Step 3: Implement the injectable API and its production instance**

Create `worker/playback-api.js` with the explicit seam:

~~~js
export function createPlaybackApi({
  findCamera = findPlaybackCamera,
  signUrl = signMeoPlaylistUrl
} = {}) {
  return async function playbackApi(request, env) {
    // exact route, method, bounded-body, coordinator, and response logic
  };
}

export const handlePlaybackApi = createPlaybackApi();
~~~

Pure tests inject `findCamera` and `signUrl`; production uses the immutable catalog and signer. The handler must parse only `GET /api/playback/:cameraId` and `POST /api/playback/:cameraId/refresh`, resolve camera IDs only through `findCamera`, obtain `env.MEO_TOKEN_COORDINATOR.getByName("global")`, call `getToken()` for GET or `refreshToken(failedRevision)` for POST, and return only the bounded success/error schemas specified by the tests. The streaming body reader must cancel its reader on overflow before JSON parsing. Never buffer an unbounded request.

The success body is exactly:

~~~js
{
  cameraId: camera.id,
  playlistUrl: signUrl(camera.streamUrl, record.token),
  revision: record.revision,
  refreshAt: new Date(record.refreshAt).toISOString()
}
~~~

Replace the comment-only router body with complete method, path, body-size, schema, response-header, and error handling. Do not accept an upstream URL or token in any request.

- [ ] **Step 4: Authenticate API routes before routing**

Create pure `worker/router.js` with:

~~~js
import { requireAccessJwt } from "./access-jwt.js";
import { handlePlaybackApi } from "./playback-api.js";

export function createWorker({
  authenticate = requireAccessJwt,
  playbackApi = handlePlaybackApi
} = {}) {
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === "/api" || path.startsWith("/api/")) {
        try {
          await authenticate(request, env);
        } catch {
          return Response.json(
            { error: "Access denied" },
            {
              status: 403,
              headers: {
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff"
              }
            }
          );
        }
        return playbackApi(request, env);
      }
      return env.ASSETS.fetch(request);
    }
  };
}
~~~

`worker/router.js` exports only the factory. Replace temporary `worker/index.js` with the Workerd composition root:

~~~js
import { createWorker } from "./router.js";

export { MeoTokenCoordinator } from "./meo-token-coordinator.js";

export default createWorker();
~~~

This intentionally keeps the Node-tested router free of `cloudflare:workers`, authenticates unknown `/api` routes before returning their JSON 404, and uses normal static 404 behavior for unknown assets.

- [ ] **Step 5: Add a harmless bootstrap configuration and local scripts**

Create `worker/bootstrap.js`:

~~~js
export default {
  async fetch() {
    return Response.json(
      { error: "Service unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  }
};
~~~

Create `wrangler.bootstrap.jsonc`:

~~~jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "surfcams-portugal",
  "main": "worker/bootstrap.js",
  "compatibility_date": "2026-08-19",
  "workers_dev": true,
  "preview_urls": false
}
~~~

Add scripts:

~~~json
{
  "scripts": {
    "cf:bootstrap": "wrangler deploy --config wrangler.bootstrap.jsonc",
    "deploy": "wrangler deploy --config wrangler.jsonc"
  }
}
~~~

- [ ] **Step 6: Reach API and routing GREEN**

Run:

~~~bash
node --test test/worker/playback-api.test.js test/worker/bootstrap.test.js test/worker/index.test.js test/runtime-package.test.js
npm run build
npm run test:worker
~~~

Expected: pure API/router/bootstrap tests pass; Workerd validates the real Access JWT/JWKS path and Durable Object with only explicitly mocked outbound requests; no caller-supplied URL appears in a response.

- [ ] **Step 7: Verify and commit**

Run:

~~~bash
node --test test/worker/playback-api.test.js
npm test
npm run build
npm run check:worker
git diff --check
git add package.json worker/bootstrap.js worker/index.js worker/playback-api.js worker/router.js wrangler.bootstrap.jsonc test/runtime-package.test.js test/worker/bootstrap.test.js test/worker/index.test.js test/worker/playback-api.test.js test/workerd/worker-routing.test.js
git commit -m "feat: serve authenticated MEO playback"
~~~

Expected: every test and dry-run passes; the bootstrap and functional configs target the same Worker name.

## Task 7: Build one memory-only browser playback client

**Files:**

- Create: `src/playback-client.js`
- Create: `test/playback-client.test.js`

- [ ] **Step 1: Write the browser-client contract and capture RED**

Test the exact public API:

~~~js
const client = createPlaybackBrokerClient({
  fetcher,
  now: () => now,
  basePath: "/api/playback"
});

await client.resolve("costa-da-caparica-riviera");
await client.refresh("costa-da-caparica-riviera", "revision-1");
~~~

Cover:

- GET path uses `encodeURIComponent(cameraId)`, `credentials: "same-origin"`, `cache: "no-store"`, and `Accept: application/json`;
- response camera ID must match the request;
- URL string must contain no leading/trailing whitespace or control character and must be exact HTTPS `video-auth1.iol.pt` approved HLS path with no credentials, port, or hash;
- `wmsAuthSign` must be the sole query key, occur exactly once, and have a non-empty value; duplicate keys and any extra query key are rejected;
- revision is an opaque non-empty bounded string and `refreshAt` is a future ISO timestamp;
- the original `playlistUrl` string is returned unchanged after validation;
- a cached response is reused before `refreshAt` and fetched again at or after it; reads do not slide expiry;
- concurrent resolves for one camera share one request;
- POST uses exact body `{ "failedRevision": failedRevision }` and exact JSON headers;
- refresh immediately evicts all cached camera records carrying the failed revision;
- concurrent refreshes for the same revision share one POST globally; a different camera waits for that revision barrier and then performs its own GET so the returned camera ID/URL still match;
- a refresh response must carry a revision different from `failedRevision`;
- every network GET captures a monotonic global refresh epoch; if any refresh starts before that GET settles, its response is never cached or returned, even after arbitrarily many later refreshes;
- a stale-epoch resolve waits for active refresh barriers and performs one fresh GET; if the epoch changes again, it fails generically rather than returning stale media;
- if refresh R1 succeeds, a deferred R1 GET cannot resurrect R1 and the fresh GET returns R2;
- if refresh R1 fails, its barrier and cache entry clear without permanently banning R1: an explicit new player generation may resolve R1 again, encounter a media failure, and issue a new refresh attempt;
- a failed resolve or refresh clears its in-flight entry so the next explicit attempt performs a new request rather than reusing a rejected promise;
- non-2xx, oversized/invalid JSON, malformed fields, fetch rejection, or a 15-second request timeout produce one generic `PlaybackBrokerError` without response body, signed URL, revision, or query;
- no local/session storage is touched; the only timer is the per-request timeout, which is always cleared on settlement.

Run:

~~~bash
node --test test/playback-client.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Implement validation, cache, and coalescing**

Create `src/playback-client.js`. Its error type is:

~~~js
export class PlaybackBrokerError extends Error {
  constructor() {
    super("Playback unavailable");
    this.name = "PlaybackBrokerError";
  }
}
~~~

Also export `createPlaybackBrokerClient({ fetcher, now, basePath, requestTimeoutMs })`, defaulting to global `fetch`, `Date.now`, `/api/playback`, and 15 seconds. The returned object exposes only `resolve(cameraId)` and `refresh(cameraId, failedRevision)`.

Implement the tested validation, memory cache, expiry, resolve coalescing, one global in-flight refresh barrier per failed revision, revision-wide eviction, a monotonic `refreshEpoch`, a 16 KiB streaming JSON-response limit, bounded request timeout, and redacted error conversion. Increment `refreshEpoch` synchronously before every new refresh POST. Every GET captures the epoch immediately before fetch; after parsing, it may cache/return only if the epoch is unchanged and no refresh is active. Otherwise wait for active refreshes and perform one new GET at the current epoch; if that attempt also becomes stale, fail generically. This invariant has no finite revision-history window.

On a successful refresh, require a different revision and return/cache only the replacement record. On a failed refresh, leave the failed revision evicted but remove its in-flight barrier and do not retain a permanent retired marker; this lets a later explicit player generation resolve the still-current server record and spend its own refresh budget. A second camera refreshing the same revision waits for the shared POST and then resolves its own path with GET. Use an internal timeout `AbortController` for each shared network operation, but never abort shared work merely because one player clears; player generation checks make a late shared result inert. Do not expose cache-clear/debug/token APIs.

- [ ] **Step 3: Verify and commit**

Run:

~~~bash
node --test test/playback-client.test.js
npm run test:app
git diff --check
git add src/playback-client.js test/playback-client.test.js
git commit -m "feat: resolve signed playback in memory"
~~~

Expected: all client and app tests pass; the commit contains exactly two files.

## Task 8: Make the shared player resolve signed media and recover once

**Files:**

- Modify: `src/video-player.js`
- Modify: `test/video-player.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Adapt the player harness and capture the direct-source RED**

In `test/video-player.test.js`, stop importing `createVideoPlayer` and add:

~~~js
function playbackClientStub({
  resolvedUrl = "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8?wmsAuthSign=signed",
  revision = "revision-1"
} = {}) {
  const calls = [];
  return {
    calls,
    async resolve(cameraId) {
      calls.push(["resolve", cameraId]);
      return {
        cameraId,
        playlistUrl: resolvedUrl,
        revision,
        refreshAt: "2099-01-01T00:00:00.000Z"
      };
    },
    async refresh(cameraId, failedRevision) {
      calls.push(["refresh", cameraId, failedRevision]);
      return {
        cameraId,
        playlistUrl: resolvedUrl.replace("signed", "replacement"),
        revision: "revision-2",
        refreshAt: "2099-01-01T00:00:00.000Z"
      };
    }
  };
}
~~~

Update every `createFeedTilePlayer` test to inject `playbackClient` and use a camera that deliberately contains a different unsigned `streamUrl`. Assert native `video.src` and HLS.js `loadSource` receive only the client response.

Add a deferred-resolve replacement test: while camera A is playing, `play(cameraB)` must synchronously pause/detach A, apply B’s poster/loading label, and leave no media source attached until B’s broker response arrives. This prevents Explore or a replaced Focus pane from showing new metadata over an old beach feed.

Add a source contract:

~~~js
assert.doesNotMatch(videoPlayerSource, /camera\.streamUrl/);
assert.doesNotMatch(videoPlayerSource, /export function createVideoPlayer/);
assert.match(videoPlayerSource, /playbackClient\.resolve\(camera\.id\)/);
assert.match(videoPlayerSource, /playbackClient\.refresh\(camera\.id,\s*failedRevision\)/);
~~~

Run:

~~~bash
node --test test/video-player.test.js test/source-safety.test.js
~~~

Expected RED: the current constructor ignores `playbackClient`, assigns `camera.streamUrl`, and exports the legacy player.

- [ ] **Step 2: Specify fatal recovery before implementation**

Add focused native and HLS.js tests for this state machine:

| Event | Same explicit generation | Result |
|---|---:|---|
| broker resolve succeeds | yes | attach exact signed URL |
| autoplay rejects | yes | `blocked`; no refresh |
| first current native `error` | yes | refresh once and attach replacement |
| first current HLS.js `data.fatal` | yes | refresh once and attach replacement |
| a second fatal event | yes | `unavailable`; no second refresh |
| manual Retry through `play(camera)` | new | one new refresh budget |
| broker/HLS loader fails before media attachment | yes | `unavailable`; no refresh |
| `clear`, `expire`, or camera replacement | new | every late resolve/refresh/event is inert |

Include initial-load fatal errors, later errors after `playing`, duplicate stale handlers, failure during pending `resume()`, refresh rejection, replacement autoplay blocking, and two independent players where one failure never changes the other.

Add the full failed-refresh recovery chain: generation 1 resolves R1, its fatal event calls refresh and the POST rejects; explicit Retry creates generation 2, may resolve the server-preserved R1 again, and its own fatal event is allowed to call refresh once. The client/player combination must not wedge that camera behind a permanent retired-revision marker.

For both native HLS and HLS.js, add a controllable initial-load test in which the original autoplay/source attempt is still pending when the first fatal event starts replacement. Resolving or rejecting that old attempt must be inert, the public `play(camera)` promise must remain pending, and it must settle only from the replacement attempt’s final `playing`, `blocked`, or `unavailable` state.

Run the focused test again. Expected RED on the new recovery cases.

- [ ] **Step 3: Implement two-level generation safety**

Change the public signature to `createFeedTilePlayer({ video, status, playbackClient, hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL, onStateChange = () => {} })` and keep its returned `{ clear, expire, play, resume, state }` object.

Implement the existing player behavior with these invariants:

- `generation` advances on explicit `play`, `clear`, and `expire`;
- `sourceAttempt` advances every time the same generation attaches a resolved or refreshed URL;
- each explicit generation starts with `forcedRefreshUsed = false`;
- `play(camera)` requires only a non-empty `camera.id`, synchronously resets any old media and applies the new poster/loading state, then calls `playbackClient.resolve(camera.id)` before attaching any new source;
- the current resolved `revision` stays only in the player closure;
- the first current fatal media event marks `forcedRefreshUsed` before awaiting, moves to `loading` with label `Refreshing feed`, detaches the failed native/HLS source, calls `refresh`, and attaches the replacement under a new `sourceAttempt`;
- a second fatal event or failed replacement becomes `unavailable`;
- every callback and promise settlement checks both levels where applicable;
- `video.src` and `hls.loadSource` receive the returned `playlistUrl` byte-for-byte;
- autoplay rejection is `blocked` and does not call refresh;
- `resume()` remains synchronous to the click stack; if a fatal event starts recovery while its promise is pending, its final result follows the current replacement attempt rather than a stale `playing` settlement.

Remove the entire unused `createVideoPlayer` implementation and export. Preserve gesture reset, HLS script retry, native handler cleanup, pane-local state labels, and public `{ clear, expire, play, resume, state }` API.

- [ ] **Step 4: Verify no unsigned player path remains**

Run:

~~~bash
node --test test/video-player.test.js test/source-safety.test.js
rg -n "camera\.streamUrl" src/video-player.js
rg -n "video\.src\s*=\s*camera|loadSource\(camera" src index.html
git diff --check
~~~

Expected: all focused tests pass; both `rg` commands return no browser playback assignment. Feed policy, catalog, recommendations, and UI availability checks may still contain legitimate immutable `streamUrl` reads outside `src/video-player.js`.

- [ ] **Step 5: Commit**

Run:

~~~bash
git add src/video-player.js test/video-player.test.js test/source-safety.test.js
git commit -m "feat: recover signed MEO playback once"
~~~

Expected: exactly three files committed.

## Task 9: Start gallery time on playback and wire every UI surface

**Files:**

- Modify: `src/feed-lifecycle.js`
- Modify: `test/feed-lifecycle.test.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `src/styles/app.css`
- Modify: `test/index.test.js`
- Modify: `test/source-safety.test.js`
- Modify: `test/runtime-ux-regressions.test.js`
- Modify: `test/explore-information-source.test.js`
- Modify: `test/spot-advice-subjects.test.js`

- [ ] **Step 1: Prove broker latency does not consume the gallery minute**

Add controllable-promise tests to `test/feed-lifecycle.test.js`:

~~~js
test("gallery starts its exact minute only after playback reaches playing", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);

  assert.equal(session.state(), "loading");
  assert.deepEqual(timers.scheduledDelays, [0]);
  assert.equal(timers.pendingCount(), 0);

  player.resolveNext("playing");
  await Promise.resolve();

  assert.equal(session.state(), "playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);
  assert.equal(timers.pendingCount(), 1);
});
~~~

Also test:

- pending resolve followed by hide/clear never schedules expiry or resurrects;
- blocked/unavailable initial settlement has no timer and remains retryable;
- a midstream player `loading` notification keeps the already-running deadline;
- successful midstream token replacement does not reset or extend that deadline;
- midstream autoplay blocking keeps the original deadline; manual resume uses only its remaining time and does not grant a second minute;
- terminal unavailable during recovery cancels the deadline;
- expiry during pending recovery calls `player.expire()` and makes its late settlement inert;
- manual resume from blocked starts a fresh exact 60 seconds;
- Focus/Compare remain outside this session entirely.

Run:

~~~bash
node --test test/feed-lifecycle.test.js
~~~

Expected RED: current `start()` sets `playing` and schedules 60 seconds before `player.play()` settles.

- [ ] **Step 2: Move the timer to successful settlement**

In `src/feed-lifecycle.js`:

- make `start()` set `currentState = "loading"` before `player.play(camera)`;
- do not create the duration timer there;
- in `settlePlay`, when the current result is `playing`, set state and schedule exactly one `durationMs` expiry;
- track whether a preview window has started separately from the visible player state;
- leave the already-running timer and its generation token untouched when `reconcilePlayerState("loading")` reports a midstream token replacement;
- if that replacement becomes `blocked`, keep the original timer active and make `resume()` use the existing generation/deadline rather than canceling or rescheduling it;
- make expiry stop the player while that active window is `playing`, recovering, `blocked`, or resuming;
- cancel the active timer if recovery becomes `unavailable`; an explicit Retry then starts a new preview generation;
- preserve existing zero-delay start coalescing, visibility, retry, resume, restart, and generation behavior.

Run the focused lifecycle test. Expected GREEN.

- [ ] **Step 3: Add integration/source contracts and capture RED before wiring**

Update the listed integration tests to prove:

- exactly one `createPlaybackBrokerClient()` call exists;
- every `createFeedTilePlayer` call flows through `createAppFeedPlayer` with the shared client;
- no production player in `src/video-player.js` directly loads `camera.streamUrl`;
- gallery still starts only through its visibility session;
- Focus/Compare contain no gallery session or 60-second timer;
- Favorites enters the shared Focus path and does not fetch merely by rendering;
- Explore passes the resolved MEO camera identity;
- hidden/pagehide cleanup and BFCache/visibility restoration create a fresh player generation;
- the Settings logout link has the exact relative Access endpoint, descriptive text, and no script interception;
- the accepted Focus/Compare, Favorites, Explore, mobile, safe-area, focus, Retry, and fullscreen contracts remain intact.

Run:

~~~bash
node --test test/index.test.js test/source-safety.test.js test/runtime-ux-regressions.test.js test/explore-information-source.test.js test/spot-advice-subjects.test.js
~~~

Expected RED: the shared client/wrapper and logout surface do not exist yet. Existing retained-feature assertions stay green.

- [ ] **Step 4: Add one shared broker client to the application**

At `src/main.js` imports, add:

~~~js
import { createPlaybackBrokerClient } from "./playback-client.js";
~~~

Create exactly one module-level instance and one wrapper:

~~~js
const playbackClient = createPlaybackBrokerClient();

function createAppFeedPlayer(options) {
  return createFeedTilePlayer({
    ...options,
    playbackClient
  });
}
~~~

Replace all three direct constructors with the wrapper:

- persistent Explore player;
- each Focus/Compare pane;
- each gallery tile.

Do not create a separate Favorites player. “Open large” from Favorites must continue through the same Focus path. Informational Explore subjects must resolve their native MEO `playbackCamera` before `player.play(playbackCamera)`. Keep existing pagehide, visibility, BFCache, route, replacement, and removal cleanup.

- [ ] **Step 5: Add the protected-origin logout action**

In the Configure screen in `index.html`, after the feedback tools and before the final status line, add:

~~~html
<section class="access-tools" aria-labelledby="accessToolsTitle">
  <div>
    <h2 id="accessToolsTitle">Access</h2>
    <p>Sign out of this private Surfcams session on this device.</p>
  </div>
  <a class="secondary-button access-logout" href="/cdn-cgi/access/logout">Sign out</a>
</section>
~~~

Style `.access-tools` consistently with `.feedback-tools` and give `.access-logout` a 44px minimum hit target at the existing mobile breakpoint. Do not add a fifth bottom-navigation item or app-owned account settings.

- [ ] **Step 6: Reach the application integration GREEN**

Run the focused command from Step 3 again. Expected: all shared-client, lifecycle, Explore, logout, accessibility, and retained-UX contracts pass.

- [ ] **Step 7: Run the complete retained-feature gate**

Run:

~~~bash
npm test
npm run check-spot-advice
node --check src/main.js
node --check src/video-player.js
git diff --check
~~~

Expected: every Node and Workerd test passes and all checks exit 0.

- [ ] **Step 8: Commit**

Run:

~~~bash
git add index.html src/feed-lifecycle.js src/main.js src/styles/app.css test/explore-information-source.test.js test/feed-lifecycle.test.js test/index.test.js test/runtime-ux-regressions.test.js test/source-safety.test.js test/spot-advice-subjects.test.js
git commit -m "feat: share signed playback across every view"
~~~

Expected: the commit contains only the Task 9 files.

## Task 10: Add a redacted live probe, release gates, and operator runbooks

**Files:**

- Create: `scripts/probe-meo-signed-streams.js`
- Create: `test/meo-signed-probe.test.js`
- Modify: `package.json`
- Modify: `.github/workflows/validate.yml`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `SECURITY.md`
- Modify: `docs/architecture.md`
- Create: `docs/runbooks/cloudflare-access.md`
- Create: `docs/runbooks/cloudflare-release.md`

- [ ] **Step 1: Test probe parsing and redaction without network**

Create `test/meo-signed-probe.test.js` with fixtures for a signed master, relative signed child, and signed segment. Test the exact exports `parseHlsUris(manifestText)`, `resolveHlsUri(parentUrl, childReference)`, `publicProbeResult(result)`, and `probeSignedStreams(options)`.

The tests must prove:

- only non-comment HLS URI lines are returned;
- relative URIs resolve against the parent without stripping either authorization query;
- master and child must return 200 with HLS playlist MIME/content; the segment probe must send `Range: bytes=0-1023`, receive 206 with a media/transport-stream MIME, and all three responses must satisfy the expected permissive CORS check;
- every retained master is attempted and roster concurrency is bounded to three;
- a master is retried exactly once only after a first camera-local signed 404
  with the authorization query present and valid CORS; the retry reuses the
  same token and signed master URL;
- after retries, valid status-200 HLS masters must meet the integer 90% floor,
  and only final camera-local signed 404 outcomes may consume the remaining
  allowance;
- a status 0/401/403, redirect, missing authorization or CORS, invalid 200
  MIME/body, timeout/network error, 5xx, or other status is a hard failure
  regardless of the ratio;
- 2/2 representative chains, one from each MEO namespace, must complete;
- a timeout or other hard failure is contained to that camera so the remaining
  roster is still attempted, but remains a hard release failure;
- `publicProbeResult` exposes only camera ID, phase, status, duration, and Boolean authorization/CORS checks;
- the top-level summary exposes only bounded counts/ratio for total, required,
  successful, tolerated-404, retried, recovered, hard-failure, and
  representative-chain outcomes;
- JSON/text output contains no token, full URL, query, `wmsAuthSign`, `nimblesessionid`, response body, or request headers.

Run:

~~~bash
node --test test/meo-signed-probe.test.js
~~~

Expected RED: module not found.

- [ ] **Step 2: Implement the manual acceptance probe**

Create `scripts/probe-meo-signed-streams.js`. It must:

1. derive the full native playable roster through `resolveMeoPlaybackCameras`;
2. acquire a temporary token with `fetchMeoToken` only in memory;
3. sign each immutable master URL with `signMeoPlaylistUrl`;
4. probe every master at concurrency three with bounded timeouts;
5. after a first master attempt returns a camera-local signed 404 with its
   authorization query present and valid CORS, retry the same signed master URL
   exactly once with the same in-memory token; do not retry any other outcome;
6. probe master → first child → first segment for deterministic representative IDs from both `/auth-beachcam/` and `/beachcam/` namespaces, sending exactly `Range: bytes=0-1023` for that segment;
7. require 200 HLS MIME/content for master/child, 206 plus a segment media/transport-stream MIME for the bounded segment response, and permissive CORS throughout the chain;
8. after retries, require `masterSucceeded * 10 >= masterTotal * 9` (an
   integer 90% floor: 139 successes for a 154-camera roster); only final
   camera-local signed 404 results with authorization and CORS may be tolerated
   within that floor;
9. treat status 0/401/403, redirects, missing authorization or CORS, invalid
   200 MIME/body, timeout/network failure, 5xx, and every other status as a hard
   failure regardless of the ratio;
10. require 2/2 representative chains to complete and fail closed when either
    namespace representative is absent or unavailable;
11. print only the final six-field redacted camera/phase results plus bounded
    aggregate counts and ratio, including retried and recovered counts; and
12. exit nonzero unless the 90% floor, zero-hard-failure veto, and 2/2 chain
    gate all pass.

This script is an owner-run release acceptance tool. It must not run in GitHub CI and must never write the token or signed URL to disk.

Run only the fixture test now. Expected GREEN.

- [ ] **Step 3: Define one local/CI verification command**

Add these scripts while preserving every existing script:

~~~json
{
  "scripts": {
    "check:conditions": "node scripts/check-conditions-freshness.js",
    "probe:meo-signed": "node scripts/probe-meo-signed-streams.js",
    "verify": "npm run build && npm test && npm run check-spot-advice && npm run check:worker",
    "verify:fresh": "npm run verify && npm run check:conditions"
  }
}
~~~

`verify` is the deterministic clean-checkout CI/Workers-Build gate. The six-hour wall-clock check cannot gate every push: the unchanged Surfline schedule has an overnight gap, and the 04:23 tide bot normally runs before the 05:17 conditions refresh. `verify:fresh` is the stricter release/live-acceptance gate. The same freshness script remains called directly by the unchanged Surfline refresh workflow; do not weaken the threshold or change either scheduled workflow.

- [ ] **Step 4: Upgrade only the validation workflow**

Replace the test steps in `.github/workflows/validate.yml` with:

~~~yaml
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version-file: .node-version
          cache: npm
      - name: Install locked dependencies
        run: npm ci
      - name: Verify release
        run: npm run verify
~~~

Keep the existing triggers, permissions, pinned checkout action, and job. Do not add live MEO/Surfline network probes.

Verify the scheduled workflow is untouched:

~~~bash
git diff --exit-code 084bad9 -- .github/workflows/update-surfline-conditions.yml
git hash-object .github/workflows/update-surfline-conditions.yml
~~~

Expected: no diff; hash is `83444c23091be79bc735c3d54391efe6a70a4b7a` unless a later accepted `origin/main` commit intentionally changed that workflow outside this migration.

- [ ] **Step 5: Write the operator documentation**

Update the docs with concrete, non-secret instructions:

- `README.md`: private Worker hosting, `npm ci`, `npm run verify`, `npm run dev` limitations, and the unchanged Surfline data-refresh boundary;
- `CLAUDE.md`: Node 22, commands, Worker file layout, secret-handling prohibitions, and no live probes in CI;
- `SECURITY.md`: Access defense in depth, exact-email authorization, signed-URL exposure window, token/log redaction, and revocation limits;
- `docs/architecture.md`: Access → Worker → API → named Durable Object → MEO token → direct browser/CDN sequence, plus Surfline intelligence separation;
- `docs/runbooks/cloudflare-access.md`: Google External consent-screen/In-production setup, IdP callback, Testing-mode seven-day warning, exact-email add/remove, seven-day Access session, session revocation, logout, optional exact-email PIN fallback, and anonymous-interception checks;
- `docs/runbooks/cloudflare-release.md`: bootstrap, secrets, protected staging, immutable candidate record, frozen `codex/pages-legacy-hold` source, Workers Builds, bot-commit validation, rollback, Pages shutdown, and emergency re-enable;
- reference the already-approved design without changing it.

The runbooks must explicitly state:

- Google OAuth client secret exists only in Cloudflare Access;
- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker secrets;
- an already-issued MEO URL may remain usable for the observed maximum of 24 hours after Access revocation;
- first release starts with fresh local defaults at the new origin;
- no Durable Object Preview URL exists;
- rollback does not roll back Durable Object storage;
- the first safe rollback target is the accepted functional version, never the pre-Durable-Object bootstrap.

- [ ] **Step 6: Run release checks except any externally stale-data gate**

Run:

~~~bash
node --test test/meo-signed-probe.test.js
npm test
npm run check-spot-advice
npm run build
npm run check:worker
git diff --check
~~~

Expected: all local deterministic checks pass. Run `npm run check:conditions` too; if it reports data older than six hours, record that expected external freshness blocker for Task 11 rather than changing code or committed data manually.

- [ ] **Step 7: Commit**

Run:

~~~bash
git add .github/workflows/validate.yml CLAUDE.md README.md SECURITY.md docs/architecture.md docs/runbooks/cloudflare-access.md docs/runbooks/cloudflare-release.md package.json scripts/probe-meo-signed-streams.js test/meo-signed-probe.test.js
git commit -m "docs: operationalize private Worker releases"
~~~

Expected: commit succeeds; scheduled Surfline workflow remains byte-for-byte unchanged.

## Task 11: Establish and record the immutable accepted candidate

**Files:**

- Merge only: latest accepted `origin/main` commits
- Generated locally, ignored: `dist/` and `.wrangler/`
- Do not manually edit: `data/surfline-conditions.json`

- [ ] **Step 1: Synchronize the latest production data before acceptance**

Run with network access:

~~~bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
~~~

If the second command exits nonzero, merge current production before recording a candidate:

~~~bash
git merge --no-edit origin/main
npm run verify
~~~

Expected: merge conflicts, if any, are resolved without dropping either the accepted MEO migration or newer bot data; deterministic `verify` passes. Step 2 separately establishes release freshness.

- [ ] **Step 2: Make the unchanged Surfline pipeline produce or confirm fresh data**

Run:

~~~bash
npm run check:conditions
~~~

If it is stale, dispatch the existing workflow without editing it:

~~~bash
DISPATCHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
gh workflow run update-surfline-conditions.yml --ref main
SURFLINE_RUN_ID=""
for attempt in {1..20}; do
  SURFLINE_RUN_ID=$(gh run list --workflow update-surfline-conditions.yml --event workflow_dispatch --branch main --limit 10 --json databaseId,createdAt --jq "map(select(.createdAt >= \"$DISPATCHED_AT\")) | sort_by(.createdAt) | last | .databaseId // empty")
  [[ -n "$SURFLINE_RUN_ID" ]] && break
  sleep 3
done
[[ -n "$SURFLINE_RUN_ID" ]]
gh run watch "$SURFLINE_RUN_ID" --exit-status
git fetch origin
git merge --no-edit origin/main
~~~

Expected: either the existing data was already fresh or the newly dispatched run—not an older run—succeeded and its accepted commit is now in the branch. If a run succeeds but produces no commit, wait for the next data-changing run rather than hand-editing `generatedAt`.

- [ ] **Step 3: Run every local and live acceptance gate**

Run:

~~~bash
npm ci
npm run verify:fresh
npm run probe:meo-signed
git diff --check
git status --porcelain
~~~

Expected:

- every Node and Workerd test passes;
- advice, freshness, deterministic asset, and Worker dry-run checks pass;
- the complete accepted MEO roster is attempted at concurrency no greater than
  three, and a first eligible camera-local signed 404 causes one retry of the
  same signed URL and token;
- after the retry, `masterSucceeded * 10 >= masterTotal * 9`: the integer 90%
  floor requires at least 139 of the current 154 masters and permits at most 15
  final camera-local signed 404 outcomes with authorization and CORS intact;
- status 0/401/403, a redirect, authorization/CORS failure, invalid 200
  MIME/body, timeout/network failure, 5xx, or any other status is a hard failure
  regardless of the ratio;
- 2/2 representative chains, one deterministic
  master→child→ranged-segment chain from each namespace, pass;
- output contains only final six-field per-phase results and the fixed sanitized
  aggregate counts/ratio; no attempt-level URL, token, query, header, body, or
  error is exposed;
- `git diff --check` exits 0;
- worktree is clean.

Final eligible 404s are camera-local availability evidence, not catalog
identity failures. Keep every official MEO identity in the catalog and runtime
roster; do not quarantine, delete, or substitute a camera because of this
bounded acceptance exception. If the floor, hard-failure veto, or either
representative chain fails, do not release. Diagnose the provider/token/feed
identity with superpowers:systematic-debugging; never substitute another beach
or Surfline camera media.

- [ ] **Step 4: Record the immutable candidate**

Run:

~~~bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
shasum -a 256 dist/asset-manifest.json
git hash-object .github/workflows/update-surfline-conditions.yml
~~~

Create/update `.wrangler/private-meo-release-record.md` with these four labeled values plus the protected Worker hostname placeholder. Expected:

- candidate commit and tree are non-empty Git object IDs;
- the deterministic manifest has one SHA-256 digest;
- the Surfline workflow blob remains `83444c23091be79bc735c3d54391efe6a70a4b7a` unless an independently accepted production change altered it;
- no source or data edit occurs after these values are recorded.

Also copy only the probe's sanitized aggregate summary into the candidate
record: `masterTotal`, `masterRequired`, `masterSucceeded`,
`masterTolerated404`, `masterRetried`, `masterRecovered`,
`masterHardFailures`, `masterSuccessRatio`,
`representativeChainsRequired`, and `representativeChainsSucceeded`. Candidate
evidence must show 2/2 representative chains. Do not copy per-camera results,
attempt details, URLs, queries, headers, bodies, tokens, or errors into the
record.

The working record is ignored local release state, not a source change. It will later also hold the candidate/production Worker version IDs, accepted main SHA/tree, bot SHA/deployment, rollback proof, Pages result, and emergency hold branch. Never add identities or secrets.

## Task 12: Bootstrap Cloudflare Access and accept the protected candidate

**Files:**

- Repository changes: none
- External state: Cloudflare Worker `surfcams-portugal`, Google OAuth client, Cloudflare Access IdP/application/policy, two Worker secrets, initial Durable Object namespace

- [ ] **Step 1: Authenticate the owner and deploy only the harmless bootstrap**

Run:

~~~bash
npm exec -- wrangler whoami
npm run cf:bootstrap
~~~

If `whoami` is not authenticated, run `npm exec -- wrangler login` through the owner’s browser and repeat. Expected: the `surfcams-portugal` Worker hostname returns only bounded 503 JSON and exposes no app, data, API, token, or Durable Object.

- [ ] **Step 2: Configure Google as the Access identity provider**

In Google Cloud:

1. Create or select the owner’s OAuth project.
2. Configure the OAuth consent screen first: app name, user-support email, developer contact email, and **External** audience. Request only the basic identity scopes Cloudflare's Google connector needs; do not add a sensitive or restricted scope.
3. Move the OAuth app to **In production** before family acceptance so ordinary approved consumer Google accounts are not subject to Testing-mode's explicit test-user list and seven-day grant expiry. If Google blocks production pending a required console/brand step, complete that step; do not silently ship a seven-day Testing-mode login as the final configuration.
4. Create a Web application OAuth client.
5. Use the Cloudflare Access team origin as the authorized JavaScript origin.
6. Use that same origin plus `/cdn-cgi/access/callback` as the redirect URI.
7. Copy the client ID and secret directly into Cloudflare Zero Trust’s Google identity-provider form.
8. Do not put either value in the repository, terminal history, Worker bindings, or GitHub.

Expected: the Google console shows External/In production with basic identity scopes; Cloudflare’s IdP test succeeds independently for the owner and the intended second consumer account before either account is used to validate the Access allowlist. If a temporary Testing-mode setup is unavoidable during configuration, add both exact accounts as Google test users, record the seven-day grant limitation, and keep production acceptance blocked until In production succeeds.

- [ ] **Step 3: Protect the complete Worker hostname**

In Cloudflare Zero Trust:

1. Create a self-hosted Access application covering the complete Worker hostname.
2. Set application and policy session duration to seven days.
3. Create one Allow policy whose Include rules are the exact approved email addresses.
4. Require the configured Google login method.
5. Do not add Everyone, all Google users, a domain wildcard, country-only allow, or Bypass.
6. Leave email PIN disabled unless a named approved person requires it; if enabled, keep the same exact-email Include restriction.

Use a private/incognito browser to request both the root and a known `/api/playback/<camera-id>` path. Expected: Cloudflare Access intercepts both before the bootstrap runs.

- [ ] **Step 4: Configure the Worker’s defense-in-depth values**

From the Access dashboard, obtain the normalized team-domain origin and application audience tag. Set each interactively so the value is not included in shell history:

~~~bash
npm exec -- wrangler secret put ACCESS_TEAM_DOMAIN
npm exec -- wrangler secret put ACCESS_AUD
~~~

Expected: Wrangler confirms both secrets for `surfcams-portugal`. The Google OAuth secret remains exclusively in the Access IdP.

- [ ] **Step 5: Deploy the exact recorded functional candidate**

Before deployment, re-check:

~~~bash
git status --porcelain
git rev-parse HEAD
git rev-parse HEAD^{tree}
npm run build
shasum -a 256 dist/asset-manifest.json
npm run deploy
~~~

Copy the exact candidate Worker version ID printed by Wrangler, then inspect that exact deployment rather than inferring bindings from the version list:

~~~bash
CANDIDATE_VERSION_ID="<exact ID printed by wrangler deploy>"
npm exec -- wrangler versions view "$CANDIDATE_VERSION_ID" --json
~~~

Expected: worktree clean; build output prints the same manifest digest recorded in Task 11; commit, tree, and digest exactly match; the viewed candidate version contains binding `MEO_TOKEN_COORDINATOR` with class `MeoTokenCoordinator`; the protected hostname serves the candidate only after Access login. Add the protected hostname and exact candidate version ID to `.wrangler/private-meo-release-record.md` without copying any binding value or secret.

- [ ] **Step 6: Exercise authorization and revocation with a second account**

Verify in the Cloudflare dashboard and real browsers:

1. owner account can sign in and the Access log shows its exact email;
2. an unlisted Google account is denied;
3. adding the second account’s exact email allows it;
4. removing that email prevents a new session;
5. revoking its current Access session terminates active application access;
6. the app’s Settings → Sign out action completes Cloudflare logout;
7. re-add the second account only if it remains an intended approved user.

Record the accepted limitation: a signed MEO URL already copied by an authorized person may remain usable for the provider’s currently observed maximum of 24 hours.

- [ ] **Step 7: Complete desktop and physical-iPhone acceptance**

On desktop and physical iPhone Safari, including portrait, landscape, and a fresh Add-to-Home-Screen install, verify:

- fresh default favorites/preferences are expected on the new origin;
- unlimited Favorites, Add camera, Remove, Undo, and focus recovery;
- playable-camera-only search and provider-native MEO names/locations;
- gallery begins its exact 60 seconds only after Playing and stops at expiry;
- Focus and Compare continue playing beyond 60 seconds;
- one- and two-camera replacement, removal, Retry, gestures, fullscreen, and failed-fullscreen recovery;
- Explore information subjects resolve the correct MEO view; map/detail emphasis, clusters, Retry, and Expand Map retain focus;
- Surfline conditions, ratings, forecasts, and advice remain visible without Surfline HLS or still requests;
- safe areas, 44px targets, bottom navigation, dialogs, toast, and landscape notch handling;
- browser network contains protected playback API calls followed by direct signed MEO HLS, never a Surfline camera-media host;
- blocking the first signed media load causes exactly one refresh POST and pane-local recovery;
- a repeated fatal failure becomes local Feed unavailable with actionable Retry;
- initial Safari autoplay blocking is recoverable through the synchronous pane-local Play action;
- midstream replacement autoplay blocking preserves only the gallery’s original remaining time;
- Safari background/foreground and BFCache back/forward restoration restart the correct Gallery, Focus/Compare, and Explore generation exactly once;
- A2HS background/foreground restoration does not duplicate or resurrect an old camera;
- page hide, route exit, replacement, and gallery expiry never allow a late broker/refresh result to resurrect playback;
- fullscreen and video gesture controls remain usable after every restoration path.

If any source, data, or configuration file must change, return to the relevant TDD task, commit it, repeat Task 11, redeploy, and repeat all acceptance. Do not advance with an unrecorded candidate.

## Task 13: Promote the exact tree and prove automated bot deployment

**Files:**

- Repository changes: none after accepted candidate
- External state: GitHub feature/hold/main branches, GitHub Pages source, pull request, Cloudflare Workers Builds GitHub App and production settings

- [ ] **Step 1: Close the scheduled-commit race**

Immediately before pushing:

~~~bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
~~~

Expected: exit 0. If it fails, merge latest `origin/main`, rerun all Task 11 checks, record a new commit/tree/digest, redeploy, and reaccept Task 12. Do not promote the old record.

- [ ] **Step 2: Push the branch and require GitHub validation**

Run:

~~~bash
git push origin codex/meo-only-cameras
gh pr create --base main --head codex/meo-only-cameras --title "feat: deploy private signed MEO playback" --body "Moves Surfcams to a Google-protected Cloudflare Worker, retains Surfline intelligence, and resolves provider-native MEO playback through the reviewed token broker."
gh pr checks --watch
~~~

If the PR already exists, inspect it with `gh pr view` instead of creating another. Expected: the Validate workflow runs `npm ci` and `npm run verify` and every check passes.

- [ ] **Step 3: Freeze the still-public Pages fallback before main changes**

GitHub Pages currently builds automatically from `main`. Merging the Worker client while Pages still follows `main` would publish a public build whose same-origin `/api` does not exist. Freeze the accepted pre-migration Pages tree first:

~~~bash
git branch codex/pages-legacy-hold origin/main
git push origin codex/pages-legacy-hold
~~~

In GitHub Settings → Pages, change the existing legacy source to branch `codex/pages-legacy-hold` at `/ (root)`. Wait for its Pages deployment, then verify:

~~~bash
gh api repos/kuangc/surfcams-portugal/pages --jq '.source'
curl -fsSL https://kuangc.github.io/surfcams-portugal/ > /dev/null
~~~

Expected: the API names `codex/pages-legacy-hold` and `/`; the old public URL still serves the prior working release. If the hold branch already exists, verify its tree is the intended current Pages tree instead of overwriting it. Keep it unchanged until Pages is disabled so main merges and bot commits cannot break or partially expose the fallback.

- [ ] **Step 4: Recheck base immutability and merge without source edits**

Run:

~~~bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
~~~

Expected: exit 0. If not, repeat the candidate/reacceptance loop. When green:

~~~bash
gh pr merge --merge
git fetch origin
git rev-parse origin/main
git rev-parse origin/main^{tree}
~~~

Assert the `origin/main` tree exactly equals the recorded accepted candidate tree. If it differs, do not connect Workers Builds; build, deploy, and reaccept the actual main tree first. The frozen Pages source must remain on `codex/pages-legacy-hold` throughout.

- [ ] **Step 5: Connect Workers Builds only after exact-tree proof**

In the Cloudflare Worker’s Builds settings:

- connect the GitHub repository through the official GitHub App;
- production branch: `main`;
- root directory: repository root;
- build command: `npm run verify`;
- deploy command: `npm run deploy`;
- non-production branch builds: disabled;
- path exclusions: none, so data-only bot commits deploy;
- build cache: disabled for the first release.

Expected: the first main build succeeds and its logged source SHA and asset-manifest digest match the accepted main commit/tree. Copy its exact production Worker version ID, verify it with `npm exec -- wrangler versions view <ID> --json`, and require the same Durable Object binding/class before recording the ID. Smoke-test the protected production hostname again.

- [ ] **Step 6: Create the durable draft release record**

Update `.wrangler/private-meo-release-record.md` with exactly these non-secret fields:

- protected production hostname;
- candidate commit/tree and accepted `origin/main` commit/tree;
- asset-manifest digest and Surfline workflow blob;
- accepted candidate and first Workers-Build production version IDs;
- Access/second-user/iPhone acceptance result, without email addresses;
- placeholder fields for the first bot commit/build/version, rollback drill, Pages shutdown, and emergency hold branch.

Create one draft GitHub Release targeted at the accepted main commit:

~~~bash
RELEASE_TAG="private-worker-cutover-2026-08-19"
MAIN_SHA=$(git rev-parse origin/main)
gh release create "$RELEASE_TAG" --draft --target "$MAIN_SHA" --title "Private MEO Worker cutover — 2026-08-19" --notes-file .wrangler/private-meo-release-record.md
~~~

If the draft already exists after a candidate reacceptance, retarget it explicitly rather than updating only its notes:

~~~bash
gh release edit "$RELEASE_TAG" --target "$MAIN_SHA" --title "Private MEO Worker cutover — 2026-08-19" --notes-file .wrangler/private-meo-release-record.md
gh release view "$RELEASE_TAG" --json isDraft,targetCommitish
~~~

Expected: `isDraft` is true; `targetCommitish` is the newly accepted `MAIN_SHA`; the draft contains no identity, secret, token, signed URL/query, or Access assertion.

- [ ] **Step 7: Prove the unchanged Surfline bot reaches production**

Either wait for the next scheduled data-changing run or dispatch the existing workflow:

~~~bash
DISPATCHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
gh workflow run update-surfline-conditions.yml --ref main
SURFLINE_RUN_ID=""
for attempt in {1..20}; do
  SURFLINE_RUN_ID=$(gh run list --workflow update-surfline-conditions.yml --event workflow_dispatch --branch main --limit 10 --json databaseId,createdAt --jq "map(select(.createdAt >= \"$DISPATCHED_AT\")) | sort_by(.createdAt) | last | .databaseId // empty")
  [[ -n "$SURFLINE_RUN_ID" ]] && break
  sleep 3
done
[[ -n "$SURFLINE_RUN_ID" ]]
gh run watch "$SURFLINE_RUN_ID" --exit-status
git fetch origin
git log -1 --format="%H %s" origin/main
~~~

If the run creates no commit because data is unchanged, wait for a later data-changing run. For the first actual `chore(data): refresh surfline conditions` commit, confirm:

- Workers Builds receives that exact main SHA;
- `npm run verify` and deployment succeed;
- protected `/data/surfline-conditions.json` exposes the new `generatedAt` after authentication;
- playback, Access, and all static assets remain healthy;
- `.github/workflows/update-surfline-conditions.yml` itself was not changed.

Record the exact bot commit, Workers Build source SHA, and resulting production Worker version ID; inspect that exact version with `wrangler versions view --json`, update the draft Release notes, and keep it draft. Do not disable Pages until this proof passes.

## Task 14: Drill rollback, retire public Pages, and close the release

**Files:**

- Repository changes: none
- External state: Cloudflare Worker deployment version, GitHub Pages site, draft GitHub Release

- [ ] **Step 1: Record functional Worker versions**

Run:

~~~bash
npm exec -- wrangler versions list
CANDIDATE_VERSION_ID="<exact accepted candidate ID from release record>"
PRODUCTION_VERSION_ID="<exact current production ID from release record>"
npm exec -- wrangler versions view "$CANDIDATE_VERSION_ID" --json
npm exec -- wrangler versions view "$PRODUCTION_VERSION_ID" --json
~~~

The two IDs must be copied from the release record/dashboard, not guessed from list order. Both viewed versions must contain binding `MEO_TOKEN_COORDINATOR` and class `MeoTokenCoordinator`. The deny-only bootstrap is not a safe rollback target after the Durable Object lifecycle is introduced.

- [ ] **Step 2: Perform the rollback drill**

In Cloudflare Versions & Deployments:

1. roll 100% of traffic back to the recorded accepted functional candidate;
2. verify Access login, static assets, one gallery camera, untimed Focus, Explore, and playback API;
3. restore 100% to the current production version;
4. repeat the smoke test.

Expected: both functional versions work; no gradual split remains; Durable Object storage and revision state remain compatible. Record that Worker-version rollback does not version or erase Durable Object storage.

- [ ] **Step 3: Disable the obsolete public GitHub Pages deployment**

Use GitHub Settings → Pages → Source → None/Unpublish. The source must still be `codex/pages-legacy-hold`, never the migrated `main` tree. If the owner chooses the API alternative, first confirm the target:

~~~bash
gh api repos/kuangc/surfcams-portugal/pages
~~~

Then remove only that Pages site:

~~~bash
gh api --method DELETE repos/kuangc/surfcams-portugal/pages
~~~

Expected: the protected Worker remains live; GitHub’s Pages API returns 404 afterward; `https://kuangc.github.io/surfcams-portugal/` no longer serves the application. Treat CDN propagation delay separately from a failed unpublish. Keep the frozen hold branch temporarily as the documented emergency re-enable source; deleting it is a separate later cleanup decision.

- [ ] **Step 4: Perform the final production verification**

Verify:

- anonymous Worker root/API cannot reveal app content;
- owner and every intended exact-email user can sign in;
- one explicitly removed account remains denied;
- representative MEO media, Surfline conditions, gallery timing, Focus/Compare, Favorites, Explore, logout, and iPhone A2HS all pass;
- current main SHA equals the latest successful Workers Build source;
- Pages is absent;
- `.wrangler/private-meo-release-record.md` records production URL, candidate/main SHA and tree, asset digest, functional version IDs, bot-deploy proof, rollback result, Pages API 404, and `codex/pages-legacy-hold` as the emergency re-enable source.

- [ ] **Step 5: Publish the sanitized release record**

Review the local record for forbidden identity/secret material, update the draft, inspect it, and publish:

~~~bash
RELEASE_TAG="private-worker-cutover-2026-08-19"
rg -n "Cf-Access-Jwt-Assertion|wmsAuthSign|nimblesessionid|client_secret|@" .wrangler/private-meo-release-record.md
gh release edit "$RELEASE_TAG" --notes-file .wrangler/private-meo-release-record.md
gh release view "$RELEASE_TAG"
gh release edit "$RELEASE_TAG" --draft=false
~~~

Expected: the `rg` command has no match; the public GitHub Release is the durable audit record and contains every field above without email addresses, tokens, signed URLs, assertions, or secrets. The project reaches Definition of Done only after every item above is evidenced.

## Plan quality self-review

| Approved specification concern | Executable coverage |
|---|---|
| Private family access, exact-email approval/revocation, Google login, logout | Tasks 4, 6, 9, 10, 12, 14 |
| Provider-native MEO camera identity and no Surfline camera media | Tasks 1, 2, 3, 9, 10, 12 |
| Surfline conditions/advice retained and scheduled workflow unchanged | Tasks 1, 9, 10, 11, 13 |
| Server-side MEO token acquisition, 20-hour refresh, current 24-hour exposure limit | Tasks 3, 5, 6, 10, 12 |
| Browser streams signed HLS directly; Worker never proxies media or accepts URLs | Tasks 3, 6, 7, 8, 10, 12 |
| JWT defense in depth and secret/log/storage boundaries | Tasks 2, 4, 5, 6, 7, 10, 12 |
| One-refresh recovery, concurrency, stale-result, and provider-failure isolation | Tasks 3, 5, 6, 7, 8, 9, 12 |
| Unlimited Favorites and accepted gallery/Focus/Compare/Explore/mobile UX | Tasks 1, 8, 9, 12, 14 |
| Gallery exact 60 seconds after Playing; untimed Focus/Compare/Explore | Tasks 8, 9, 12, 14 |
| Fresh defaults on the new protected origin; no account/admin UI | Tasks 9, 10, 12 |
| Deterministic allowlisted assets, locked dependencies, CI and data-only deploys | Tasks 2, 3, 5, 6, 10, 11, 13 |
| Protected bootstrap, immutable candidate, Pages freeze, exact-tree promotion | Tasks 11, 12, 13 |
| Bot-deploy proof, explicit-version rollback, Pages retirement, durable audit record | Tasks 13, 14 |
| Non-goals: no Surfline playback, media proxy, app-owned passwords, public sharing, telemetry, or gradual rollout | Execution rules; Tasks 1, 3, 6, 9, 10, 12, 14 |

- [x] **Specification coverage:** Confirm every row above has both a production task and an acceptance/release gate where applicable.
- [x] **API consistency:** Confirm `failedRevision` is the sole refresh request key in Worker tests, Worker API, browser client, player, and docs; confirm `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are the sole Access binding names; confirm `MeoTokenCoordinator` and `MEO_TOKEN_COORDINATOR` spelling is consistent.
- [x] **Security consistency:** Confirm no step logs a token, signed URL/query, Access JWT, OAuth secret, or revision; persistence is limited to token/revision records in the named Durable Object while authorized responses/player state are memory-only; no API accepts an upstream URL; every API path validates Access JWT before routing.
- [x] **Playback consistency:** Confirm gallery is exactly 60 seconds after `playing`; midstream refresh cannot extend it; Focus/Compare and Explore are untimed; every surface shares one client; no unsigned/Surfline media fallback exists.
- [x] **Deployment consistency:** Confirm the bootstrap is content-free, Access precedes functional deployment, Durable Object previews are not used, accepted tree equality precedes Workers Builds, a bot commit is proven, rollback is functional-version-only, and Pages is last.
- [x] **Incomplete-language scan:** Run the following and resolve every match:

~~~bash
rg -n 'TO''DO|T''BD|FIX''ME|similar'' to|as'' needed|appropriate'' error|fill'' in' docs/superpowers/plans/2026-08-19-private-meo-worker-migration.md
~~~

- [x] **Command/file audit:** Confirm every path exists now or is explicitly created by an earlier task; every production edit has a preceding RED; every commit command stages only that task’s files; every external command names its target.
- [x] **Final plan verification:** Run `git diff --check`, read the complete plan from start to finish, and request an independent Critical/Important review before committing it.
