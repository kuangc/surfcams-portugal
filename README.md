# Surfcams Portugal

Ad-free personal viewer for provider-native Portugal surf cameras indexed from public Beachcam/MEO livecam pages.

The app opens directly to a map and score-ranked camera list, filters out unavailable streams, and lets each browser choose its own favorites with `localStorage`. Camera names, locations, and feeds stay one-to-one with the MEO provider catalog; Surfline is used for wave intelligence, never camera playback or still imagery.

## Features

- Interactive Leaflet map of 190 indexed Portugal MEO camera records, including 154 currently playable HLS feeds.
- Surfline-style model rating labels for small-group sessions, using Beachcam wave, wind, period, tide, and spot/coast mechanics.
- Surfline spot conditions and mechanics enrich matching MEO cameras and informational Explore spots when fresh, with a provenance chip showing whether numbers come from Surfline, a live model, or the static MEO snapshot.
- No Surfline HLS, camera-still, hotlink, proxy, or promoted-camera alias path; unavailable upstream camera media cannot be mislabeled as another beach.
- Source-backed local advice for the 44 selected Surfline spots. Compact cards show at most one context-sensitive **Local lens** line; the detail view's **Local playbook** explains size translation, the best window, mechanics, hazards, scope, confidence, conflicts, and sources.
- Cave and Praia da Ursa remain honest **guide-only** Explore subjects: their playbooks are available, but the app does not invent live camera or current-condition claims for them.
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

## Local advice review

The reviewed source of truth is `data/spot-advice.json`; `data/spot-advice-resolved.json` is its deterministic public runtime build. Advice is explicitly scoped to one spot, a named coastline stretch, or a broader area, so inherited guidance is labeled rather than presented as spot-specific fact.

The compact Local lens chooses one relevant, non-conflicting line from fresh conditions. Open a spot and expand **Local playbook** for the complete advice and its provenance. This first schema is display-only: it does not change forecast estimates or surf ratings.

The editor is a generated local file and is never deployed:

```bash
npm run build-spot-advice-review
npm run dev
```

Open `http://127.0.0.1:8766/.local/spot-advice-review.html`.

Review edits autosave in that browser. Export the complete feedback JSON from the cockpit, then validate and apply it with the digest-guarded command documented in `CLAUDE.md`. The `.local/` directory is intentionally ignored by Git.

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

The crawler uses only Node built-ins and caches downloaded pages under `.cache/beachcam/`. Refreshes are staged outside the tracked database and accepted only after the identity/feed validator passes; derivative MEO data then preserves reviewed mappings and trusted OSRM routes across known ID corrections.

```bash
npm run crawl -- --refresh --output /tmp/meo-candidate.json
node scripts/validate-meo-crawl.cjs \
  --baseline data/beachcam-cameras.json \
  --candidate /tmp/meo-candidate.json
cp /tmp/meo-candidate.json data/beachcam-cameras.json
ROUTING_PROVIDER=preserve npm run build-spot-data
npm run build-meo-surfline-matches
npm run cache-surfline -- --offline
npm run build-coast-exposures
npm run build-spot-metadata-enrichment
npm run build-promoted-spots
npm run build-promotion-map
npm run build-spot-advice
npm run fetch-tides
npm run embed-data
npm test
```

## Deployment

This repository is ready for GitHub Pages at `https://kuangc.github.io/surfcams-portugal/`:

1. Push the repository to GitHub.
2. In repository settings, enable Pages from the default branch root.
3. Open the generated Pages URL.

## Legal

Camera streams, images, and descriptions belong to Beachcam/MEO or their licensors. Surfline reports and wave metadata belong to Surfline or its licensors. This project indexes public metadata for personal viewing and does not claim ownership of upstream content or affiliation with either provider.

## License

MIT for this app's source code. Upstream camera content is not covered by this license.
