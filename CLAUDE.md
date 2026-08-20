# CLAUDE.md

## Worker Development

Use Node 22. The exact local version is recorded in `.node-version`, and
`package-lock.json` is the reviewed dependency graph. Start a clean checkout
with the locked install and the same deterministic gate used by GitHub
validation and Cloudflare Workers Builds:

```sh
npm ci
npm run verify
```

The relevant commands are:

- `npm run build` creates the allowlisted, deterministic `dist/` package.
- `npm test` runs the Node and Workerd suites.
- `npm run check:worker` performs the Wrangler dry run with test-only fixture
  values.
- `npm run verify` combines the deterministic build, test, spot-advice, and
  Worker checks. It is the clean-checkout CI gate.
- `npm run verify:fresh` adds the six-hour Surfline conditions freshness guard.
  Use it for candidate and live-release acceptance, not every arbitrary push.
- `npm run dev` starts the repository-root static server on loopback. It does
  not emulate Cloudflare Access, the Worker playback API, or Durable Object
  storage, so it cannot prove authenticated playback.
- `npm run probe:meo-signed` performs the redacted, network-dependent MEO live
  probe. It is an owner-run release check only and must never run in CI.

### Worker layout

- `worker/index.js` exports the functional Worker and
  `MeoTokenCoordinator` class.
- `worker/router.js` routes `/api/*` through the independent Access JWT check
  and sends other requests to the `ASSETS` binding.
- `worker/access-jwt.js` verifies the Access JWT signature, issuer, audience,
  and expiry.
- `worker/playback-catalog.js`, `worker/meo-token.js`, and
  `worker/playback-api.js` enforce the immutable MEO catalog and bounded API
  contract.
- `worker/meo-token-coordinator.js` and `worker/token-coordinator-core.js` own
  the fixed-name, SQLite-backed Durable Object token record and conditional
  refresh behavior.
- `src/playback-client.js` keeps signed playback responses in browser memory;
  `src/video-player.js` owns the one-refresh, generation-safe player lifecycle.
- `scripts/build-runtime-assets.js` copies only reviewed runtime assets into
  ignored `dist/` and writes `dist/asset-manifest.json`.
- `wrangler.bootstrap.jsonc` deploys the bounded deny-only bootstrap.
  `wrangler.jsonc` deploys the functional Worker with `ASSETS` and
  `MEO_TOKEN_COORDINATOR`.

### Authentication and secret boundaries

Cloudflare Access is the authorization layer. Its policy—not Worker code—must
allow only exact approved email addresses. The Worker independently verifies
the Access assertion's signature, issuer, audience, and expiry as defense in
depth; it does **not** authorize an email address itself. Never add an email
allowlist to the repository or infer that a cryptographically valid assertion
is sufficient without the outer Access policy.

The Google OAuth client secret belongs only in the Cloudflare Access identity
provider. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker secrets and must be
set interactively with `wrangler secret put`; do not put real values in source,
`.dev.vars`, shell history, fixtures, GitHub, build output, or release notes.
The committed dry-run fixture contains non-production values only.

Never log, persist to disk, or commit an Access assertion, MEO token, complete
signed playlist URL or query, `wmsAuthSign`, `nimblesessionid`, request header,
upstream response body, or a detailed viewing history. The provider token is
stored only by the named Durable Object. A signed URL may exist only in the
authenticated response and browser memory required for playback; the opaque
revision also belongs to the Durable Object record used for conditional
refresh. No API may accept a caller-provided upstream URL.

Keep live provider probes out of the Validate workflow and Cloudflare Workers
Builds. In particular, `npm run probe:meo-signed`,
`npm run check-spot-advice-links`, browser Surfline probes, and ad hoc
production probes are manual operator actions. The separate, unchanged
`update-surfline-conditions.yml` scheduled workflow is the deliberate
exception: it performs the accepted live headed-Chrome/CDP refresh, validates
the result, and commits only accepted conditions data for a later deterministic
Workers Build.

The approved migration behavior and security decisions are documented in
`docs/superpowers/specs/2026-08-19-private-meo-worker-migration-design.md`.

## Spot Advice Research and Review

`data/spot-advice.json` is the hand-reviewed canonical research file. Its schema v1 is display-only: advice may describe thresholds and fit, but it never changes provider estimates, local estimates, or surf ratings. `data/spot-advice-resolved.json` is generated and must not be hand-edited.

Prepare and validate the runtime artifact, then generate the review cockpit with:

```sh
npm run build-spot-advice
npm run check-spot-advice
npm run build-spot-advice-review
```

The review cockpit is `.local/spot-advice-review.html`. `.local/` is local-only, gitignored, and never deployed. Its browser state is recovery state, not the source of truth. Export a complete schema-v1 feedback document before applying edits.

After exporting feedback, apply the canonical edit, rebuild the runtime artifact, and then verify that artifact is current:

```sh
npm run apply-spot-advice-feedback -- .local/spot-advice-feedback.json
npm run build-spot-advice
npm run check-spot-advice
```

