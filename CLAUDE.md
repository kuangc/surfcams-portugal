# CLAUDE.md

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
npm run cache-surfline
npm run build-coast-exposures
npm run build-spot-metadata-enrichment
npm run build-surfline-needs-review
```

`cache-surfline-browser` writes full Surfline HTML into `.cache/surfline/pages/` and marks each page metadata file with `cacheStatus: "browser-fetched"` and `source: "chrome-cdp"`. `cache-surfline` rebuilds the mapping-review artifacts from that cache after the MEO-to-Surfline remap has been regenerated. It should not synthesize provider snapshot placeholder HTML when direct provider fetches are blocked.

`build-meo-surfline-matches` preserves curated MEO-to-Surfline joins first, then generates conservative nearest-neighbor joins from the normalized Surfline cache. `build-coast-exposures` consumes that mapping but excludes coordinate-only `needs-review` joins from runtime exposure. `build-spot-metadata-enrichment` writes the compact MEO-keyed surf metadata layer used by the app, also excluding `needs-review`. `build-surfline-needs-review` writes the local feedback interface at `docs/surfline-needs-review.html`.

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

The CI workflow exists for manual dispatch, but its schedule remains commented out until the runner probe validates a Surfline transport from GitHub runners.
