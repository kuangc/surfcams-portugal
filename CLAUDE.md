# CLAUDE.md

## Spot Advice Research and Review

`data/spot-advice.json` is the hand-reviewed canonical research file. Its schema v1 is display-only: advice may describe thresholds and fit, but it never changes provider estimates, local estimates, or surf ratings. `data/spot-advice-resolved.json` is generated and must not be hand-edited.

Use these exact commands to build, validate, and review the advice:

```sh
npm run build-spot-advice
npm run check-spot-advice
npm run build-spot-advice-review
npm run apply-spot-advice-feedback -- .local/spot-advice-feedback.json
```

The review cockpit is `.local/spot-advice-review.html`. `.local/` is local-only, gitignored, and never deployed. Its browser state is recovery state, not the source of truth. Export a complete schema-v1 feedback document before applying edits.

Feedback contains a `baseDigest`. The apply command rejects stale feedback, validates the complete candidate, rechecks the canonical digest before its atomic rename, and then rebuilds the runtime artifact. Do not bypass that digest guard or copy browser-state fragments directly into `data/spot-advice.json`. Read back the canonical file and run `npm run check-spot-advice` after applying feedback.

Source-link health is a separate, non-deterministic operator check:

```sh
npm run check-spot-advice-links
```

It audits accepted HTTP(S) evidence with bounded requests and exits nonzero for unreachable sources. Run it manually and investigate failures; never add it to deterministic CI, because remote sites may throttle or block automated requests.

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

`cache-surfline-browser` writes full Surfline HTML into `.cache/surfline/pages/` and marks each page metadata file with `cacheStatus: "browser-fetched"` and `source: "chrome-cdp"`. `cache-surfline` rebuilds the mapping-review artifacts from that cache after the MEO-to-Surfline remap has been regenerated. It should not synthesize provider snapshot placeholder HTML when direct provider fetches are blocked.

`build-meo-surfline-matches` classifies generated joins with the name-first cam-at-spot rule (name match within 3km, else proximity ≤0.2km; name trust disabled in the Caparica ambiguity zone) and preserves curated and rejected rows verbatim. `extract-surfline-conditions` writes the volatile `data/surfline-conditions.json` (metric units; fresh nearby records override primaries staler by >6h). `build-coast-exposures` and `build-spot-metadata-enrichment` consume the mapping but exclude `needs-review` and `rejected` joins from runtime. `build-promoted-spots` applies the trusted-cam gate to `data/surfline-promotions.json` (expected split: 36 spot / 6 stretch / 2 deferred). `build-surfline-needs-review` and `build-promotion-map` write the local curation interfaces at `docs/surfline-needs-review.html` and `docs/surfline-promotion-map.html`; apply exported feedback with `node scripts/apply-mapping-feedback.js <feedback.json>`.

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
