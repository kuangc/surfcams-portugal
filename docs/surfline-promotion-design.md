# Surfline Spot Promotion & Fresh Conditions — Design Spec

Date: 2026-07-06 · Status: draft, pending user review + map-based promotion selection
Related: GH issue #4 (Surfline-first spot metadata layer), `docs/surfline-meo-metadata-comparison.md`, `docs/architecture.md`

## 1. Goal

Spot particularities (shelter, orientation, bathymetry) dominate actual wave size, and the app's
"Good for us" rating currently runs on MEO's generic wave numbers — which are also **static snapshots
from the last crawl** (2026-06-07), not live data. Surfline's per-spot surf heights and ratings are
much better. This design:

1. Promotes a curated subset of Surfline spots to **first-class app spots** (favoritable, monitorable,
   shown on the Explore map) — generalizing the existing hand-embedded `surfline-castelo` prototype.
2. Uses **Surfline data for wave info** on promoted spots and on MEO cams with a trusted Surfline match.
3. Refreshes that data **politely**: one small scheduled daily fetch for a bounded "fresh set" inside
   the geographic fence, plus an **on-load client refresh** (Open-Meteo marine model) for everything
   outside the fence or stale.
4. Constrains "Might be good" proposals to a **geographic fence: Nazaré (39.65°N) → Sesimbra (38.40°N)**
   and to spots with fresh forecast provenance.

## 2. Current state (evidence)

- App: static GitHub Pages PWA, no build step; embedded camera DB (190 MEO cams, 147 streams);
  data JSONs under `data/` fetched at runtime (`src/config.js`).
- Rating: `src/surf-rating.js:133` `rateSurfSpot()` reads `camera.forecast.wave|wind` +
  `detailMetrics` (MEO strings, crawl-time static) + coast exposure bearing. No runtime forecast fetch
  exists anywhere; only tides are fresh (GH Action `update-tides.yml`, daily 04:23 UTC).
- Surfline assets: `data/surfline-spots.json` — 80 normalized spots (staticMetadata + a
  `currentSnapshot` from the 2026-06-11 browser-CDP cache). `.cache/surfline/pages/` (gitignored,
  main checkout) holds 80 fetched pages, all `browser-fetched`, all with `__NEXT_DATA__`.
- Mapping: `data/meo-surfline-matches.json` — 89 MEO→Surfline corridor mappings
  (11 curated / 57 generated / 21 needs-review). Curated rows are preserved across rebuilds.
- Enrichment: `data/spot-metadata-enrichment.json` (68 MEO-keyed records) and
  `data/coast-exposures.json` (190 records, 175 finite bearings) feed exposure/wind-fit today.
- Prototype promotion: `surfline-castelo` is hand-embedded in `data/beachcam-cameras.json` as a
  stream-less camera with `surfline.pageUrl` (report iframe) and sits in `DEFAULT_FAVORITE_IDS`.
- **Unit gotcha:** cached Surfline pages were fetched with imperial units —
  `"units":{"surfHeight":"FT","windSpeed":"KTS"}`. `currentSnapshot.surf.min/max` are feet.
- Sesimbra today: regional hardcode "sheltered south-facing bay, bearing 180"
  (`src/surf-rating.js:25`) scaling nothing — MEO's number passes through regardless of shelter.

## 3. Geographic fence

Latitude band, inclusive: **south 38.40° (Sesimbra) → north 39.65° (Nazaré/Praia do Norte)**.
Longitude is unconstrained (all coastal spots in band; inland river cams are excluded from
suggestion logic by requiring a Surfline mapping or promotion).

Counts from current data:

| Set | In fence | Total |
|---|---|---|
| Surfline spots (normalized catalog) | **74** (all with primary cached page) | 80 |
| MEO spots | 96 (67 with live stream) | 190 |
| MEO→Surfline mapping rows | **84** (11 curated · 55 generated · 18 needs-review) | 89 |
| Surfline spots with a stream-cam MEO match | 71 of 74 | — |
| Surfline spots with no cam (report-only candidates) | 3 (`sao-lourenco`, `coxos`, `praia-da-cruz-quebrada`) | — |
| Out of fence (all south: Pego→Burrinho) | — | 6 |

Fence constants live in `src/config.js` (`SUGGESTION_FENCE = { north: 39.65, south: 38.40 }`).

## 4. Approaches considered

