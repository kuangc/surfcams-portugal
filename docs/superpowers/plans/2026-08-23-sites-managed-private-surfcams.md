# Sites-Managed Private Surfcams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Surfcams Portugal through Sites with invitation-only Google access, owner-managed approvals and revocation, D1-backed MEO playback, current Surfline/tide information, and every accepted camera and mobile feature retained.

**Architecture:** Keep the accepted vanilla frontend and its provider-native MEO catalog. Build it with Vite into a Sites-compatible Cloudflare Worker bundle, use one Sites-managed D1 database for auth/session/audit/token state, and put Google identity, authorization, live-data, and playback decisions behind focused server modules. The Sites project is opened publicly only after owner-only deployment proves the application gate; GitHub Pages remains the rollback surface until the final acceptance and rollback drill pass.

**Tech Stack:** Node.js 22, vanilla ES modules, Vite 8.2.2, `@openai/sites-vite-plugin` 0.2.0, `jose` 6.2.9, Cloudflare Workers/D1 APIs supplied by Sites, Drizzle schema and migrations, Node test runner, Vitest Workerd integration tests, GitHub Actions, Google Identity Services.

---

## Locked boundaries

- Work in `/Users/kuangchen/workspace/surfcams-portugal/.worktrees/meo-only-cameras` on `codex/meo-only-cameras`.
- Preserve accepted camera/UX/playback behavior from commit `366ad5659e9bf39df359c23304327b83449b8fc4`; do not restore Cloudflare Access, Durable Objects, Surfline camera media, or direct player use of `camera.streamUrl`.
- Keep `.github/workflows/update-surfline-conditions.yml` at SHA-256 `01c9f7be6173ef4f9369d9d4944ece26504ebc771738c268ebdbc90b1020cdea`.
- Keep `.github/workflows/update-tides.yml` at SHA-256 `84c59d101d89768e99905bb3cbec4dc99d18ba05540123496d7a45b46d4c3175`.
- Keep Favorites, surf preferences, and feedback device-local; the new Sites origin intentionally begins with the committed defaults.
- Protect `/`, `/index.html`, live-data routes, playback routes, account/admin routes, and Manage Users. Leave non-secret CSS, JS, icons, manifest, and committed reference data public.
- Do not put a Google ID token, session/CSRF token, MEO token, signed playlist URL, owner email, Sites credential, or source credential in source, logs, audit rows, HTML metadata, or release evidence.
- The only hosted runtime values are `GOOGLE_CLIENT_ID`, `BOOTSTRAP_OWNER_EMAIL`, and `SITE_ORIGIN`. The Google client ID is an ordinary env value; the owner email is a Sites secret.

## File map

### Build and persistence

- Create `.openai/hosting.json`: Sites project metadata with logical `DB` binding and no R2 binding.
- Create `vite.config.js`: bundle `worker/index.js` to `dist/server/index.js` and run the official Sites packaging plugin.
- Modify `scripts/build-runtime-assets.js`: keep the client allowlist but exclude volatile conditions/tides from public static output.
- Create `scripts/build-sites-manifest.js`: hash the complete deterministic `dist` file set after Vite finishes.
- Create `scripts/verify-sites-package.js`: enforce exact package shape, workflow hashes, secret scans, and Surfline-camera-media exclusions.
- Create `drizzle.config.ts`, `db/schema.ts`, `drizzle/0000_sites_private_surfcams.sql`, and Drizzle's generated `drizzle/meta` journal/snapshot: define the additive D1 schema.
- Create `wrangler.test.jsonc` and `test/workerd/setup.js`: local-only D1/asset bindings and migration application for Workerd tests.
- Modify `package.json` and `package-lock.json`: replace production Wrangler deployment scripts with Sites build/verification scripts and pin the Sites/Vite/Drizzle toolchain.

### Reusable authentication module

- Create `worker/http/body.js`: bounded request-body readers and exact form/JSON validation.
- Create `worker/http/responses.js`: bounded JSON/HTML/redirect responses and security headers.
- Create `worker/auth/config.js`: strict runtime configuration parsing.
- Create `worker/auth/cookies.js`: exact cookie parsing, cookie construction, token generation, and SHA-256 hashing.
- Create `worker/auth/google-identity.js`: GIS CSRF validation, bounded Google JWKS caching, RS256 ID-token verification, and authoritative-email checks.
- Create `worker/auth/store.js`: D1 user/session/audit queries and state transitions.
- Create `worker/auth/session.js`: `resolveAccessState`, `requireSession`, `requireOwner`, session issuance, logout, and admin CSRF checks.
- Create `worker/auth/views.js`: invitation, pending, denied, revoked, unavailable, and Manage Users HTML.
- Create `worker/auth/routes.js`: public identity routes, logout, account summary, Manage Users, and admin actions.

### Surf application server modules

- Create `worker/live-data.js`: exact raw-GitHub fetches, bounded validation/cache, and bundled fallback for conditions and tides.
- Create `worker/meo-token-store.js`: D1 singleton token state with a conditional short lease and bounded wait.
- Modify `worker/playback-api.js`: use the D1 coordinator without changing the browser contract.
- Modify `worker/router.js` and `worker/index.js`: enforce the route boundary and serve the protected app shell.
- Delete `worker/access-jwt.js`, `worker/bootstrap.js`, `worker/meo-token-coordinator.js`, `worker/token-coordinator-core.js`, `wrangler.jsonc`, `wrangler.bootstrap.jsonc`, and `test/fixtures/wrangler-dry-run-secrets.env` after their replacements are green.

### Frontend and operations

- Modify `src/config.js`: point conditions and tides at same-origin protected API routes.
- Modify `index.html`: replace Cloudflare logout, add owner-only Manage Users affordance, and retain the four-item primary navigation.
- Modify `src/main.js`: load account summary, reveal owner tools, show pending count, and submit application logout.
- Modify `src/styles/app.css`: style owner access controls without changing accepted mobile hierarchies.
- Modify `README.md`, `CLAUDE.md`, and `docs/architecture.md`: describe Sites, D1, Google access requests, and unchanged GitHub refreshes.
- Create `docs/runbooks/sites-access.md` and `docs/runbooks/sites-release.md`; delete the superseded Cloudflare runbooks.

## Task 1: Convert the deterministic build to Sites/Vite

