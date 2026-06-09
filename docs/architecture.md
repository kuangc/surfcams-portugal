# Architecture

Surfcams Portugal is a static web app. It has no backend, build step, database server, or package dependencies.

## Runtime

- `index.html` defines the page shell and embeds the current camera database in `#embeddedCameraDb`.
- `src/main.js` owns the UI controller for map markers, filters, list rows, details, and events.
- `src/camera-data.js` loads the embedded DB first and falls back to `data/beachcam-cameras.json`.
- `src/spot-data.js` loads optional normalized Surfline, MEO, mapping, and Lisbon drive estimate JSON files.
- `src/favorites.js` owns default favorites and browser persistence.
- `src/video-player.js` owns HLS playback and lazy-loads hls.js only when the browser needs it.
- `src/styles/app.css` contains the app layout and visual system.

## Data Pipeline

- `scripts/crawl-beachcam.cjs` crawls public Beachcam/MEO livecam pages and writes `data/beachcam-cameras.json`.
- `scripts/build-spot-data.js` normalizes the Beachcam/MEO camera index into `data/meo-spots.json` and deterministic central Lisbon drive estimates into `data/lisbon-drive-estimates.json`.
- `scripts/embed-camera-db.js` embeds that JSON into `index.html` so the default app load does not depend on a separate JSON fetch.
- `data/surfline-spots.json` stores seeded Surfline report URLs, coordinates, stable spot metadata, and the daily/hourly concepts that should be refreshed when a live integration is added.
- `data/meo-surfline-matches.json` maps one MEO camera to one or more nearby Surfline reports using a proposed outing-corridor rule that still needs user calibration.
- `.cache/beachcam/` stores crawl responses locally and is not committed.

## Deployment

The repository can be served as static files from GitHub Pages. Use the root directory as the Pages source.