**A. Pseudo-camera merge (recommended).** Promoted Surfline spots become camera-shaped records in a
new `data/promoted-spots.json`, merged into the camera DB at load. Favorites, Monitor,
Might-be-good, Explore markers, and the report-only detail view already work on that shape
(`surfline-castelo` proves it). Smallest change surface; ships in days.
*Trade-off:* "camera" naming is a white lie for stream-less spots; acceptable, documented.

**B. Dual-entity refactor.** First-class `Spot` entity with optional attached cameras; cameras become
children. Cleanest long-term model, but touches every render path, filter, and favorites shape for
no immediate user-visible gain. Rejected for v1; approach A leaves a migration path (ids stay stable).

**C. Enrichment-only (no new entries).** Keep 190 MEO spots, just swap wave numbers for matched
Surfline data. Fails the requirement: cam-less quality spots (Coxos, São Lourenço) can never be
favorited or proposed. Rejected.

Refresh transport options: local scheduled headed-Chrome CDP (recommended — the only path proven to
bypass Cloudflare, per CLAUDE.md), GitHub-Actions plain HTTP (known 403 risk; optional experiment,
off by default), client-direct Surfline (impossible: CORS + Cloudflare), third-party CORS proxies
(rejected: impolite, leaks traffic). On-load client refresh uses **Open-Meteo Marine** (CORS-open,
free, no key) rather than Surfline.

## 5. Architecture

```
                    (daily, local Mac, launchd)                (on app load / spot open)
  Surfline pages ──► cache-surfline-browser (CDP) ─┐        Open-Meteo Marine + Forecast APIs
                                                   │                     │
                                                   ▼                     ▼
                 build-surfline-spots (static) + extract-surfline-conditions (volatile)
                                                   │                     │
        data/surfline-spots.json   data/surfline-conditions.json   localStorage cache (1h TTL)
                     │                          │                        │
                     └──────────────┬───────────┘                        │
                                    ▼                                    │
              src/forecast-sources.js — resolveConditions(spot) ◄────────┘
              provenance: surfline-fresh > live-model > meo-static
                                    │
                     rateSurfSpot(conditions, preferences)
                                    │
                Monitor / Favorites / Might-be-good (fence + freshness gated)
```

### 5.1 Promotion manifest — `data/surfline-promotions.json` (new, hand-curated)

```json
{ "schemaVersion": 1, "updatedAt": "2026-07-06",
  "promoted": [ { "surflineSpotId": "surfline-supertubos", "note": "" } ] }
```

Seed list = the user's map selection (recommended default: 21 spots — nazare, baleal, lagide,
cantinho-da-baia, supertubos, consolacao, santa-cruz, ribeira-d-ilhas, coxos, foz-do-lizandro,
sao-juliao, praia-grande, praia-do-guincho, carcavelos, sao-pedro-do-estoril, costa-da-caparica,
castelo, fonte-da-telha, lagoa-de-albufeira, bicas, sesimbra). A build check fails if an id is not
in `surfline-spots.json`. Promotion is a product decision file — deliberately separate from the
factual matches file.

### 5.2 Promoted spot records — `scripts/build-promoted-spots.js` → `data/promoted-spots.json`

For each promoted id, emit a camera-DB-compatible record:

