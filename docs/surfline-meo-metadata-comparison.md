# Surfline vs MEO Metadata Comparison

Updated: 2026-08-19

## Source Decision

Use Surfline as the preferred source for surf-specific spot metadata when it exists. Use MEO/Beachcam as the preferred source for the live camera inventory, stream URLs, local camera pages, and descriptions where Surfline is missing.

Surfline is better for:

- Provider spot identity: `remoteSpotId`, report URL, coordinates, region.
- Surf mechanics: break type, bottom, ability levels, board types, guide summary.
- Spot-facing exposure: normalized into `staticMetadata.coastExposure` from Surfline `offshoreDirection`.
- Current surf model snapshot: conditions, rating, surf height, wind, swells, tide, weather, water temperature.

MEO/Beachcam is better for:

- Camera inventory coverage: 190 provider-native camera records, 154 with playable feeds.
- Live stream and camera page metadata.
- Portuguese local descriptions, which are useful as fallback cues.

## Current Coverage

Surfline within 100km of central Lisbon:

- 80 normalized Surfline spots in `data/surfline-spots.json`.
- 80 cached HTML files in `.cache/surfline/pages`.
- The 80 local cache sources were browser-fetched; the committed mapping-review rows are currently marked `reused-review` because the MEO-key refresh reused those validated cached results offline.
- 80 have current Surfline snapshot data.
- 35 have Surfline-derived `coastExposure`.
- 26 have Surfline `travelDetails`.
- 31 have guide summaries.
- 80 have breadcrumb metadata.

MEO/Beachcam:

- 190 normalized MEO/Beachcam entries in `data/meo-spots.json`, with 154 unique playable provider feeds.
- Better inventory breadth, but weaker structured surf mechanics.

MEO-keyed enrichment:

- 88 MEO-to-Surfline mapping rows in `data/meo-surfline-matches.json`.
- 10 mappings are curated and preserved ahead of generated joins.
- 78 mappings are generated from cached Surfline coordinates and names.
- 23 generated mappings are coordinate-nearby `needs-review` joins; one rejected mapping remains preserved.
- 64 MEO-keyed entries in `data/spot-metadata-enrichment.json`; 47 have guide summaries, 40 have break type, 49 have ability metadata, 40 have bottom metadata, and all 64 carry coast exposure metadata.

## Exposure Layer

`data/coast-exposures.json` is the hand-curatable layer. Current extraction result:

| Source | Count | Meaning | Examples |
| --- | ---: | --- | --- |
| `surfline-metadata` | 59 | Spot-level or nearby Surfline exposure from normalized Surfline metadata, selected through curated/generated MEO-to-Surfline mappings. Coordinate-only joins keep `needs-review`. | `praia-de-carcavelos` 188, `praia-do-guincho` 280, `costa-da-caparica` 260 |
| `meo-description` | 3 | Directional cue found in the MEO description text. | `praia-das-bicas` west-facing, `faja-da-areia` north-facing, `seixal` north-facing |
| `legacy-spot` | 2 | Existing spot-level exposure fallback from `src/surf-rating.js`. | `carcavelos-calhau`, `carcavelos-calhau-estatica` |
| `legacy-regional` | 20 | Existing named regional exposure fallback. | regional cameras retained from the prior rated catalog |
| `region-heuristic` | 90 | Aggressive broad regional estimate for otherwise-uncovered spots. | `praia-de-matosinhos`, `praia-da-barra`, `paredes-da-vitoria` |
| `unknown` | 16 | No reliable source yet; needs hand curation. | island/river cameras without a defensible facing bearing |

Finite exposures: 174 of 190 entries.

Review status:

- 174 generated entries.
- 23 Surfline coordinate-nearby mappings remain marked `needs-review`.
- 16 unknown entries are marked `needs-curation`.

## Refresh Order

Use this order after changing Surfline cache inputs:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9333 \
  --user-data-dir=/private/tmp/surfline-cdp-profile-9333 \
  --no-first-run \
  --no-default-browser-check \
  --new-window "https://www.surfline.com/surf-report/praia-da-cruz-quebrada/640b9d294878ebc4c91e3d61"
npm run cache-surfline-browser -- --port=9333 --batch-size=4 --delay-ms=300
npm run build-surfline-spots
npm run build-meo-surfline-matches
npm run cache-surfline
npm run build-coast-exposures
npm run build-spot-metadata-enrichment
npm run build-surfline-needs-review
```

`cache-surfline-browser` expects an open Chrome session with remote debugging enabled and a Surfline report page already loaded past the Cloudflare challenge. It fetches pages from inside that browser session, writes real full HTML, and marks cache metadata as `browser-fetched`. `cache-surfline` then regenerates the mapping review from the refreshed cache. For an MEO-only identity refresh that intentionally does not touch Surfline inputs, use `npm run cache-surfline -- --offline` to reuse the committed reviewed page metadata.

Generated `needs-review` mappings are excluded from runtime enrichment until curated. Review them in `docs/surfline-needs-review.html`, then apply accepted mappings as curated rows.
