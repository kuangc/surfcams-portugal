# Cloudflare Release Runbook

This is the first-release and rollback procedure for the private
`surfcams-portugal` Worker. It implements the
[approved migration design](../superpowers/specs/2026-08-19-private-meo-worker-migration-design.md).
Use the companion [Cloudflare Access runbook](cloudflare-access.md) for identity
configuration and user operations.

## Non-negotiable Release Boundaries

- Deploy the content-free bootstrap first. Protect the complete Worker hostname
  with Access before deploying functional assets or the playback API.
- There is no Durable Object Preview URL. Cloudflare does not generate Preview
  URLs for Workers that implement a Durable Object. For the first release, the
  Access-protected production hostname is treated as staging until acceptance;
  keep non-production branch builds and preview deployments disabled.
- The first release starts with fresh local defaults at the new origin.
  Favorites and surf preferences in the legacy GitHub Pages origin's
  `localStorage` do not migrate, and that reset is expected.
- After the SQLite-backed Durable Object has been introduced, the first safe
  rollback target is the recorded accepted **functional** version. Never roll
  back to the pre-Durable-Object deny-only bootstrap.
- A Worker-version rollback does not roll back, version, or erase Durable
  Object storage. The stored token/revision state survives; only select a
  functional version compatible with that state.
- Keep GitHub Pages public only as the frozen pre-migration fallback during
  acceptance. Never publish the Worker-only `main` tree on Pages.
- Never record email addresses, OAuth values, Access assertions, provider
  tokens, signed URLs or queries, request headers, or secret binding values.

## 1. Prepare an Immutable Candidate

Close the scheduled-data race before acceptance:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

If the ancestry check fails, merge the latest `origin/main`, preserve both the
migration and newer bot data, and restart candidate validation. Never hand-edit
`data/surfline-conditions.json` or its `generatedAt` value.

From a clean checkout on Node 22, run:

```bash
npm ci
npm run verify:fresh
npm run probe:meo-signed
git diff --check
git status --porcelain
```

`npm run probe:meo-signed` is a manual network acceptance probe. It prints
only redacted camera/phase outcomes and must not run in GitHub CI or Workers
Builds. If the freshness gate is stale, run or wait for the unchanged
`update-surfline-conditions.yml` workflow on `main`, merge its accepted commit,
and restart the checks; do not manufacture fresh data.

