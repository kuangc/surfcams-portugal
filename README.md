# Surfcams Portugal

Ad-free personal viewer for provider-native Portugal surf cameras indexed from
public Beachcam/MEO livecam pages. The production app is private: Cloudflare
Access protects the complete Worker hostname with Google sign-in and an exact
email allowlist.

The app opens directly to a map and score-ranked camera list, filters out
unavailable streams, and lets each browser choose its own favorites with
`localStorage`. Camera names, locations, and feeds stay one-to-one with the MEO
provider catalog; Surfline is used for wave intelligence, never camera playback
or still imagery.

## Features

- Interactive Leaflet map of 190 indexed Portugal MEO camera records, including
  154 playable HLS feeds in the accepted 2026-08-19 catalog snapshot.
- Server-side MEO playback broker that obtains the provider's temporary token
  and returns a signed playlist URL only to an authenticated browser. HLS media
  then travels directly from MEO to the browser; the Worker does not proxy it.
- Surfline-style model rating labels for small-group sessions, using Beachcam
  wave, wind, period, tide, and spot/coast mechanics.
- Surfline spot conditions and mechanics enrich matching MEO cameras and
  informational Explore spots when fresh, with a provenance chip showing
  whether numbers come from Surfline, a live model, or the static MEO snapshot.
- No Surfline HLS, camera-still, hotlink, proxy, or promoted-camera alias path;
  unavailable upstream camera media cannot be mislabeled as another beach.
- Source-backed local advice for the 44 selected Surfline spots. Compact cards
  show at most one context-sensitive **Local lens** line; the detail view's
  **Local playbook** explains size translation, the best window, mechanics,
  hazards, scope, confidence, conflicts, and sources.
- Cave and Praia da Ursa remain honest **guide-only** Explore subjects: their
  playbooks are available, but the app does not invent live camera or
  current-condition claims for them.
- "Good for us" filtering for in-window waves, offshore wind, and light-wind
  conditions.
- Focused pre-click rows with rating, estimated surf size, and wind fit;
  detailed wind, swell, and exposure vectors live in the selected spot panel.
- Favorites workflow with defaults for Estoril, Riviera, Sesimbra, São Julião,
  Fonte da Telha Norte, and Peniche Lagide.
- Default map bounds covering Baleal/Peniche in the north and Sesimbra in the
  south.
- No advertising or tracking code.

## Local Setup

Node 22 is required. Install the reviewed lockfile exactly and run the same
deterministic gate used by CI and Cloudflare Workers Builds:

```bash
npm ci
npm run verify
```

For a static UI development server:

```bash
npm run dev
```

Open `http://127.0.0.1:8766/`. This server exposes repository files directly
for loopback development; it does not emulate Cloudflare Access, the Worker
router, the playback API, or the named Durable Object. Camera playback that
needs `/api/playback/*` therefore cannot be accepted through `npm run dev`.
Use the protected Worker for authentication, broker, and end-to-end playback
acceptance.

`npm run verify:fresh` adds the six-hour Surfline conditions freshness gate for
release acceptance. `npm run probe:meo-signed` is a manual, network-dependent,
redacted MEO acceptance probe. It must never run in CI.

## Local advice review

The reviewed source of truth is `data/spot-advice.json`;
`data/spot-advice-resolved.json` is its deterministic public runtime build.
Advice is explicitly scoped to one spot, a named coastline stretch, or a
broader area, so inherited guidance is labeled rather than presented as
spot-specific fact.

The compact Local lens chooses one relevant, non-conflicting line from fresh
conditions. Open a spot and expand **Local playbook** for the complete advice
and its provenance. This first schema is display-only: it does not change
forecast estimates or surf ratings.

The editor is a generated local file and is never deployed:

```bash
npm run build-spot-advice-review
npm run dev
```

Open `http://127.0.0.1:8766/.local/spot-advice-review.html`.

Review edits autosave in that browser. Export the complete feedback JSON from
the cockpit, then validate and apply it with the digest-guarded command
documented in `CLAUDE.md`. The `.local/` directory is intentionally ignored by
Git.

## Project Layout

```text
index.html                    Application shell
src/                          Browser modules and styles
worker/                       Worker router, Access JWT verifier, playback API,
                              and Durable Object token coordinator
data/                         Reviewed and generated runtime data
scripts/build-runtime-assets.js
                              Deterministic allowlisted build into dist/
scripts/                      Data, probe, and local-development commands
test/                         Node and Workerd test suites
wrangler.jsonc                Functional Worker and Durable Object bindings
wrangler.bootstrap.jsonc      Content-free deny-only bootstrap Worker
docs/architecture.md          Runtime and data-flow architecture
docs/runbooks/                Access and release operations
```

`dist/` and `.wrangler/` are generated, ignored output. They are never hand
edited or committed.

## Refresh Camera Data

The crawler uses only Node built-ins and caches downloaded pages under
`.cache/beachcam/`. Refreshes are staged outside the tracked database and
accepted only after the identity/feed validator passes; derivative MEO data
then preserves reviewed mappings and trusted OSRM routes across known ID
corrections.

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

## Surfline Conditions Refresh

The existing `.github/workflows/update-surfline-conditions.yml` pipeline is
unchanged by the Worker migration. It still runs three times per day plus
manual dispatch, uses headed Chrome through Xvfb and CDP, validates the result,
and commits only `data/surfline-conditions.json` when that file changes. The
local headed-browser fallback remains documented in `CLAUDE.md`.

Each accepted `main` commit, including a conditions-only bot commit, triggers a
Cloudflare Workers Build. The deterministic `npm run verify` gate deliberately
does not include the six-hour wall-clock freshness check because the accepted
schedule has an overnight gap; releases and live acceptance use
`npm run verify:fresh` separately. Do not weaken or duplicate the existing
Surfline workflow.

## Private Deployment

Production is the `surfcams-portugal` Cloudflare Worker at its Access-protected
`workers.dev` hostname. It is not deployed from `main` through GitHub Pages.
The first release at the new origin intentionally starts with fresh default
favorites and surf preferences because browser `localStorage` cannot cross
origins.

Follow both operator runbooks:

- [Cloudflare Access](docs/runbooks/cloudflare-access.md) configures Google,
  exact-email authorization, approval, revocation, logout, and anonymous
  interception.
- [Cloudflare release](docs/runbooks/cloudflare-release.md) covers the
  deny-only bootstrap, protected candidate, Workers Builds, rollback, and
  retirement of the legacy public Pages deployment.

The approved source of truth for the migration is the
[private MEO Worker migration design](docs/superpowers/specs/2026-08-19-private-meo-worker-migration-design.md).

## Legal

Camera streams, images, and descriptions belong to Beachcam/MEO or their
licensors. Surfline reports and wave metadata belong to Surfline or its
licensors. This project indexes public metadata for personal viewing and does
not claim ownership of upstream content or affiliation with either provider.

## License

MIT for this app's source code. Upstream camera content is not covered by this
license.
