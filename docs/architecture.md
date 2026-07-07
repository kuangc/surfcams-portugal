# Architecture

Surfcams Portugal is a static web app. It has no backend, build step, database server, or package dependencies.

## Runtime

- `index.html` defines the page shell and embeds the current camera database in `#embeddedCameraDb`.
- `src/main.js` owns the UI controller for map markers, filters, list rows, details, and events.
- `src/camera-data.js` loads the embedded DB first and falls back to `data/beachcam-cameras.json`.
- `src/spot-data.js` loads optional normalized Surfline, MEO, mapping, coast exposure, spot metadata enrichment, and Lisbon drive estimate JSON files.
- `src/favorites.js` owns default favorites and browser persistence.
- `src/surf-rating.js` maps camera conditions into Surfline-style model labels, applies spot-level shelter/exposure mechanics where known, and exposes wind, swell, and coast-exposure vectors for the UI. With resolved conditions it checks the min–max surf range and hard-vetoes on Surfline `POOR`/`VERY_POOR`.
- `src/forecast-sources.js` resolves each spot's conditions with provenance: fresh Surfline conditions (promoted spots and trusted cam matches, <36h) beat an on-load Open-Meteo result (<2h), which beats the static embedded MEO snapshot. The UI shows the winning source as a chip.
- `src/live-forecast.js` fetches Open-Meteo marine+wind for a spot when its detail panel opens with only static data, cached in `localStorage` for an hour.
- `src/stretch-view.js` + `data/stretches.json` make the Caparica strip and Linha seafront scannable as units (all spots and cams on the beach, with Surfline stills loaded lazily).
- `src/monitor-cameras.js` limits "might be good" suggestions to the Nazaré→Sesimbra west-coast fence and to spots with fresh (non-static) provenance.
- Promoted Surfline spots (`data/promoted-spots.json`, built from the hand-curated `data/surfline-promotions.json` manifest) merge into the camera list as first-class, favoritable spots; stream-less ones render a report view plus their trusted linked cam.
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
- `scripts/build-surfline-needs-review-html.js` writes `docs/surfline-needs-review.html`, a local feedback interface for coordinate-only mappings that are excluded from runtime until curated; `scripts/apply-mapping-feedback.js` imports its exported decisions (accept → curated, reject → rejected, both preserved across regeneration).
- `scripts/extract-surfline-conditions.js` writes the volatile `data/surfline-conditions.json` from cached pages (feet/knots/°F normalized to metric; primary records preferred, fresh nearby records override primaries staler than 6h).
- `scripts/build-promoted-spots.js` applies the trusted-cam gate (name-first rule, Surfline native cams, stretch membership) to `data/surfline-promotions.json` and writes `data/promoted-spots.json`.
- `scripts/build-promotion-map-html.js` writes `docs/surfline-promotion-map.html`, the persistent map for re-curating which Surfline spots are promoted.
- `scripts/refresh-surfline-conditions.js` is the polite daily refresh: greedy set-cover picks ~3 pages that cover all promoted/favorite/stretch spots, fetches via the Chrome CDP transport, and swaps `data/surfline-conditions.json` in only after an 80% freshness floor passes. `scripts/refresh-surfline-daily.sh` wraps it for cron/launchd (skips cleanly without Chrome); `scripts/check-conditions-freshness.js` is the staleness guard; `.github/workflows/update-surfline-conditions.yml` stays dispatch-only until `probe-surfline` validates a transport from runners.
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