The output must be clean and every gate must pass. Then record these non-secret
values in ignored `.wrangler/private-meo-release-record.md`:

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
shasum -a 256 dist/asset-manifest.json
git hash-object .github/workflows/update-surfline-conditions.yml
```

Label the candidate commit, tree, asset-manifest digest, Surfline workflow blob,
and protected hostname placeholder. Do not make a source or data change after
recording them. Any required change creates a new candidate and repeats this
section.

## 2. Deploy the Deny-only Bootstrap

Authenticate Wrangler as the owner and deploy only the harmless bootstrap:

```bash
npm exec -- wrangler whoami
npm run cf:bootstrap
```

Before Access exists, verify that `/`, an unknown path, and a playback API path
all return the same bounded 503 JSON. The bootstrap must expose no HTML, runtime
data, playback behavior, static asset binding, token, or Durable Object.

Configure Google, the exact-email policy, and a seven-day application/policy
session using the [Access runbook](cloudflare-access.md). In a fresh anonymous
browser, prove Access intercepts both `/` and `/api/playback/<camera-id>` before
continuing.

Set the functional Worker's JWT verification values interactively:

```bash
npm exec -- wrangler secret put ACCESS_TEAM_DOMAIN
npm exec -- wrangler secret put ACCESS_AUD
```

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker secrets. The Google OAuth
client secret remains only in Cloudflare Access; it is never a Worker or
Workers Builds value.

## 3. Use the Protected Hostname as Staging

Because no Durable Object Preview URL exists, manually deploy the exact
recorded candidate to the now-protected production hostname while the legacy
Pages site remains the public application:

```bash
git status --porcelain
git rev-parse HEAD
git rev-parse HEAD^{tree}
npm run build
shasum -a 256 dist/asset-manifest.json
npm run deploy
```

The commit, tree, and manifest digest must match the candidate record. Copy the
exact Worker version ID printed by Wrangler; do not infer it from list order.
Inspect that version directly:

```bash
CANDIDATE_VERSION_ID="<exact candidate version ID>"
npm exec -- wrangler versions view "$CANDIDATE_VERSION_ID" --json
```

Require binding `MEO_TOKEN_COORDINATOR` with class
`MeoTokenCoordinator`, then add only the version ID and protected hostname to
the local record. Keep non-production branch builds off.

### Protected acceptance

Complete all of the following on the protected candidate:

- anonymous root and API interception;
- owner Google login and Access-log confirmation;
- denial of an unlisted Google account;
- adding a second exact email and proving it can sign in;
- removing that email and proving it cannot create a new session;
- revoking its active Access session and proving existing app/API access ends;
- Settings → Sign out and the `/cdn-cgi/access/logout` flow;
- if required, exact-email PIN fallback and denial of an unlisted PIN address;
- recorded `npm run verify` evidence for missing, malformed, expired,
  wrong-issuer, wrong-audience, and valid assertion handling; do not inject
  fabricated assertions through the deployed Access application;
- desktop and physical-iPhone Safari/A2HS behavior across gallery, Favorites,
  Focus/Compare, Explore, map, fullscreen, rotation, and lifecycle restoration;
- exact 60-second gallery timing after playback starts and untimed
  Focus/Compare playback;
- one forced signed-media refresh followed by pane-local failure and Retry on a
  repeated fatal error;
- direct MEO HLS after the protected playback API, with no Surfline camera
  media request; and
- Surfline conditions, forecasts, ratings, and advice remaining independent of
  playback.

Confirm that fresh default favorites and surf preferences appear at this new
origin. That is first-release behavior, not data loss.

Record only pass/fail evidence without identities or sensitive request data.
An already-issued MEO signed URL may remain usable for the observed maximum of
24 hours after Access removal, session revocation, or logout.

## 4. Push, Validate, and Freeze the Legacy Pages Source

Immediately before pushing, fetch again and require `origin/main` to remain an
ancestor of the accepted candidate. If it does not, merge, rebuild, record,
redeploy, and reaccept a new candidate.

Push `codex/meo-only-cameras`, open or update its pull request, and require the
GitHub Validate job to pass. The job installs with `npm ci` and runs
`npm run verify`; it never runs a live MEO or Surfline probe.

Before changing `main`, check whether `codex/pages-legacy-hold` already exists.
If it does, inspect and verify its intended frozen tree; do not overwrite it.
If it does not exist, freeze the still-public Pages source at the previous
working production tree:

```bash
git branch codex/pages-legacy-hold origin/main
git push origin codex/pages-legacy-hold
```

In GitHub Settings → Pages, set the source to `codex/pages-legacy-hold` at
`/ (root)`. Wait for deployment, then confirm both the configured source and
the unchanged public fallback:

```bash
gh api repos/kuangc/surfcams-portugal/pages --jq '.source'
curl -fsSL https://kuangc.github.io/surfcams-portugal/ > /dev/null
```

Keep `codex/pages-legacy-hold` frozen. Never point Pages at migrated `main`:
the Worker client requires a same-origin playback API that Pages cannot serve.

## 5. Promote the Exact Candidate and Enable Workers Builds

Recheck `origin/main` ancestry immediately before merge. Merge the reviewed PR
without source edits, fetch, and compare:

```bash
git fetch origin
git rev-parse origin/main
git rev-parse origin/main^{tree}
```

The accepted `origin/main` tree must equal the recorded candidate tree exactly.
If it differs, do not enable Workers Builds; accept and deploy the actual main
tree first.

Only after exact-tree proof, connect the official GitHub App in the Worker's
Build settings:

| Setting | Required value |
| --- | --- |
| Repository | `kuangc/surfcams-portugal` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run verify` |
| Deploy command | `npm run deploy` |
| Non-production branch builds | Disabled |
| Path exclusions | None |
| Build cache | Disabled for the first release |

Require the first build's source SHA and asset-manifest digest to match the
accepted main record. Copy its exact production version ID, inspect it with
`wrangler versions view <ID> --json`, require the Durable Object binding/class,
and smoke-test the protected hostname again.

Create a draft GitHub Release targeted at the accepted main commit from the
sanitized local record. Keep it draft until bot deployment, rollback, and Pages
shutdown are proven.

## 6. Validate an Unchanged Surfline Bot Deployment

Wait for the next data-changing scheduled run or manually dispatch the existing
`update-surfline-conditions.yml` workflow on `main`. Do not edit that workflow.
If a run produces no change, wait for a later data-changing run.

