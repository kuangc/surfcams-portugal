# Architecture

Surfcams Portugal is a static web app. It has no backend, build step, database server, or package dependencies.

## Runtime

- `index.html` defines the page shell and embeds the current camera database in `#embeddedCameraDb`.
- `src/main.js` owns the UI controller for map markers, filters, list rows, details, and events.
- `src/camera-data.js` loads the embedded DB first and falls back to `data/beachcam-cameras.json`.
- `src/favorites.js` owns default favorites and browser persistence.
- `src/surf-rating.js` maps camera conditions into Surfline-style model labels, applies spot-level shelter/exposure mechanics where known, and exposes wind, swell, and coast-exposure vectors for the UI.
- `src/video-player.js` owns HLS playback and lazy-loads hls.js only when the browser needs it.
- `src/styles/app.css` contains the app layout and visual system.

## Data Pipeline

- `scripts/crawl-beachcam.cjs` crawls public Beachcam/MEO livecam pages and writes `data/beachcam-cameras.json`.
- `scripts/embed-camera-db.js` embeds that JSON into `index.html` so the default app load does not depend on a separate JSON fetch.
- `.cache/beachcam/` stores crawl responses locally and is not committed.

## Deployment

The repository can be served as static files from GitHub Pages. Use the root directory as the Pages source.