- `id` = the existing `surfline-*` id (favorites continuity; `surfline-castelo` keeps working),
  `name`, `lat`, `lon`, `region` (nearest matched MEO region, else breadcrumb-derived), `hasStream: false`,
  `surfline: { spotId, pageUrl }`, `surfMetadata` (breakType, best.*, coastExposure, guideSummary),
  `linkedCamId` = nearest matched MEO stream cam within 1.5 km whose mapping is not `needs-review`
  (detail view shows that cam's stream above the Surfline report link), `promoted: true`.
- Client merge in `loadCameraDb()` (`src/camera-data.js`): promoted records are appended;
  **if an id collides with an embedded camera entry the promoted record wins** (this absorbs and
  retires the hand-edited `surfline-castelo` row without touching crawler output).
- Explore map: promoted spots get a distinct marker style; favorites/monitor need no changes
  (id-based already).

### 5.3 Volatile conditions — `data/surfline-conditions.json` (new, small, committed daily)

Extracted per cached page (primary + nearby records), unit-normalized at build time:

```json
{ "schemaVersion": 1, "generatedAt": "…", "unitsNormalized": { "surfHeight": "m", "windSpeed": "kmh" },
  "conditions": { "surfline-supertubos": {
      "fetchedAt": "…", "sourceKind": "primary|nearby",
      "rating": "GOOD", "ratingValue": 4, "conditionsLabel": "Clean",
      "surfMinM": 0.9, "surfMaxM": 1.5, "surfRawFt": [3, 5],
      "windKmh": 11, "windDirDeg": 20, "swells": [{ "hM": 1.2, "periodS": 12, "dirDeg": 225 }],
      "humanReport": "…first 200 chars…" } } }
```

Separating volatile conditions from the static catalog keeps daily commits tiny and diffable
(mirrors the tide-cache pattern) and stops `surfline-spots.json` churn. `build-surfline-spots.js`
keeps owning static metadata; a new `scripts/extract-surfline-conditions.js` owns this file.
**FT→m (×0.3048) and KTS→km/h (×1.852) conversion happens here; raw values are preserved alongside.**

### 5.4 Forecast source resolution — `src/forecast-sources.js` (new)

`resolveConditions(camera, spotData, liveCache, now)` returns a normalized conditions object
`{ waveMinM, waveMaxM, windKmh, windDirDeg, periodS, swellDirDeg, rating?, source, fetchedAt, ageHours }`
with provenance precedence:

1. **`surfline-fresh`** — spot is promoted, or is a MEO cam whose mapping is curated/generated
   (never `needs-review`) with distance ≤ 1.5 km; conditions entry exists with age < 36 h.
   Wave = Surfline `surfMinM..surfMaxM`; rating carried through.
2. **`live-model`** — on-load Open-Meteo result from localStorage (age < 2 h).
3. **`meo-static`** — today's behavior (embedded crawl strings), explicitly labeled stale.

`rateSurfSpot()` changes to consume this object (wave-range check uses min/max overlap with
preferences instead of a single number; Surfline `rating ≥ FAIR` becomes a positive signal,
`POOR` vetoes `isRecommended`). The UI conditions strip gains a provenance chip:
`Surfline · 6h` / `Model · now` / `MEO · Jun 7`. `surfSizeScale` preference stays but defaults to
no-op for `surfline-fresh` (it exists to correct MEO bias, which Surfline data doesn't have).

### 5.5 On-load refresh (out-of-fence or stale) — `src/live-forecast.js` (new)

When a spot's resolved provenance would be `meo-static` (anything outside the fence, any spot whose
Surfline conditions are older than 36 h, any unmatched cam):

- On spot open (detail/monitor tile render), fetch Open-Meteo **Marine** (`wave_height,
  wave_period, wave_direction, swell_wave_height…`) + **Forecast** (`wind_speed_10m,
  wind_direction_10m`) for the spot lat/lon; current hour only.
- Cache per spot in localStorage, TTL 1 h; in-flight de-dupe; on failure fall back silently to
  `meo-static`. Zero Surfline traffic from clients — CORS and Cloudflare make client-side Surfline
  fetches impossible, and Open-Meteo is built for exactly this access pattern.
- Exposure-aware interpretation stays: wind alignment from existing bearings; wave height is offshore
  model output, so label it `Model` (never presented as spot surf size) and apply the existing
  exposure heuristics for shelter (Sesimbra: S-facing bay discounts W/NW windswell).
- Seam left for a future `surfline-live` provider (e.g. a personal Cloudflare Worker proxy with KV
  caching) — out of scope v1; revisit only if Open-Meteo proves insufficient.

### 5.6 Daily polite refresh — local scheduled runner (new: `scripts/refresh-surfline-daily.sh` + launchd plist)

- **Fresh set** = promoted spots ∪ Surfline matches of current default favorites ∪ in-fence
  might-be-good candidates. Fetch **primary pages only for a minimal covering set**: every cached
  page embeds `nearby` spot records with conditions snapshots, so ~12–18 page fetches cover all 74
  in-fence spots (set-cover computed from `sourceRecords`; verify nearby snapshot completeness in
  implementation — if nearby records lack a needed field, fall back to primary fetches for promoted
  spots only).
- Politeness budget: ≤ 20 page requests/day, batch 4, ≥ 300 ms delay + jitter (existing
  `cache-surfline-browser` flags), one retry max, random start minute inside a 06:00–07:00 local
  window (before the morning surf check), abort-and-keep-stale on repeated failures.
- Pipeline per run: CDP fetch → `extract-surfline-conditions` → `build-surfline-spots` (static drift)
  → commit only `data/surfline-conditions.json` (+ static files when changed) with a conventional
  `chore(data): refresh surfline conditions` message → push (GH Pages redeploys).
- Host: the user's Mac via launchd (headed Chrome is the only Cloudflare-proven path; CI stays
  tide-only). An optional GH-Action HTTP variant can be added later as an experiment, disabled by default.