For the first actual `chore(data): refresh surfline conditions` commit, prove:

1. the unchanged workflow succeeded and changed only the accepted data file;
2. Workers Builds received that exact `main` commit SHA;
3. `npm run verify` and the Worker deployment succeeded;
4. after Access login, `/data/surfline-conditions.json` exposes the new
   `generatedAt` value;
5. static assets, Access, and MEO playback remain healthy; and
6. the resulting exact Worker version contains `MEO_TOKEN_COORDINATOR` /
   `MeoTokenCoordinator`.

Record the bot commit, Workers Build source SHA, and exact production version
ID. Do not shut down Pages until this bot-commit validation passes.

## 7. Drill a Functional-version Rollback

Copy the candidate and current production IDs from the release record, not from
list order, and inspect both:

```bash
npm exec -- wrangler versions list
CANDIDATE_VERSION_ID="<recorded accepted functional version>"
PRODUCTION_VERSION_ID="<recorded current production version>"
npm exec -- wrangler versions view "$CANDIDATE_VERSION_ID" --json
npm exec -- wrangler versions view "$PRODUCTION_VERSION_ID" --json
```

Both must contain the named Durable Object binding and class. The first safe
rollback target is the accepted functional candidate. **Never select the
pre-Durable-Object bootstrap.** Cloudflare cannot safely cross the Durable
Object lifecycle change, and the bootstrap is not a functioning application.

In Cloudflare Versions & Deployments:

1. send 100% of traffic to the recorded accepted functional candidate;
2. verify Access login, assets, one gallery camera, untimed Focus, Explore, and
   the playback API;
3. restore 100% to the recorded current production version; and
4. repeat the smoke test and confirm no gradual traffic split remains.

Worker rollback does not roll back Durable Object storage. It neither restores
an older token record nor erases the current revision; verify code/storage
compatibility before every rollback. Record the two tested version IDs, both
smoke results, and that the Durable Object state remained compatible.

## 8. Shut Down Public GitHub Pages

After the protected production build, real bot commit, and rollback drill all
pass, confirm Pages still points to `codex/pages-legacy-hold`. In GitHub Settings
→ Pages choose **None/Unpublish**. If using the API, inspect the exact target
before deleting only that Pages site:

```bash
gh api repos/kuangc/surfcams-portugal/pages
gh api --method DELETE repos/kuangc/surfcams-portugal/pages
```

Verify the protected Worker remains healthy, the Pages API returns 404, and the
legacy URL no longer serves the application. Treat CDN propagation delay as a
separate observation. Keep the frozen `codex/pages-legacy-hold` branch for the
documented emergency procedure; deleting it is a later, separate decision.

## 9. Emergency Re-enable of the Legacy Site

Use this only when the protected Worker and its accepted functional rollback
target cannot restore service, and the owner explicitly accepts temporarily
making the old pre-migration application public again.

1. Verify `codex/pages-legacy-hold` still has the recorded frozen tree. Do not
   update it from `main`.
2. In GitHub Settings → Pages, choose Deploy from a branch and select
   `codex/pages-legacy-hold` at `/ (root)`.
3. Wait for Pages deployment and verify the legacy URL serves that exact old
   static application.
4. Record the emergency start, reason, and hold-branch tree without identities
   or secrets.
5. Recover the private Worker by rolling to an accepted **functional** Worker
   version or deploying and accepting a new candidate. Do not use the bootstrap
   as a rollback target.
6. Repeat anonymity, authentication, playback, bot-build, and rollback checks
   as applicable, then unpublish Pages again.

The emergency Pages site has no Cloudflare Access and no same-origin Worker
API. It is a public legacy fallback, not a replacement architecture.

## 10. Close the Release Record

The final record must contain the protected hostname; candidate and accepted
main commit/tree; asset digest; unchanged Surfline workflow blob; accepted
candidate, first Workers-Build, bot-build, and current version IDs; sanitized
Access/iPhone results; bot proof; rollback proof; Pages API 404; and
`codex/pages-legacy-hold` as the emergency source.

Before publishing the draft release, scan the record:

```bash
rg -n "Cf-Access-Jwt-Assertion|wmsAuthSign|nimblesessionid|client_secret|@" \
  .wrangler/private-meo-release-record.md
```

The scan must return no match. Inspect the rendered draft before publishing it.

## References

- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Worker Preview URL limitations](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Cloudflare Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
