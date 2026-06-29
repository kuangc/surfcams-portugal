# Architecture

Surfcams Portugal is a static web app. It has no backend, build step, database server, or package dependencies.

## Runtime

- `index.html` defines the page shell and embeds the current camera database in `#embeddedCameraDb`.
- `src/main.js` owns the UI controller for map markers, filters, list rows, details, and events.
- `src/camera-data.js` loads the embedded DB first and falls back to `data/beachcam-cameras.json`.
- `src/spot-data.js` loads optional normalized Surfline, MEO, mapping, coast exposure, spot metadata enrichment, and Lisbon drive estimate JSON files.
- `src/favorites.js` owns default favorites and browser persistence.
- `src/surf-rating.js` maps camera conditions into Surfline-style model labels, applies spot-level shelter/exposure mechanics where known, and exposes wind, swell, and coast-exposure vectors for the UI.
- `src/video-player.js` owns HLS playback and lazy-loads hls.js only when the browser needs it.
- `src/styles/app.css` contains the app layout and visual system.

## Data Pipeline

- `scripts/crawl-beachcam.cjs` crawls public Beachcam/MEO livecam pages and writes `data/beachcam-cameras.json`.
- `scripts/build-spot-data.js` normalizes the Beachcam/MEO camera index into `data/meo-spots.json` and deterministic central Lisbon drive estimates into `data/lisbon-drive-estimates.json`.
- `scripts/cache-surfline-pages.js` builds Surfline mapping-review artifacts from cached HTML and can direct-fetch pages when Surfline allows it; it does not synthesize placeholder HTML when direct fetches are blocked.
- `scripts/cache-surfline-browser-cdp.js` fetches real Surfline HTML through a Chrome DevTools Protocol session after Chrome has passed Surfline's browser challenge.
- `scripts/build-surfline-spots.js` rebuilds `data/surfline-spots.json` from cached Surfline HTML, including primary report pages and embedded nearby spot records within 100km of central Lisbon.
- `scripts/build-meo-surfline-matches.js` remaps cached Surfline spots onto MEO camera rows, preserving curated mappings first and marking coordinate-only generated joins for review.
- `scripts/build-coast-exposures.js` aggressively extracts coast-facing bearings into `data/coast-exposures.json` from normalized Surfline metadata, MEO description cues, existing rating fallbacks, and regional heuristics.
- `scripts/build-spot-metadata-enrichment.js` writes `data/spot-metadata-enrichment.json`, a compact MEO-keyed layer of Surfline surf mechanics, source spot evidence, and coast exposure metadata for runtime enrichment.
- `scripts/build-surfline-needs-review-html.js` writes `docs/surfline-needs-review.html`, a local feedback interface for coordinate-only mappings that are excluded from runtime until curated.
- `scripts/embed-camera-db.js` embeds that JSON into `index.html` so the default app load does not depend on a separate JSON fetch.
- `data/surfline-spots.json` stores normalized Surfline spots within 100km of central Lisbon, provider report URLs, coordinates, stable spot metadata, current provider snapshots, and the daily/hourly concepts that should be refreshed when a live integration is added.
- `data/meo-surfline-matches.json` maps one MEO camera to one or more nearby Surfline reports using curated joins plus generated nearest-neighbor evidence that still needs user calibration.
- `data/coast-exposures.json` is intentionally hand-curatable: each entry keeps the chosen bearing, confidence, source, and evidence used by the extractor.
- `data/spot-metadata-enrichment.json` is the MEO-keyed Surfline metadata enrichment layer consumed by `src/spot-data.js`.
- `docs/surfline-meo-metadata-comparison.md` records the current source-quality comparison and source-precedence decision.
- `.cache/beachcam/` stores crawl responses locally and is not committed.
- `.cache/surfline/pages/` stores cached Surfline HTML and per-page provenance metadata locally and is not committed.

## Deployment

The repository can be served as static files from GitHub Pages. Use the root directory as the Pages source.
