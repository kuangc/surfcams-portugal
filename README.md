# Surfcams Portugal

Ad-free personal viewer for Portugal surf cameras indexed from public Beachcam/MEO livecam pages.

The app opens directly to a map and score-ranked camera list, filters out unavailable streams, and lets each browser choose its own favorites with `localStorage`.

## Features

- Interactive Leaflet map of indexed Portugal cameras with live HLS feeds.
- Surfline-style model rating labels for small-group sessions, using Beachcam wave, wind, period, tide, and spot/coast mechanics.
- Promoted Surfline spots (Nazaré→Sesimbra) as first-class favoritable spots, rated from Surfline's own spot conditions when fresh — with a provenance chip showing whether numbers come from Surfline, a live model, or the static MEO snapshot.
- "Good for us" filtering for in-window waves, offshore wind, and light-wind conditions.
- Focused pre-click rows with rating, estimated surf size, and wind fit; detailed wind, swell, and exposure vectors live in the selected spot panel.
- Favorites workflow with defaults for Estoril, Riviera, Sesimbra, São Julião, Fonte da Telha Norte, and Peniche Lagide.
- Default map bounds covering Baleal/Peniche in the north and Sesimbra in the south.
- No advertising, tracking code, backend, login, or build step.
- Embedded camera database fallback so GitHub Pages works without an API server.

## Quick Start

```bash
npm test
npm run dev
```

Open `http://127.0.0.1:8766/`.

## Project Layout

```text
index.html                 Static app shell with embedded camera DB
data/beachcam-cameras.json Indexed camera database
src/                       Browser app modules and styles
scripts/                   Data refresh and local development CLIs
test/                      Node test suite
docs/architecture.md       Architecture notes
```

## Refresh Camera Data

The crawler uses only Node built-ins and caches downloaded pages under `.cache/beachcam/`.

```bash
npm run crawl -- --refresh
npm run embed-data
npm test
```

## Deployment

This repository is ready for GitHub Pages at `https://kuangc.github.io/surfcams-portugal/`:

1. Push the repository to GitHub.
2. In repository settings, enable Pages from the default branch root.
3. Open the generated Pages URL.

## Legal

Camera streams, images, descriptions, and forecast metadata belong to Beachcam/MEO or their licensors. This project indexes public page metadata for personal viewing and does not claim ownership of upstream content or affiliation with Beachcam/MEO.

## License

MIT for this app's source code. Upstream camera content is not covered by this license.