**Files:**
- Create: `.openai/hosting.json`
- Create: `vite.config.js`
- Create: `scripts/build-sites-manifest.js`
- Create: `scripts/verify-sites-package.js`
- Modify: `scripts/build-runtime-assets.js`
- Modify: `test/runtime-package.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing package-contract tests**

Add tests that require the two volatile files to be absent from `RUNTIME_DATA_FILES`, require `dist/server/index.js`, `dist/.openai/hosting.json`, and a sorted full-build manifest, and reject the obsolete deployment files from the package:

```js
assert.equal(RUNTIME_DATA_FILES.includes("surfline-conditions.json"), false);
assert.equal(RUNTIME_DATA_FILES.includes("portugal-tides.json"), false);
assert.ok(fs.existsSync("dist/server/index.js"));
const hosting = JSON.parse(fs.readFileSync("dist/.openai/hosting.json", "utf8"));
assert.equal(hosting.d1, "DB");
assert.equal(hosting.r2, null);
assert.equal(Object.keys(hosting).every((key) => ["project_id", "d1", "r2"].includes(key)), true);
assert.equal(packageFiles.includes("wrangler.jsonc"), false);
assert.equal(packageFiles.includes("wrangler.bootstrap.jsonc"), false);
assert.deepEqual(manifest.files, [...manifest.files].sort((a, b) => a.path.localeCompare(b.path)));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/runtime-package.test.js`

Expected: FAIL because the volatile JSON files are still public build inputs and no Sites server entry or hosting metadata exists.

- [ ] **Step 3: Pin the supported build dependencies and scripts**

Run:

```bash
npm install --save-dev @openai/sites-vite-plugin@0.2.0 vite@8.2.2 drizzle-kit@0.31.10 drizzle-orm@0.45.2
```

Set these scripts in `package.json`:

```json
{
  "scripts": {
    "build:client": "node scripts/build-runtime-assets.js",
    "build:server": "vite build",
    "build:manifest": "node scripts/build-sites-manifest.js",
    "build": "npm run build:client && npm run build:server && npm run build:manifest",
    "check:package": "node scripts/verify-sites-package.js",
    "db:generate": "drizzle-kit generate --name=sites_private_surfcams",
    "verify": "npm run build && npm test && npm run check-spot-advice && npm run check:package",
    "verify:fresh": "npm run verify && npm run check:conditions",
    "test:worker": "npm run build && vitest run --config vitest.worker.config.js"
  }
}
```

Remove `cf:bootstrap`, `deploy`, and the production `check:worker` Wrangler dry-run script. Keep Wrangler and the Workerd pool only for local integration tests.

- [ ] **Step 4: Add the Sites metadata and exact Vite output**

Create `.openai/hosting.json`:

```json
{
  "d1": "DB",
  "r2": null
}
```

Create `vite.config.js`:

```js
import { resolve } from "node:path";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sites()],
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve("worker/index.js"),
      output: {
        format: "es",
        entryFileNames: "server/index.js",
        chunkFileNames: "server/chunks/[name]-[hash].js",
        assetFileNames: "server/assets/[name]-[hash][extname]"
      }
    }
  }
});
```

- [ ] **Step 5: Exclude volatile public data and hash the finished package**

Remove `surfline-conditions.json` and `portugal-tides.json` from `RUNTIME_DATA_FILES`. Implement `build-sites-manifest.js` so it recursively reads `dist`, rejects symlinks, excludes only `sites-package-manifest.json` from its own input, and writes:

```js
{
  files: files.sort((a, b) => a.path.localeCompare(b.path)).map(({ path, bytes }) => ({
    path,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  }))
}
```

Implement `verify-sites-package.js` with these fixed checks:

```js
const required = [
  "server/index.js",
  ".openai/hosting.json",
  "index.html",
  "manifest.webmanifest",
  "sites-package-manifest.json"
];
const forbiddenText = /hls\.cdn-surfline\.com|camstills\.cdn-surfline\.com|__rawSurflineFeeds/;
const forbiddenFiles = /(^|\/)(test|docs|\.git|\.wrangler|wrangler\.jsonc|wrangler\.bootstrap\.jsonc)(\/|$)/;
```

Also assert the two frozen workflow hashes from **Locked boundaries** and fail if the runtime bundle contains `GOOGLE_CLIENT_ID=`, `BOOTSTRAP_OWNER_EMAIL=`, `wmsAuthSign=` followed by a literal value, or a Sites source credential.

- [ ] **Step 6: Run build/package tests and verify GREEN**

Run:

```bash
npm run build
node --test test/runtime-package.test.js
npm run check:package
```

Expected: all commands pass; `dist/server/index.js` and `dist/.openai/hosting.json` exist; volatile data is not a public file.

- [ ] **Step 7: Commit the build foundation**

```bash
git add .openai/hosting.json vite.config.js scripts/build-runtime-assets.js scripts/build-sites-manifest.js scripts/verify-sites-package.js test/runtime-package.test.js package.json package-lock.json
git commit -m "build: package surfcams for Sites"
```

## Task 2: Add the additive D1 schema and Workerd migration harness

**Files:**
- Create: `drizzle.config.ts`
- Create: `db/schema.ts`
- Create: `drizzle/0000_sites_private_surfcams.sql`
- Create: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0000_snapshot.json`
- Create: `wrangler.test.jsonc`
- Create: `test/workerd/setup.js`
- Create: `test/worker/schema-contract.test.js`
- Modify: `scripts/verify-sites-package.js`
- Modify: `test/runtime-package.test.js`
- Modify: `vitest.worker.config.js`

- [ ] **Step 1: Write a failing schema contract**

Assert that the migration contains the four required tables, status/role checks, unique Google identity/email indexes, single-owner partial index, active-session and audit indexes, and the singleton MEO row:

```js
for (const table of ["auth_users", "auth_sessions", "auth_audit_events", "meo_token_state"]) {
  assert.match(sql, new RegExp(`CREATE TABLE \\"${table}\\"`));
}
assert.match(sql, /CHECK \("status" IN \('pending','active','denied','revoked'\)\)/);
assert.match(sql, /CREATE UNIQUE INDEX "idx_auth_users_google_sub"/);
assert.match(sql, /CREATE UNIQUE INDEX "idx_auth_users_normalized_email"/);
assert.match(sql, /CREATE UNIQUE INDEX "idx_auth_users_single_owner"[\s\S]*WHERE "role" = 'owner'/);
assert.match(sql, /CHECK \("id" = 1\)/);
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node --test test/worker/schema-contract.test.js`

Expected: FAIL because the schema and migration do not exist.

- [ ] **Step 3: Define the schema**

Use Drizzle SQLite columns matching this exact migration shape:

```sql
CREATE TABLE "auth_users" (
  "id" text PRIMARY KEY NOT NULL,
  "google_sub" text NOT NULL,
  "normalized_email" text NOT NULL,
  "display_name" text,
  "role" text DEFAULT 'viewer' NOT NULL CHECK ("role" IN ('owner','viewer')),
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','active','denied','revoked')),
  "session_generation" integer DEFAULT 0 NOT NULL CHECK ("session_generation" >= 0),
  "requested_at" integer NOT NULL,
  "approved_at" integer,
  "last_login_at" integer,
  "revoked_at" integer,
  "updated_at" integer NOT NULL,
  "last_transition_id" text,
  "approved_by" text REFERENCES "auth_users"("id"),
  "revoked_by" text REFERENCES "auth_users"("id")
);
CREATE UNIQUE INDEX "idx_auth_users_google_sub" ON "auth_users" ("google_sub");
CREATE UNIQUE INDEX "idx_auth_users_normalized_email" ON "auth_users" ("normalized_email");
CREATE UNIQUE INDEX "idx_auth_users_single_owner" ON "auth_users" ("role") WHERE "role" = 'owner';
CREATE INDEX "idx_auth_users_status_requested" ON "auth_users" ("status", "requested_at");

CREATE TABLE "auth_sessions" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "csrf_hash" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "session_generation" integer NOT NULL,
  "created_at" integer NOT NULL,
  "expires_at" integer NOT NULL,
  "last_seen_at" integer NOT NULL,
  "revoked_at" integer
);
CREATE INDEX "idx_auth_sessions_user_active" ON "auth_sessions" ("user_id", "revoked_at", "expires_at");

CREATE TABLE "auth_audit_events" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "event_type" text NOT NULL CHECK ("event_type" IN ('request_created','approved','denied','revoked','restored','devices_signed_out')),
  "actor_user_id" text REFERENCES "auth_users"("id"),
  "subject_user_id" text NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL
);
CREATE INDEX "idx_auth_audit_subject_created" ON "auth_audit_events" ("subject_user_id", "created_at");
CREATE INDEX "idx_auth_audit_created" ON "auth_audit_events" ("created_at");

CREATE TABLE "meo_token_state" (
  "id" integer PRIMARY KEY NOT NULL CHECK ("id" = 1),
  "token" text,
  "revision" text,
  "fetched_at" integer,
  "refresh_at" integer,
  "version" integer DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" integer,
  "updated_at" integer NOT NULL
);
INSERT INTO "meo_token_state" ("id", "version", "updated_at") VALUES (1, 0, 0);
PRAGMA optimize;
```