Feedback contains a `baseDigest`. The apply command does not rebuild the runtime artifact; it rejects stale feedback, validates the complete candidate, rechecks the canonical digest before its atomic rename, and updates only `data/spot-advice.json`. Do not bypass that digest guard or copy browser-state fragments directly into `data/spot-advice.json`. Read back the canonical file after applying feedback, then run the post-export build and check sequence above.

Source-link health is a separate, non-deterministic operator check:

```sh
npm run check-spot-advice-links
```

It audits accepted HTTP(S) evidence with bounded requests and exits nonzero for unreachable sources. Run it manually and investigate failures; never add it to deterministic CI, because remote sites may throttle or block automated requests.

GitHub Actions dependencies are pinned to full commit SHAs with release-version comments. Dependabot checks them weekly; review its release link and official tag ref before accepting a pin update.

## Surfline Cache Refresh

Direct `curl`, Node `fetch`, and headless Chrome can hit Surfline Cloudflare 403 responses. Do not generate placeholder Surfline HTML. The reliable refresh path is a headed Chrome session that has loaded a Surfline report page, followed by Chrome DevTools Protocol fetches from inside that browser context.

1. Launch a separate temporary Chrome session with remote debugging:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9333 \
  --user-data-dir=/private/tmp/surfline-cdp-profile-9333 \
  --no-first-run \
  --no-default-browser-check \
  --new-window "https://www.surfline.com/surf-report/praia-da-cruz-quebrada/640b9d294878ebc4c91e3d61"
```

2. Wait until the tab shows a real Surfline report title, not `Just a moment...`.

3. Refresh the real provider cache and rebuild derived data:

```sh
npm run cache-surfline-browser -- --port=9333 --batch-size=4 --delay-ms=300
npm run build-surfline-spots
npm run build-meo-surfline-matches
npm run extract-surfline-conditions
npm run cache-surfline
npm run build-coast-exposures
npm run build-spot-metadata-enrichment
npm run build-promoted-spots
npm run build-surfline-needs-review
npm run build-promotion-map
```

`cache-surfline-browser` writes full Surfline HTML into `.cache/surfline/pages/` and marks each page metadata file with `cacheStatus: "browser-fetched"` and `source: "chrome-cdp"`. `cache-surfline` rebuilds the mapping-review artifacts from that cache after the MEO-to-Surfline remap has been regenerated. For a camera-only MEO refresh, use `npm run cache-surfline -- --offline` to reuse the committed review metadata without touching the provider cache. It should not synthesize provider snapshot placeholder HTML when direct provider fetches are blocked.

`build-meo-surfline-matches` classifies generated joins with the name-first cam-at-spot rule (name match within 3km, else proximity ≤0.2km; name trust disabled in the Caparica ambiguity zone) and preserves curated and rejected rows verbatim. `extract-surfline-conditions` writes the volatile `data/surfline-conditions.json` (metric units; fresh nearby records override primaries staler by >6h). `build-coast-exposures` and `build-spot-metadata-enrichment` consume the mapping but exclude `needs-review` and `rejected` joins from runtime. `build-promoted-spots` applies the trusted-cam gate to `data/surfline-promotions.json` (expected split: 34 spot / 8 stretch / 2 deferred). `build-surfline-needs-review` and `build-promotion-map` write the local curation interfaces at `docs/surfline-needs-review.html` and `docs/surfline-promotion-map.html`; apply exported feedback with `node scripts/apply-mapping-feedback.js <feedback.json>`.

4. Verify that the cache is real provider HTML:

```sh
node --input-type=module -e '
import fs from "node:fs/promises";
import path from "node:path";
const dir = ".cache/surfline/pages";
const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json"));
let browserFetched = 0;
let generatedMarkers = 0;
let missingNextData = 0;
for (const file of files) {
  const meta = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
  const html = await fs.readFile(path.join(dir, file.replace(/\.json$/, ".html")), "utf8");
  if (meta.cacheStatus === "browser-fetched") browserFetched += 1;
  if (html.includes("x-surfcams-cache-kind")) generatedMarkers += 1;
  if (!html.includes("__NEXT_DATA__")) missingNextData += 1;
}
console.log({ pages: files.length, browserFetched, generatedMarkers, missingNextData });
'
npm test
```

5. Stop the temporary Chrome profile when finished:

```sh
pkill -f "/private/tmp/surfline-cdp-profile-9333"
```

### Daily conditions refresh

With the headed Chrome session from step 1 running and past Cloudflare, run:

```sh
scripts/refresh-surfline-daily.sh
```

The daily runner checks for Chrome CDP on `:9333`, skips cleanly when it is unavailable, then refreshes conditions with the CDP transport: compute the set-cover plan (~3 pages), extract conditions, validate freshness, and create a data-only commit for `data/surfline-conditions.json` when it changed.

Use the offline staleness guard directly with:

```sh
node scripts/check-conditions-freshness.js
```

The CI workflow (`update-surfline-conditions.yml`) now runs the refresh on a daily schedule directly from GitHub-hosted runners: it launches a real headful Chrome under xvfb and uses the same in-browser CDP fetch path, which `probe-surfline-browser.yml` proved passes Surfline's Cloudflare from a datacenter IP. `scripts/refresh-surfline-daily.sh` (headed Chrome on a home IP) remains the documented fallback if Cloudflare ever tightens against runner IPs — re-run the browser probe to check.