- Staleness surfacing: app shows the provenance chip age; Monitor shows a subtle "conditions data
  from Jun 11" banner when the newest Surfline conditions are > 48 h old.

### 5.7 Fence + Might-be-good changes — `src/monitor-cameras.js`

`mightBeGoodCameras()` gains two gates before rating: candidate must be (a) inside
`SUGGESTION_FENCE` and (b) resolved with provenance `surfline-fresh` or `live-model` — never propose
on static MEO numbers. Candidates now include promoted spots (they're in the camera list). Ranking:
existing drive-distance sort, then Surfline rating desc. Limit stays `MONITOR_CAMERA_LIMIT` (7).

### 5.8 Mapping completion (supports all of the above)

The 18 in-fence `needs-review` mappings block Surfline data for their cams. Close the loop:

- Keep using `docs/surfline-needs-review.html` for judgment calls; add
  `scripts/apply-mapping-feedback.js` that ingests the page's exported feedback JSON and writes
  accepted picks into `data/meo-surfline-matches.json` as `source: "curated"` rows (rejected →
  `reviewStatus: "rejected"`, excluded from runtime), then reruns the downstream builds.
- Promotion does not wait on this; it only affects which MEO cams get `surfline-fresh` provenance.

## 6. Error handling

- Missing/stale `surfline-conditions.json` → provenance degrades per §5.4; nothing crashes; chips
  show age honestly.
- Open-Meteo failure/timeout (3 s) → silent fallback, console-info only.
- Promotion manifest id typo → build fails loudly (CI-friendly), app never sees bad data.
- Promoted spot with no `linkedCamId` → report-only detail view (existing castelo behavior).
- localStorage full/unavailable → in-memory cache for the session.

## 7. Testing

- `test/forecast-sources.test.js`: provenance precedence table (fresh vs stale vs unmatched vs
  needs-review), age math, unit conversions (3 ft → 0.9 m, 10 kts → 18.5 km/h).
- `test/promoted-spots.test.js`: merge/collision (castelo override), favorites round-trip with
  promoted ids, linkedCam selection rules.
- `test/monitor-cameras.test.js`: fence gating (39.66 excluded, 39.65/38.40 included), freshness
  gating, promoted spots eligible.
- Extraction: fixture cached page (committed test fixture, not live fetch) → conditions record
  snapshot; nearby-record completeness assertion.
- Existing 13 test files keep passing unchanged (rateSurfSpot keeps a back-compat wrapper).

## 8. Rollout

1. **M1 — mapping & data:** apply-feedback importer; curate the 18 in-fence needs-review rows;
   conditions extractor + units fix; promotion manifest + build (map selection as seed).
2. **M2 — app:** forecast-sources resolution + rating changes + provenance chips; promoted spots
   merged, favoritable, on Explore map; fence + freshness gates on Might-be-good.
3. **M3 — refresh:** launchd daily runner (set-cover fetch, commit, push); staleness banner;
   on-load Open-Meteo refresher.
4. Out of scope v1: Surfline live proxy, dual-entity refactor, per-user fence config, drive-time
   work (issue #1), service worker/offline.

## 9. Open questions (for review)

1. **Promotion list:** confirm/adjust the map selection (seed = 21 recommended above).
2. **Runner host:** OK to run the daily refresh from your Mac via launchd (recommended), or prefer
   attempting a GH-Action HTTP fetcher first despite the 403 risk?
3. **Rating semantics:** should Surfline `POOR` hard-veto "Good for us" even when your size/wind
   preferences pass (recommended: yes)?
4. **Fence bounds:** 38.40–39.65 inclusive matches "Nazaré→Sesimbra". Portinho da Arrábida (38.47,
   lon −8.99) is inside by latitude — keep or exclude the Arrábida/Setúbal pocket?