Keep `db/schema.ts` semantically identical and configure Drizzle to write SQLite migrations to `./drizzle`.

Extend the finished-package requirements from Task 1 with `.openai/drizzle/0000_sites_private_surfcams.sql`, `.openai/drizzle/meta/_journal.json`, and `.openai/drizzle/meta/0000_snapshot.json`; assert the SQL file is byte-identical to the checked-in migration.

- [ ] **Step 4: Configure local-only D1 integration tests**

Create `wrangler.test.jsonc` with this transitional local-only shape:

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "surfcams-portugal-test",
  "main": "worker/index.js",
  "compatibility_date": "2026-08-19",
  "assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": true },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "surfcams-portugal-test",
    "database_id": "00000000-0000-4000-8000-000000000001"
  }],
  "durable_objects": {
    "bindings": [{ "name": "MEO_TOKEN_COORDINATOR", "class_name": "MeoTokenCoordinator" }]
  },
  "exports": {
    "MeoTokenCoordinator": { "type": "durable-object", "storage": "sqlite" }
  },
  "vars": {
    "ACCESS_TEAM_DOMAIN": "https://family.cloudflareaccess.com",
    "ACCESS_AUD": "surfcams-access-audience"
  }
}
```

Keep the Access values and `MEO_TOKEN_COORDINATOR` binding only so the pre-replacement Workerd suites stay green; Task 6 removes the Access values and Task 7 removes the Durable Object binding/export. In `vitest.worker.config.js`, read migrations and expose them as `TEST_MIGRATIONS`; in `test/workerd/setup.js`, run:

```js
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
```

- [ ] **Step 5: Generate, inspect, and test the migration**

Run:

```bash
npm run db:generate
git diff -- db/schema.ts drizzle
node --test test/worker/schema-contract.test.js
npm run test:worker
```

Expected: the checked-in migration is additive, the schema contract passes, and Workerd applies it cleanly.

- [ ] **Step 6: Commit the database foundation**

```bash
git add drizzle.config.ts db/schema.ts drizzle/0000_sites_private_surfcams.sql wrangler.test.jsonc vitest.worker.config.js scripts/verify-sites-package.js test/runtime-package.test.js test/workerd/setup.js test/worker/schema-contract.test.js
git commit -m "feat: add Sites D1 schema"
```

## Task 3: Build bounded HTTP primitives and Google identity verification

**Files:**
- Create: `worker/http/body.js`
- Create: `worker/http/responses.js`
- Create: `worker/auth/config.js`
- Create: `worker/auth/cookies.js`
- Create: `worker/auth/google-identity.js`
- Create: `test/worker/http-body.test.js`
- Create: `test/worker/google-identity.test.js`

- [ ] **Step 1: Write failing bounded-body, cookie, config, and Google JWT tests**

Use generated RS256 keys and an injected JWKS fetcher. Cover: exact form content type, declared and streamed 16 KiB limits, a 5-second body timeout, duplicate form keys, duplicate cookies, CSRF mismatch, ES256/HS256 rejection, wrong issuer/audience, expired and future `nbf`, missing/false `email_verified`, third-party verified email without `hd`, Gmail acceptance, Workspace acceptance, invalid claim shapes, JWKS size/type/timeout/cache behavior, and sanitized errors.

The positive identity assertion is:

```js
assert.deepEqual(identity, {
  sub: "google-subject-123",
  email: "approved.user@gmail.com",
  displayName: "Approved User",
  hostedDomain: null
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/worker/http-body.test.js test/worker/google-identity.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement reusable bounded request helpers**

Export these exact interfaces:

```js
export async function readBoundedBytes(request, { maxBytes, timeoutMs });
export async function readExactForm(request, { required, optional, maxBytes, timeoutMs });
export async function readExactJson(request, { keys, maxBytes, timeoutMs });
export function privateJson(body, status = 200);
export function privateHtml(html, status = 200, headers = {});
export function redirect(location, status = 303, headers = {});
```

`readBoundedBytes` must reject over-limit declared length before reading, count UTF-8 bytes while streaming, cancel the reader on error, and race reads against `AbortSignal.timeout(timeoutMs)`. `readExactForm` accepts only `application/x-www-form-urlencoded`, rejects duplicate/unknown keys, and requires each configured key once.

- [ ] **Step 4: Implement strict config and cookie handling**

`readAuthConfig(env)` returns only validated values:

```js
{
  googleClientId: env.GOOGLE_CLIENT_ID.trim(),
  bootstrapOwnerEmail: env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase(),
  siteOrigin: new URL(env.SITE_ORIGIN).origin
}
```

Require the client ID suffix `.apps.googleusercontent.com`, a Gmail bootstrap address, and an HTTPS origin with no path/query/hash. Use cookie names `__Host-surfcams_session` and `__Host-surfcams_csrf`. Generate 32 random bytes per token, encode base64url, and store only `SHA-256` base64url hashes.

- [ ] **Step 5: Implement Google verification without retaining the token**

Export:

```js
export async function verifyGoogleCredential(request, config, {
  fetcher = fetch,
  now = () => Date.now()
} = {});
```

Require exact form keys `credential`, `g_csrf_token`, and optional `select_by`; match `g_csrf_token` to the cookie before JWT work. Fetch only `https://www.googleapis.com/oauth2/v3/certs`, require JSON, cap it at 64 KiB/5 seconds, parse `Cache-Control: max-age`, and cache keys for `min(maxAge, 24h)` with a 60-second floor. Verify with:

```js
await jwtVerify(credential, keyResolver, {
  algorithms: ["RS256"],
  audience: config.googleClientId,
  issuer: ["https://accounts.google.com", "accounts.google.com"],
  currentDate: new Date(now())
});
```

Require nonblank bounded `sub`, normalized email, `email_verified === true`, and either `@gmail.com` or a nonblank `hd`. Bound `sub` and `hd` to 255 UTF-8 bytes, email to 320, and display name to 200; reject control characters. When a valid token names an unknown `kid`, refresh the JWKS once even before the cached set expires, then fail generically if the key is still absent. Return only the normalized identity object; never return or log the credential.

- [ ] **Step 6: Run the focused security tests and verify GREEN**

Run: `node --test test/worker/http-body.test.js test/worker/google-identity.test.js`

Expected: all tests pass and sensitive fixture strings are absent from thrown messages and response bodies.

- [ ] **Step 7: Commit the identity verifier**

```bash
git add worker/http worker/auth/config.js worker/auth/cookies.js worker/auth/google-identity.js test/worker/http-body.test.js test/worker/google-identity.test.js
git commit -m "feat: verify Google identities securely"
```

## Task 4: Implement D1 access requests, sessions, and owner state transitions

**Files:**
- Create: `worker/auth/store.js`
- Create: `worker/auth/session.js`
- Create: `test/workerd/auth-store.test.js`
- Create: `test/worker/auth-session.test.js`

- [ ] **Step 1: Write failing D1 state-machine tests**

Cover exactly these transitions:

```text
unknown -> pending (one row, one request_created audit event, no session)
pending -> active via approve
pending -> denied via deny
denied -> active via restore
active viewer -> revoked and session_generation + 1
revoked viewer -> active without restoring old sessions
active user -> active with session_generation + 1 via sign out all devices
active owner -> revoke/deny rejected
```

Also test duplicate sign-in attempts do not add users, update rows, or add audit events, a conflicting email/different `sub` fails closed, and only the first verified configured owner subject can bind the owner row. Returning an existing pending/denied/revoked state without a D1 write is the write-rate limit: repeated verified attempts cannot create database or management-page noise.

- [ ] **Step 2: Run auth state tests and verify RED**

Run: `npm run test:worker -- test/workerd/auth-store.test.js`

Expected: FAIL because no store exists.

- [ ] **Step 3: Implement the D1 store with prepared statements**

Export these exact operations from `worker/auth/store.js`:

```js
export async function resolveAccessState(db, identity, config, now = Date.now());
export async function createSessionRecord(db, user, record);
export async function findSessionByHash(db, tokenHash, now);
export async function revokeSession(db, tokenHash, now);
export async function listManagedUsers(db);
export async function countPendingUsers(db);
export async function listAuditEvents(db, limit = 50);
export async function applyAdminAction(db, { actor, subjectId, action, now });
```

Use `INSERT OR IGNORE` plus unique constraints for pending/owner idempotency. Every multi-statement state change creates a random `transitionId` and uses one `db.batch([...])`: the exact-state user update writes `last_transition_id = transitionId`; session revocation and the audit `INSERT ... SELECT` each run only where that same user's marker equals `transitionId`. Require `meta.changes === 1` for the user update before treating an action as successful. This prevents a lost compare-and-swap from writing an audit row or revoking sessions.

`createSessionRecord` uses `INSERT ... SELECT` from an active user with the captured session generation, then batches that insert with a conditional `last_login_at`/`updated_at` update. Require one inserted session row; a concurrent revoke therefore creates no usable session. The fixed expiry never changes.

- [ ] **Step 4: Write failing session lifecycle tests**

Test 30-day fixed expiry, `HttpOnly; Secure; SameSite=Lax; Path=/`, no Domain, D1 hash-only storage, generation mismatch, user status change, explicit session revocation, one-hour throttled `last_seen_at`, logout of valid/invalid cookies, owner authorization, and session-bound CSRF.

- [ ] **Step 5: Implement the four reusable auth interfaces**

Export:

```js
export { resolveAccessState } from "./store.js";
export async function issueSession(db, user, now = Date.now());
export async function requireSession(request, db, now = Date.now());
export async function requireOwner(request, db, now = Date.now());
export async function logoutSession(request, db, now = Date.now());
export async function requireAdminCsrf(request, session, config);
```

Use `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`. `requireSession` must join session/user state, require `expires_at > now`, `revoked_at IS NULL`, `status = 'active'`, and equal generations. `requireAdminCsrf` must require `Origin === config.siteOrigin`, exact form fields, CSRF form/cookie equality, and CSRF hash equality with the session row.

- [ ] **Step 6: Run session/state tests and verify GREEN**

Run:

```bash
node --test test/worker/auth-session.test.js
npm run test:worker -- test/workerd/auth-store.test.js
```

Expected: all tests pass; raw session and CSRF fixture tokens appear only in returned cookies, never D1 rows or audit rows.

- [ ] **Step 7: Commit the authorization core**

```bash
git add worker/auth/store.js worker/auth/session.js test/workerd/auth-store.test.js test/worker/auth-session.test.js
git commit -m "feat: add revocable access sessions"
```

## Task 5: Add invitation pages and owner-only Manage Users

**Files:**
- Create: `worker/auth/views.js`
- Create: `worker/auth/routes.js`
- Create: `src/styles/auth.css`
- Create: `test/worker/auth-views.test.js`
- Create: `test/workerd/auth-routes.test.js`

- [ ] **Step 1: Write failing view and route tests**

Assert the exact public copy and exclusions:

```js
assert.match(html, /<h1>Invitation only<\/h1>/);
assert.match(html, /This is a private site\. Sign in with Google to request access\./);
assert.match(html, /data-text="continue_with"/);
assert.doesNotMatch(html, /family/i);
assert.match(html, /name="robots" content="noindex, nofollow"/);
assert.doesNotMatch(html, /camera|beach|user email|playlist/i);
```

Route tests cover unknown -> pending page/no cookie, approved -> 303 `/` plus cookies, pending/denied/revoked distinct pages, viewer Manage Users denial, owner grouped users/audit, exact admin actions, CSRF/origin/body/method failures, and final-owner safeguards.

- [ ] **Step 2: Run route/view tests and verify RED**

Run:

```bash
node --test test/worker/auth-views.test.js
npm run test:worker -- test/workerd/auth-routes.test.js
```

Expected: FAIL because the views/routes do not exist.

- [ ] **Step 3: Implement the public invitation flow**

`renderInvitation(config)` emits the exact approved copy, GIS explicit-button markup with `data-auto_prompt="false"` and `data-text="continue_with"`, and a same-origin `data-login_uri` of `${config.siteOrigin}/auth/google`. Include only invitation-only title/description social metadata and no image metadata.

Export `renderInvitation`, `renderAccessState`, and `renderManageUsers` from `worker/auth/views.js`, and `handleAuthRoute(request, env)` from `worker/auth/routes.js`. `POST /auth/google` must:

```js
const identity = await verifyGoogleCredential(request, config);
const access = await resolveAccessState(env.DB, identity, config);
if (access.status !== "active") return privateHtml(renderAccessState(access.status));
const issued = await issueSession(env.DB, access.user);
const headers = new Headers();
for (const cookie of issued.cookies) headers.append("Set-Cookie", cookie);
return redirect("/", 303, headers);
```

Map unknown and pending to **Request received. Access must be approved by the site owner.** Denied and revoked get distinct plain-language pages. All pages use `private, no-store` and `X-Robots-Tag: noindex, nofollow`.

- [ ] **Step 4: Implement Manage Users and audit history**

Render three groups: Pending, Approved, Revoked. Keep `denied` rows in Revoked with a visible denied status. Each row displays display name, authoritative email, status, role, requested time, and last successful sign-in. HTML-escape every database-derived value and cover `<script>` fixture names/emails with an XSS regression test. Render only state-valid actions from `approve`, `deny`, `revoke`, `restore`, and `sign-out-devices`. Each form posts to `/manage-users/actions` with exact `userId`, `action`, and `csrfToken` fields. Limit audit history to the 50 newest bounded events.

- [ ] **Step 5: Add route-level security headers and CSP**

Invitation CSP:

```text
default-src 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.gstatic.com; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/
```

Manage Users CSP is self-only and contains no third-party sources. All HTML gets `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

- [ ] **Step 6: Run invitation/admin tests and verify GREEN**

Run:

```bash
node --test test/worker/auth-views.test.js
npm run test:worker -- test/workerd/auth-routes.test.js
```

Expected: all tests pass; owner management is server-authorized and no viewer can reach its page or mutations.

- [ ] **Step 7: Commit the access UI**

```bash
git add worker/auth/views.js worker/auth/routes.js src/styles/auth.css test/worker/auth-views.test.js test/workerd/auth-routes.test.js
git commit -m "feat: add invitation-only user management"
```

## Task 6: Replace the Worker route boundary and integrate Configure

**Files:**
- Modify: `worker/router.js`
- Modify: `worker/index.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Modify: `test/worker/index.test.js`
- Modify: `test/index.test.js`
- Modify: `test/runtime-ux-regressions.test.js`
- Modify: `test/source-safety.test.js`
- Modify: `test/workerd/worker-routing.test.js`
- Modify: `wrangler.test.jsonc`
- Delete: `worker/access-jwt.js`
- Delete: `worker/bootstrap.js`
- Delete: `test/worker/access-jwt.test.js`
- Delete: `test/worker/bootstrap.test.js`

- [ ] **Step 1: Replace Access-era assertions with the approved route matrix**

Test these exact outcomes:

```text
GET /signin anonymous -> 200 invitation page
GET /src/main.js anonymous -> asset response
GET /icons/icon-192.png anonymous -> asset response
GET /manifest.webmanifest anonymous -> asset response
GET / anonymous -> 303 /signin
GET /index.html anonymous -> 303 /signin
GET / authenticated -> protected index asset
GET /api/account viewer -> 200 viewer summary without pending count
GET /api/account owner -> 200 owner summary with pending count
GET /manage-users viewer -> 403
GET /unknown -> 404
POST to a GET-only route -> 405
```

Assert source no longer contains `Cf-Access-Jwt-Assertion`, `/cdn-cgi/access/logout`, `ACCESS_TEAM_DOMAIN`, or `ACCESS_AUD`.

- [ ] **Step 2: Run focused routing/UI tests and verify RED**

Run:

```bash
node --test test/worker/index.test.js test/index.test.js test/runtime-ux-regressions.test.js test/source-safety.test.js
```

Expected: FAIL on the old Access verifier/logout and unprotected app shell.

- [ ] **Step 3: Implement the route matrix**

`worker/router.js` must dispatch in this order:

```js
if (isPublicAuthRoute(path)) return handleAuthRoute(request, env);
if (path === "/healthz" && request.method === "GET") return boundedHealth();
if (isPublicStaticAsset(path)) return env.ASSETS.fetch(request);
if (path === "/" || path === "/index.html") {
  await requireSession(request, env.DB);
  return protectedIndex(request, env.ASSETS);
}
if (path.startsWith("/api/playback/")) return protectedPlayback(request, env);
if (path.startsWith("/api/data/")) return protectedLiveData(request, env);
if (isAccountOrAdminRoute(path)) return handleAuthRoute(request, env);
return boundedNotFound(request);
```

Only `GET`/`HEAD` may fetch public static assets. Resolve `/healthz` before reading auth configuration or D1 so it stays bounded during initial owner-only deployment. Normalize `/` to `/index.html` for `ASSETS.fetch`; never convert an asset 404 or unknown route to the app shell. Missing config or D1 errors fail closed with a generic unavailable page/API response. Preserve the transitional `MeoTokenCoordinator` export in `worker/index.js` until Task 7 replaces playback and removes the test-only Durable Object binding.

Apply this CSP to the protected application shell while retaining its pinned Leaflet/Hls.js, MEO media, Open-Meteo, and map-tile behavior:

```text
default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self' https://video-auth1.iol.pt https://marine-api.open-meteo.com https://api.open-meteo.com; media-src 'self' blob: https://video-auth1.iol.pt; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
```

- [ ] **Step 4: Add owner tools without a fifth nav item**

Replace the Access section with:

```html
<section class="access-tools" aria-labelledby="accessToolsTitle">
  <div>
    <h2 id="accessToolsTitle">Access</h2>
    <p>Sign out of this private Surfcams session on this device.</p>
  </div>
  <div class="access-tools__actions">
    <a class="secondary-button" id="manageUsersLink" href="/manage-users" hidden>
      Manage users <span id="pendingUsersCount" hidden></span>
    </a>
    <form action="/logout" method="post"><button class="secondary-button" type="submit">Sign out</button></form>
  </div>
</section>
```

On initialization, fetch `/api/account`; reveal Manage Users only when `role === "owner"`, and display the bounded integer pending count. A failure leaves the owner affordance hidden and does not block camera rendering.

- [ ] **Step 5: Remove the Access implementation and run focused tests**

Delete the four obsolete files listed above, then run:

```bash
node --test test/worker/index.test.js test/index.test.js test/runtime-ux-regressions.test.js test/source-safety.test.js
```

Then run `npm run test:worker -- test/workerd/worker-routing.test.js`. Expected: all tests pass, the four accepted primary screens/navigation remain unchanged, and the transitional Access test values are gone while the MEO Durable Object test binding remains until Task 7.

- [ ] **Step 6: Commit the new route boundary**

```bash
git add worker/router.js worker/index.js index.html src/main.js src/styles/app.css wrangler.test.jsonc test/workerd/worker-routing.test.js test/worker/index.test.js test/index.test.js test/runtime-ux-regressions.test.js test/source-safety.test.js
git add -u worker test/worker
git commit -m "feat: enforce application-owned access gate"
```

## Task 7: Replace the Durable Object with a D1 token lease

**Files:**
- Create: `worker/meo-token-store.js`
- Create: `test/workerd/meo-token-store.test.js`
- Modify: `worker/meo-token.js`
- Modify: `worker/playback-api.js`
- Modify: `test/worker/meo-token.test.js`
- Modify: `test/worker/playback-api.test.js`
- Modify: `test/workerd/worker-routing.test.js`
- Modify: `worker/index.js`
- Modify: `wrangler.test.jsonc`
- Delete: `worker/meo-token-coordinator.js`
- Delete: `worker/token-coordinator-core.js`
- Delete: `test/worker/token-coordinator-core.test.js`
- Delete: `test/workerd/meo-token-coordinator.test.js`

- [ ] **Step 1: Write failing lease/concurrency tests**

Test first acquisition, exact 72,000,000 ms refresh boundary, stale revision refresh, newer-revision reuse, two coordinator instances converging on one upstream fetch, short conditional lease, bounded waiter timeout, expired-lease takeover, failed fetch preserving every field of the previous complete record, invalid record rejection, and opaque revisions.

- [ ] **Step 2: Run focused broker tests and verify RED**

Run: `npm run test:worker -- test/workerd/meo-token-store.test.js`

Expected: FAIL because `worker/meo-token-store.js` does not exist.

- [ ] **Step 3: Implement the conditional lease coordinator**

Use these constants and interface:

```js
import { fetchMeoToken, MEO_BROKER_TTL_MS } from "./meo-token.js";
export { MEO_BROKER_TTL_MS };
export const TOKEN_LEASE_MS = 15_000;
export const TOKEN_WAIT_LIMIT_MS = 11_000;
export const TOKEN_WAIT_INTERVAL_MS = 100;

export class D1MeoTokenStore {
  constructor(db, {
    fetchToken = fetchMeoToken,
    now = () => Date.now(),
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {}
  async getToken() {}
  async refreshToken(failedRevision) {}
}
```

Acquire only with a versioned conditional update:

```sql
UPDATE meo_token_state
SET lease_owner = ?, lease_expires_at = ?, version = version + 1, updated_at = ?
WHERE id = 1
  AND version = ?
  AND (lease_owner IS NULL OR lease_expires_at <= ?)
```

After a bounded/validated MEO fetch, overwrite only where `lease_owner = ?`; clear the lease and increment version. On failure, clear only that lease and leave token/revision/fetched/refresh fields untouched. A waiter rereads every 100 ms, returns a qualifying record, attempts takeover after expiry, and fails after 11 seconds—inside the browser client's existing 15-second request limit and long enough for the two bounded 5-second upstream attempts.

- [ ] **Step 4: Adapt playback without changing the browser response**

Replace the Durable Object lookup with:

```js
const coordinator = new D1MeoTokenStore(env.DB);
const record = operation === "get"
  ? await coordinator.getToken()
  : await coordinator.refreshToken(failedRevision);
```

Keep response keys exactly `cameraId`, `playlistUrl`, `revision`, `refreshAt`, keep `private, no-store`, keep camera-ID catalog lookup, and remove RPC disposal code.

- [ ] **Step 5: Run broker, API, and browser playback regressions**

Run:

```bash
npm run test:worker -- test/workerd/meo-token-store.test.js test/workerd/worker-routing.test.js
node --test test/worker/meo-token.test.js test/worker/playback-api.test.js test/playback-client.test.js test/video-player.test.js test/feed-lifecycle.test.js
```

Expected: all tests pass; the response contract and generation-safe single refresh remain unchanged.

- [ ] **Step 6: Remove Durable Object files/binding and commit**

Remove the `MeoTokenCoordinator` export from `worker/index.js` and the test-only Durable Object binding/export from `wrangler.test.jsonc`; `DB` is now the only persistence binding.

```bash
git add worker/meo-token-store.js worker/meo-token.js worker/playback-api.js worker/index.js wrangler.test.jsonc test/workerd/meo-token-store.test.js test/workerd/worker-routing.test.js test/worker/meo-token.test.js test/worker/playback-api.test.js
git add -u worker test
git commit -m "feat: coordinate MEO tokens in Sites D1"
```

## Task 8: Serve current Surfline conditions and tides through protected routes

**Files:**
- Create: `worker/live-data.js`
- Create: `test/worker/live-data.test.js`
- Create: `test/workerd/live-data-routes.test.js`
- Modify: `worker/router.js`
- Modify: `src/config.js`
- Modify: `test/spot-data.test.js`
- Modify: `test/tide-data.test.js`
- Modify: `test/runtime-package.test.js`

- [ ] **Step 1: Write failing live-data tests**

Require only these upstreams:

```js
const DATASETS = {
  conditions: "https://raw.githubusercontent.com/kuangc/surfcams-portugal/main/data/surfline-conditions.json",
  tides: "https://raw.githubusercontent.com/kuangc/surfcams-portugal/main/data/portugal-tides.json"
};
```

Test session requirement, no browser URL input, `redirect: "error"`, 4-second timeout, 256 KiB declared/streamed limit, JSON or text/plain MIME only, schema rejection, short cache reuse across different users without identity in the cache key/value, stale-but-valid data passthrough, bundled fallback, and preserved `generatedAt`/`fetchedAt` fields.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/worker/live-data.test.js
npm run test:worker -- test/workerd/live-data-routes.test.js
```

Expected: FAIL because the runtime still requests public static JSON.

- [ ] **Step 3: Implement exact-source bounded loaders**

Import bundled fallback JSON at build time. Export:

```js
export async function handleLiveData(request, env, {
  fetcher = fetch,
  now = () => Date.now()
} = {});
export function validateSurflineConditions(value);
export function validatePortugalTides(value);
```

Validate `schemaVersion === 1`, parseable `generatedAt`, conditions object entries with matching `id` and parseable `fetchedAt`, and tide `cameraStations`/`eventsByPort`/`daylightByPort` objects with parseable event times. Do not reject valid stale data; the frontend owns stale labeling. Cache validated serialized bytes for five minutes by dataset name only. Return `X-Surfcams-Data-Source: github` or `bundled`, but always send the original JSON shape.

- [ ] **Step 4: Change only the volatile frontend URLs**

Set:

```js
export const PORTUGAL_TIDES_URL = "/api/data/portugal-tides";
export const SURFLINE_CONDITIONS_URL = "/api/data/surfline-conditions";
```

Do not change the normalizers, rating precedence, stale labels, advice mappings, or either update workflow.

- [ ] **Step 5: Run data and workflow-preservation tests**

Run:

```bash
node --test test/worker/live-data.test.js test/spot-data.test.js test/tide-data.test.js test/forecast-sources.test.js test/meo-provider-data-integrity.test.js
npm run test:worker -- test/workerd/live-data-routes.test.js
shasum -a 256 .github/workflows/update-surfline-conditions.yml .github/workflows/update-tides.yml
```

Expected: all tests pass and the hashes exactly match **Locked boundaries**.

- [ ] **Step 6: Commit protected live data**

```bash
git add worker/live-data.js worker/router.js src/config.js test/worker/live-data.test.js test/workerd/live-data-routes.test.js test/spot-data.test.js test/tide-data.test.js test/runtime-package.test.js
git commit -m "feat: load current surf data behind sessions"
```

## Task 9: Finish source safety, documentation, and obsolete deployment cleanup

**Files:**
- Modify: `test/source-safety.test.js`
- Modify: `scripts/verify-sites-package.js`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Create: `docs/runbooks/sites-access.md`
- Create: `docs/runbooks/sites-release.md`
- Delete: `docs/runbooks/cloudflare-access.md`
- Delete: `docs/runbooks/cloudflare-release.md`
- Delete: `wrangler.jsonc`
- Delete: `wrangler.bootstrap.jsonc`
- Delete: `test/fixtures/wrangler-dry-run-secrets.env`

- [ ] **Step 1: Add failing whole-source safety assertions**

Scan deployable source and `dist` for Surfline camera media, Access assertions, Durable Object bindings, Cloudflare production deploy commands, Google/MEO/session secret literals, and direct player stream access. Extend the package verifier's forbidden-text pattern to `hls.cdn-surfline.com`, Surfline still hosts, `__rawSurflineFeeds`, `Cf-Access-Jwt-Assertion`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `MEO_TOKEN_COORDINATOR`. Assert the exact frozen workflow hashes and that the unchanged `validate.yml` runs `npm run verify`.

- [ ] **Step 2: Run safety tests and verify RED**

Run: `node --test test/source-safety.test.js`

Expected: FAIL while the obsolete configs/runbooks and Access/Durable Object descriptions remain.

- [ ] **Step 3: Replace operations documentation**

Document these exact operational responsibilities:

```text
Sites: project, D1, runtime values, saved versions, deployment, access mode
Google Cloud: one Web client, final Sites origin, consent branding, no client secret
Manage Users: pending review, approve, deny, revoke, restore, sign out all devices, audit history
GitHub Actions: unchanged Surfline conditions and Portugal tide refresh jobs
```

The access runbook must describe bootstrap owner binding, supported Gmail/Workspace identities, 30-day non-sliding sessions, immediate next-request revocation, and the accepted up-to-approximately-24-hour lifetime of an already-issued MEO URL. Include a reuse section that copies the auth module and migration into another Sites project while requiring that project's own D1 database, Google origin/client, bootstrap owner, users, sessions, and audit history; never point unrelated projects at this database. The release runbook must contain owner-only deploy, app-gate proof, explicit public-access approval, second-account test, physical iPhone test, rollback drill, and Pages retirement gates.

- [ ] **Step 4: Remove obsolete production deployment artifacts**

Delete the listed Wrangler production configs, dry-run secrets fixture, and Cloudflare runbooks. Keep `wrangler.test.jsonc`, Wrangler dev dependency, and Workerd tooling explicitly local-only.

- [ ] **Step 5: Run safety/build/docs checks and verify GREEN**

Run:

```bash
npm run build
npm run check:package
node --test test/source-safety.test.js
rg -n "Cf-Access-Jwt-Assertion|ACCESS_TEAM_DOMAIN|ACCESS_AUD|MEO_TOKEN_COORDINATOR|wrangler deploy" README.md CLAUDE.md docs/architecture.md docs/runbooks worker package.json .openai
```

Expected: build/package/tests pass; `rg` returns no production references; the two update-workflow hashes remain exact.

- [ ] **Step 6: Commit cleanup and runbooks**

```bash
git add test/source-safety.test.js scripts/verify-sites-package.js README.md CLAUDE.md docs/architecture.md docs/runbooks/sites-access.md docs/runbooks/sites-release.md
git add -u docs/runbooks wrangler.jsonc wrangler.bootstrap.jsonc test/fixtures package.json
git commit -m "docs: replace Cloudflare operations with Sites"
```

## Task 10: Reaccept the complete release candidate

**Files:**
- Modify only files required by failures found in this task.
- Record evidence in the release task output; do not commit credentials, raw tokens, signed URLs, personal emails, or live response bodies.

- [ ] **Step 1: Update from `origin/main` without altering the frozen workflows**

Run:

```bash
git fetch origin
git merge --no-edit origin/main
shasum -a 256 .github/workflows/update-surfline-conditions.yml .github/workflows/update-tides.yml
```

Expected: merge succeeds; both hashes still match **Locked boundaries**. If upstream intentionally changed either workflow, stop and reconcile that separately rather than silently reverting it.

- [ ] **Step 2: Run the complete fresh verification twice**

Run:

```bash
npm ci
npm run verify:fresh
npm run verify:fresh
```

Expected: both runs pass with the same test count and no flaky failures.

- [ ] **Step 3: Prove deterministic package contents**

Run two clean builds, copy only `dist/sites-package-manifest.json` after each build to temporary files, and compare them:

```bash
npm run build
cp dist/sites-package-manifest.json /private/tmp/surfcams-sites-manifest-a.json
npm run build
cp dist/sites-package-manifest.json /private/tmp/surfcams-sites-manifest-b.json
cmp /private/tmp/surfcams-sites-manifest-a.json /private/tmp/surfcams-sites-manifest-b.json
```

Expected: `cmp` exits 0.

- [ ] **Step 4: Run the redacted signed-MEO release probe**

Run:

```bash
npm run probe:meo-signed
npm run probe:meo-signed
```

Expected: both systemic representatives complete, hard systemic failures are zero, and the complete camera roster satisfies the already accepted required-success floor. Output must remain redacted and contain no token or signed URL.

- [ ] **Step 5: Review the exact diff and candidate tree**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only the approved Sites migration, retained MEO/UX work, tests, and documentation are present; worktree is clean after any corrective commit.

- [ ] **Step 6: Commit any evidence-driven fixes and tag the candidate SHA in notes**

For each real failure, add a regression test first, implement the smallest fix, rerun its focused test and `npm run verify:fresh`, then commit. Record `git rev-parse HEAD` and the manifest SHA-256 in the release checklist; do not create a Git tag before deployed acceptance.

## Task 11: Create and deploy the Sites project owner-only

**Files:**
- Modify: `.openai/hosting.json` only to persist the exact Sites `project_id`.
- Build output/archive are temporary and uncommitted.

- [ ] **Step 1: Re-read the current Sites building and hosting skills**

Read the complete installed `sites:sites-building` and `sites:sites-hosting` instructions immediately before using Sites. The root agent remains the sole Site owner; no subagent may call Sites tools, edit `.openai/hosting.json`, push the Sites source repository, save versions, deploy, or open the Sites tab.

- [ ] **Step 2: Confirm no existing surf project**

Call `sites_list_sites({ role: "owner", limit: 100 })` because `.openai/hosting.json` has no `project_id`. If an existing result is the already-created Surfcams project, use its exact opaque ID only after positively confirming it; otherwise continue once with creation.

- [ ] **Step 3: Create the project exactly once and persist its ID**

Call:

```text
sites_create_site({
  title: "Surfcams Portugal",
  slug: "surfcams-portugal",
  description: "Invitation-only Portugal surf cameras and wave information."
})
```

Immediately add the exact returned `id` as `project_id` in `.openai/hosting.json`, preserving `d1: "DB"` and `r2: null`. Commit that one metadata change.

- [ ] **Step 4: Rebuild and push the exact candidate to the Sites source repository**

After committing the project ID, run the exact reacceptance sequence:

```bash
npm run verify:fresh
npm run verify:fresh
npm run build
cp dist/sites-package-manifest.json /private/tmp/surfcams-sites-project-manifest-a.json
npm run build
cp dist/sites-package-manifest.json /private/tmp/surfcams-sites-project-manifest-b.json
cmp /private/tmp/surfcams-sites-project-manifest-a.json /private/tmp/surfcams-sites-project-manifest-b.json
npm run probe:meo-signed
npm run probe:meo-signed
git diff --check origin/main...HEAD
```

Expected: every command passes. Push the Sites source branch using the returned short-lived credential only as a per-command HTTP authorization header, and verify the pushed branch-head SHA equals local `git rev-parse HEAD`. Do not persist the token in a remote URL or Git config.

- [ ] **Step 5: Package and save one Sites version**

Run the installed helper with the exact project directory and a temporary archive path:

```bash
/Users/kuangchen/.codex/plugins/cache/openai-bundled/sites/0.1.43/scripts/package-site.sh /Users/kuangchen/workspace/surfcams-portugal/.worktrees/meo-only-cameras /private/tmp/surfcams-portugal-sites.tgz
```

Call `sites_save_site_version` with the exact project ID, pushed HEAD SHA, and archive path. Retain the returned version ID/number outside source.

- [ ] **Step 6: Deploy owner-only and poll to success**

Call `sites_get_site` and require verifiable owner-only custom access: current role owner, exactly one allowed account user, no external visitors, and no workspace/tenant groups. Call `sites_deploy_private_site_version` with the exact version ID, then poll `sites_get_deployment_status` until `succeeded` or `failed`.

Expected: production URL is created owner-only. The app may show its generic unavailable page because Google runtime values are intentionally not configured yet; `/healthz` must remain bounded and healthy.

## Task 12: Configure Google and prove the owner gate

**Files:**
- No source changes unless a verified defect is found.
- Hosted values are changed only through Sites.

- [ ] **Step 1: Configure one Google Web client at the final Sites origin**

In Google Cloud, create or reuse one Web client, set the exact Sites origin as an authorized JavaScript origin, set `${SITE_ORIGIN}/auth/google` as the authorized redirect/login URI when Google requires it, and complete consent branding. Use only basic identity. Do not create, copy, or store a Google client secret for this GIS credential-button flow.

- [ ] **Step 2: Configure the three runtime values in Sites**

Call `sites_update_environment_variables` with the exact project ID and:

```text
GOOGLE_CLIENT_ID       ordinary env value copied exactly from Google
BOOTSTRAP_OWNER_EMAIL  secret value containing the user-confirmed owner Gmail
SITE_ORIGIN            ordinary env value equal to the exact HTTPS Sites origin, with no trailing path
```

Mark only `BOOTSTRAP_OWNER_EMAIL` as secret. Do not write any of the values to `.openai/hosting.json` or release logs.

- [ ] **Step 3: Redeploy the same saved version owner-only**

Call `sites_deploy_private_site_version` again with the same saved version ID so the new env revision applies; poll status to `succeeded`.

- [ ] **Step 4: Bind and verify the bootstrap owner**

Open the Sites URL in the stable Sites browser tab. Confirm the page says exactly **Invitation only**, click the explicit Google button, sign in with the configured owner Gmail, and verify the owner reaches the app. Confirm Configure shows Manage Users with a zero pending count and the page has Pending, Approved, Revoked, and audit sections.

- [ ] **Step 5: Prove the app gate before public access**

With an authenticated Sites-owner transport but no app cookie, confirm `/` redirects to `/signin`, `/api/playback/praia-de-carcavelos` is denied, `/manage-users` is denied, and public CSS/JS/icons remain reachable. Confirm owner logout clears only the Surfcams session and returns to Invitation only.

If a defect is found, add a failing automated test, fix it, rerun Task 10, save a new version, and repeat the owner-only acceptance; never patch production source directly.

## Task 13: Open Sites access and complete live acceptance

**Files:**
- No source changes unless a verified defect is found.

- [ ] **Step 1: Obtain explicit approval to change Sites access to public**

Report that the Sites wrapper will become public while the application itself remains invitation-only. Do not call `sites_update_site_access` until the user explicitly approves this resolved access change.

- [ ] **Step 2: Change only the Sites access policy**

After approval, call:

Call `sites_update_site_access` with `access_mode: "public"` and the `project_id` copied verbatim from `.openai/hosting.json`.

Then call `sites_get_site` and require `access_mode: "public"` while the deployed version ID remains the accepted candidate.

- [ ] **Step 3: Test an anonymous visitor and a second Google account**

In a fresh anonymous browser, verify `/` shows Invitation only and no app/camera content. With a second supported Google account: sign in once, see the pending message and no session; repeat once and confirm no duplicate row; as owner approve it; sign in again and reach the app; sign out; sign in again; as owner revoke it while active; confirm its next protected request fails and refresh returns to Invitation only; restore it and confirm old sessions remain invalid until a new Google sign-in.

- [ ] **Step 4: Exercise the full product on desktop**

Verify current Surfline condition age, tide data, Monitor/Favorites/Explore, map selection, gallery playback, 60-second preview timing from first play, Focus, Compare, persistent Explore playback, token-refresh recovery, no Surfline camera imagery/media, Configure defaults, feedback export/import, Manage Users, and logout.

- [ ] **Step 5: Exercise physical iPhone Safari and A2HS**

On the iPhone-sized target and a physical iPhone, verify GIS account choice, standalone/A2HS launch, safe-area navigation, Add Camera keyboard/touch behavior, Monitor, Favorites, Focus, Compare, Explore map/detail hierarchy, rotation/background recovery, MEO playback, and logout. Confirm no control is clipped or obscured and the accepted 60-second rule still starts only after successful play.

- [ ] **Step 6: Confirm live data and playback evidence**

Confirm the protected conditions/tides responses show `github` when upstream is valid or explicitly `bundled` on a controlled upstream failure, while timestamps preserve stale labeling. Run the redacted signed-MEO probe again and require the Task 10 acceptance policy.

If any defect is found, return to RED/GREEN implementation, repeat Task 10, publish a new saved version with explicit public-deploy approval, and rerun all affected live checks.

## Task 14: Promote exact source, drill rollback, and retire GitHub Pages

**Files:**
- No product source changes during promotion.
- Release evidence contains only hashes, version numbers/IDs, timestamps, counts, and redacted outcomes.

- [ ] **Step 1: Push the exact accepted source to GitHub**

Verify local HEAD, Sites source branch HEAD, saved-version `commit_sha`, and the accepted package manifest all identify the same source. Push `codex/meo-only-cameras`, open/update the GitHub pull request, wait for Validate, merge to `main`, and verify the resulting main tree is byte-equivalent to the accepted candidate apart from the merge commit parentage.

- [ ] **Step 2: Save and deploy the exact `main` production version**

Fast-forward the release worktree to the merged `main` commit and validate it:

```bash
git fetch origin
git merge --ff-only origin/main
npm ci
npm run verify:fresh
```

Push that exact commit to the Sites source repository, rebuild, package with the installed Sites helper, and save a new Sites version whose `commit_sha` is the merged `main` HEAD. Require explicit approval to deploy this version to the already-public Site, call `sites_deploy_site_version`, poll to `succeeded`, and smoke test Invitation only, owner login, current data, and one MEO camera. The previously accepted feature-branch Sites version is now the functional rollback version.

- [ ] **Step 3: Prove scheduled refresh continuity**

Using GitHub Actions read-only checks, confirm the latest runs of `update-surfline-conditions.yml` and `update-tides.yml` are successful or diagnose a real failure without editing the workflows. After the next data commit (or a manual dispatch explicitly approved by the user), confirm the Sites protected routes reflect the new `main` timestamps without a Sites redeploy.

- [ ] **Step 4: Drill Sites rollback and restore production**

List saved versions and retain the production and rollback version IDs. Ask the user to approve the two public deployments that make up the rollback drill: rollback, then restore. After approval, deploy the prior functional Sites version, smoke test Invitation only/app gate/owner login/one MEO camera, then redeploy the accepted production version and repeat the smoke. Confirm D1 users/sessions/token tables survive and both code versions tolerate the additive migration.

- [ ] **Step 5: Obtain final approval and disable GitHub Pages**

Only after public app acceptance and rollback succeed, report the exact old Pages URL and ask for final approval to disable it. After approval, use the GitHub Pages API/CLI to disable Pages, verify the old URL no longer serves the app, and do not delete repository history or the Pages branch.

- [ ] **Step 6: Final release audit**

Require all of the following:

```text
Sites deployment succeeded and is public only at the wrapper layer
Anonymous visitor sees Invitation only and no app shell
Owner and approved viewer flows pass
Revoked viewer fails on next protected request
Manage Users actions and audit pass
MEO-only identity and signed playback probes pass
Surfline conditions/tides update without Sites redeploy
Desktop and physical iPhone acceptance pass
Rollback drill passes and production version is restored
GitHub Pages no longer serves the old app
Complete automated suite and package/source scans pass
```

- [ ] **Step 7: Mark the release and hand off**

Create a release tag only on the exact accepted `main` source after every gate passes. Report the Sites URL, invitation/approval workflow, where Manage Users lives, the unchanged daily data behavior, the approximately-24-hour signed-MEO revocation limitation, and the successful rollback/Pages retirement. Do not expose operational IDs, credentials, emails, or tokens.
