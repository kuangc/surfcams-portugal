# Surfline Spot Promotion & Fresh Conditions — Design Spec

Date: 2026-07-06 · Status: implemented (2026-07-08). All milestones shipped on
`kuang/gallant-hermann-bf3ab3`; the 36 at-spot-cam / 6 stretch-cam / 2 deferred split is enforced by
`build-promoted-spots` against `data/surfline-promotions.json`. The scheduled CI refresh is now live
(§5.6): `probe-surfline-browser.yml` proved a real headful Chrome on a GitHub runner clears
Surfline's Cloudflare from a datacenter IP, so `update-surfline-conditions.yml` runs the in-browser
CDP refresh daily; `scripts/refresh-surfline-daily.sh` (headed Chrome on a home IP) is retained as a
documented fallback.
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
4. Constrains "Might be good" proposals to a **geographic fence: Nazaré (39.65°N) → Sesimbra
   (38.40°N), west coast only (lon ≤ −9.05°)** and to spots with fresh forecast provenance.

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

Latitude band, inclusive: **south 38.40° (Sesimbra) → north 39.65° (Nazaré/Praia do Norte)**, plus a
longitude guard **lon ≤ −9.05°**. The guard keeps Sesimbra, Espichel, and the Meco/Bicas stretch while
excluding the Arrábida/Setúbal/Tróia pocket (user decision: Sesimbra is the only spot of interest down
there). Inland river cams fall out automatically. Nazaré (−9.086) and Sesimbra (−9.097) both pass.

Counts from current data (fence v2):

| Set | In fence | Total |
|---|---|---|
| Surfline spots (normalized catalog) | **73** (all with primary cached page) | 80 |
| MEO spots | 89 (62 with live stream) | 190 |
| MEO→Surfline mapping rows | **83** (11 curated · 54 generated · 18 needs-review) | 89 |
| Surfline spots with a **trusted** cam under the §5.8 name-first rule | 41 of 73 (38 by name, 3 by ≤200 m) | — |
| Surfline spots with no cam at all (report-only candidates) | 3 (`sao-lourenco`, `coxos`, `praia-da-cruz-quebrada`) | — |
| Out of fence | — | 7 (6 south of Sesimbra + `portinho-da-arrabida`) |

In-fence stream cams that get a trusted Surfline source under the same rule: **50 of 62**.
Fence constants live in `src/config.js`
(`SUGGESTION_FENCE = { north: 39.65, south: 38.40, westOfLon: -9.05 }`).

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

Refresh transport options: **GitHub Actions fetcher (primary — user decision: scheduling reliability,
logs, and failure alerting beat a laptop cron)**, gated on a feasibility probe since datacenter IPs
may hit the same Cloudflare 403 seen locally — the probe tests both report pages and the
`services.surfline.com` KBYG JSON API; local headed-Chrome CDP (the proven path, kept as tested
fallback); client-direct Surfline (impossible: CORS + Cloudflare); third-party CORS proxies
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

Seed list = the user's map selection of **44 spots** (2026-07-06), with the user's gate applied:
**only spots with a trusted cam are promoted**; the rest stay in the manifest as wanted-but-deferred
and graduate automatically once their cam association is curated (file-level policy
`promoteOnlyWithTrustedCam: true`; the build logs deferrals).

Promote with an **at-spot cam** (36 — trusted MEO stream, Surfline native cam, or both): nazare,
baleal, lagide, cantinho-da-baia, supertubos, consolacao, santa-cruz, ribeira-d-ilhas, reef,
pedra-branca, matadouro, praia-do-sul, foz-do-lizandro, sao-juliao, praia-das-macas, praia-pequena,
praia-grande, praia-da-adraga, praia-do-guincho, sao-pedro-do-estoril, paco-de-arcos, parede,
praia-da-laje, santo-amaro, carcavelos, praia-de-torre, cova-do-vapor, sao-joao-da-caparica,
praia-do-barbas, costa-da-caparica, praia-da-rainha, castelo, fonte-da-telha, lagoa-de-albufeira,
bicas, sesimbra.

Promote with **stretch cams only** (6 — same-beach nearby cams, honestly labeled; §5.8 stretch
semantics): marcelino, praia-da-saude, praia-da-cornelia, praia-do-pescador, praia-do-rei,
praia-de-caxias.

Deferred pending cam curation (2): cave, praia-da-ursa — different coves from their nearest cams,
no Surfline cam; graduate if curation decides the neighboring cam genuinely frames them.

A build check fails if an id is not in `surfline-spots.json`. Promotion is a product decision file —
deliberately separate from the factual matches file — and is **re-editable at any time** via the
persistent map page (§5.9); the seed is a starting roster, not a one-shot choice.

### 5.2 Promoted spot records — `scripts/build-promoted-spots.js` → `data/promoted-spots.json`

For each promoted id, emit a camera-DB-compatible record:

- `id` = the existing `surfline-*` id (favorites continuity; `surfline-castelo` keeps working),
  `name`, `lat`, `lon`, `region` (nearest matched MEO region, else breadcrumb-derived), `hasStream: false`,
  `surfline: { spotId, pageUrl }`, `surflineCams: [{ title, stillUrl }]` (still shown on view in the
  detail panel, never polled), `stretchCamIds` (ordered same-beach cams for stretch spots),
  `surfMetadata` (breakType, best.*, coastExposure, guideSummary),
  `linkedCamId` = nearest MEO stream cam with a **trusted association** per the §5.8 name-first rule
  (detail view shows that cam's stream above the Surfline report link; no trusted cam → report-only),
  `promoted: true`.
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

1. **`surfline-fresh`** — spot is promoted, or is a MEO cam with a **trusted Surfline association**
   (§5.8 name-first rule); conditions entry exists with age at or under 6 h.
   Wave = Surfline `surfMinM..surfMaxM`; rating carried through.
   *Implementation note (final review):* enrichment carries two source fields —
   `sourceSpotId` (metadata-richest member, static metadata only) and
   `conditionsSourceSpotId` (nearest §5.8-trusted member, the only field live conditions may
   attribute through; null → no Surfline attribution).
2. **`live-model`** — on-load Open-Meteo result from localStorage (age < 2 h).
3. **`meo-static`** — today's behavior (embedded crawl strings), explicitly labeled stale.

`rateSurfSpot()` changes to consume this object (wave-range check uses min/max overlap with
preferences instead of a single number; Surfline `rating ≥ FAIR` becomes a positive signal,
`POOR` vetoes `isRecommended` — hardcoded constant in the rating function for v1, one line, no
preference surface). The UI conditions strip gains a provenance chip:
`Surfline · 6h` / `Model · now` / `MEO · Jun 7`. `surfSizeScale` preference stays but defaults to
no-op for `surfline-fresh` (it exists to correct MEO bias, which Surfline data doesn't have).

### 5.5 On-load refresh (out-of-fence or stale) — `src/live-forecast.js` (new)

When a spot's resolved provenance would be `meo-static` (anything outside the fence, any spot whose
Surfline conditions are older than 6 h, any unmatched cam):

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

### 5.6 Daylight refresh — scheduled runner (GH Action primary, local CDP fallback)

- **Fresh set** = promoted spots ∪ Surfline matches of current default favorites ∪ in-fence
  might-be-good candidates. Fetch **primary pages only for a minimal covering set**: every cached
  page embeds `nearby` spot records with conditions snapshots, so ~12–18 page fetches cover all 74
  in-fence spots (set-cover computed from `sourceRecords`; verify nearby snapshot completeness in
  implementation — if nearby records lack a needed field, fall back to primary fetches for promoted
  spots only).
- Politeness budget (transport-independent): ≤ 20 requests/run, batch 4, ≥ 300 ms delay + jitter,
  one retry max. Scheduled runs use off-peak minute 17 at 05:17, 11:17, and 17:17 UTC so the
  six-hour current-condition contract covers the usable Lisbon day. Abort and keep the last good
  cache on repeated failures.
- Pipeline per run: fetch → `extract-surfline-conditions` → `build-surfline-spots` (static drift)
  → commit only `data/surfline-conditions.json` (+ static files when changed) with a conventional
  `chore(data): refresh surfline conditions` message → push (GH Pages redeploys).
- **Host & transport: GitHub Actions scheduled workflow (primary — user decision: reliable
  scheduling, run logs, built-in failure alerting).** Gated on **M3 step 0, a manual
  `workflow_dispatch` probe** that tests from a runner, committing nothing: (a) report-page HTTP
  fetch, (b) the `services.surfline.com` KBYG JSON API. Repo evidence says local direct fetches hit
  Cloudflare 403; datacenter IPs may fare worse — hence probe before schedule. All scripts are
  runnable and tested locally first (same npm entrypoints). If the probe fails both paths, fall back
  to the user's Mac via launchd driving the proven headed-Chrome CDP flow.
- **Fail-safe invariants (either transport):** validate every payload before writing cache
  (`__NEXT_DATA__` present / JSON schema match); never synthesize placeholder provider HTML
  (existing CLAUDE.md rule); if valid results < 80% of the fresh set, keep last-good data and exit
  nonzero so the run is a loud failure; commit only validated diffs.
- **Logging & alerting:** per-spot fetch status table written to `$GITHUB_STEP_SUMMARY` each run;
  failed scheduled runs email the workflow actor (GitHub default notifications); plus a freshness
  guard step that opens/updates a pinned "surfline conditions stale" issue whenever newest
  `fetchedAt` > 6 h — this catches *silent* stoppage too (GitHub auto-disables cron after 60 days
  of repo inactivity; the data commits themselves keep the repo active). The in-app staleness
  banner (below) is the last line of defense.
- Staleness surfacing: app shows the provenance chip age; Monitor shows a subtle "conditions data
  from Jun 11" banner when the newest Surfline conditions are > 6 h old.

### 5.7 Fence + Might-be-good changes — `src/monitor-cameras.js`

`mightBeGoodCameras()` gains two gates before rating: candidate must be (a) inside
`SUGGESTION_FENCE` and (b) resolved with provenance `surfline-fresh` or `live-model` — never propose
on static MEO numbers. Candidates now include promoted spots (they're in the camera list). Ranking:
existing drive-distance sort, then Surfline rating desc. Limit stays `MONITOR_CAMERA_LIMIT` (7).

### 5.8 Mapping completion (supports all of the above)

The 18 in-fence `needs-review` mappings block Surfline data for their cams. Close the loop:

**Name-first trust rule (user decision).** A cam↔spot association is *trusted* when the cam is AT
the spot: names roughly match — `nameScore ≥ 0.5` **or slug-normalized containment** (strip
diacritics/punctuation: catches `ribeira-dilhas` ↔ `Ribeira D'Ilhas`, `praia-do-sul` ↔
`ericeira-praia-do-sul`) — with a 3 km sanity cap that only absorbs bad geo pins (e.g. Surfline's
Consolação pin sits 2.6 km from the cam that is at the break) — **or**, when names don't match, the
pin distance is ≤ 0.2 km. Everything else (however close) goes to the curation queue; proximity
alone never implies the cam shows that break. `build-meo-surfline-matches.js`'s close rule is
regenerated accordingly.

**Curated rows are author-trusted for all their members.** A human wrote them (the Riviera row
deliberately lists Rainha *and* Castelo — one panoramic cam on the Irmão restaurant, two breaks), so
every member is a trusted cam link; among multiple trusted candidates the nearest wins, with curated
and name-match ranked equally. (An earlier draft trusted only the row's nearest member, which
wrongly demoted Castelo — the user's favorite spot — and proved the reading too strict.) During M1
curation, curated rows still gain an explicit `camCoverage: [surflineSpotIds]` field so cam
semantics become data rather than convention.

**Surfline native cams count as at-spot cams.** Cached pages expose per-spot `cameras[]`
(title + public still-image URL) that the pipeline currently ignores — 27 of the 89 spots seen in
cache have ≥1 Surfline cam (Nazaré 3, Carcavelos 3, Costa da Caparica 3, Castelo 1, Cova do Vapor 1,
São João 1, Fonte da Telha 2, Supertubos 2…). `build-surfline-spots.js` extracts them into
`staticMetadata.surflineCams`; a spot with a Surfline cam passes the "good cam" gate even with no
trusted MEO stream (the report view shows the cam; the still is embeddable). Stills are fetched
on-view only, never polled.

**Stretch semantics for continuous beaches.** The Caparica strip (Cova do Vapor → Fonte da Telha)
is one ~10 km beach the user wants visible as a unit — "see which spot seems best, via MEO or
Surfline". Strip spots therefore promote with `camCoverage: "stretch"`: each carries an ordered list
of nearby strip cams (MEO streams + Surfline stills) labeled honestly ("Nova Praia cam · 0.5 km N"),
never presented as at-spot. The UI gets a **stretch view**: a "Caparica stretch" chip on any strip
spot opens all strip cams + spot conditions north→south in one scan. Caxias joins the Linha
seafront the same way (no cam at Caxias on either provider; the user's "big-day Caxias check" is the
Paço de Arcos cam 1.8 km east on the same seawall — labeled as such).

**Caparica/Fonte-da-Telha ambiguity zone (user warning).** On the strip (lat 38.55–38.69,
lon −9.30…−9.15) names share regional stems — "Costa da/de Caparica…", "Fonte da Telha…" — and
differ only by suffix (NORTE, CDS, Nova, Tarquínio, Sereia/Morena), so n-gram scores are inflated
for wrong pairs and deflated for right ones. **Name-based auto-trust is disabled in the zone**; only
curated rows or ≤ 0.2 km qualify, and the name scorer treats regional stems as stopwords so suffixes
carry the signal. Practical effect: the strip resolves via the curation queue, which is the point.

Effect on current data: 41 of 73 in-fence Surfline spots auto-trust (38 by name, 3 by ≤200 m);
50 of 62 in-fence stream cams keep a trusted source. Three current `needs-review` rows auto-resolve
(consolação and baleal by name, cantinho-da-baía @0.2 km); ~17 loose corridor associations demote to
the queue (e.g. `estoril←tamariz@0.5 km`, `cave←ribeira-dilhas@1.2 km`). Known scorer weaknesses to
fix or hand-curate fast: same-beach pairs the current `nameScore` misses, like
`praia-do-sul←ericeira-praia-do-sul` and the `crismina←cresmina` spelling variant.

Workflow:

- Keep using `docs/surfline-needs-review.html` for judgment calls; add
  `scripts/apply-mapping-feedback.js` that ingests the page's exported feedback JSON and writes
  accepted picks into `data/meo-surfline-matches.json` as `source: "curated"` rows (rejected →
  `reviewStatus: "rejected"`, excluded from runtime), then reruns the downstream builds.
- Promotion does not wait on this; it only affects which MEO cams get `surfline-fresh` provenance
  and which promoted spots get a `linkedCamId`.

### 5.9 Persistent promotion map page — `docs/surfline-promotion-map.html` (new)

The chat map widget used for the first selection round becomes a repo artifact, mirroring the
needs-review page pattern: `scripts/build-promotion-map-html.js` renders a self-contained page from
the live data files — coast map + all in-fence Surfline spots, tier-colored by trusted-cam status,
with the **current manifest state pre-checked**. Toggling spots produces an updated
`surfline-promotions.json` body to copy/download; the same page lists the untrusted-association
queue for quick confirm/reject export into `apply-mapping-feedback.js`. Re-curating promotions is
therefore a routine data-only commit, available any time — never a one-shot decision.

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
- `test/monitor-cameras.test.js`: fence gating (lat 39.66 excluded, 39.65/38.40 included; lon −9.04
  excluded, −9.06 included), freshness gating, promoted spots eligible.
- Name-first trust rule table: name-match @2.6 km → trusted; no-name @0.3 km → untrusted;
  no-name @0.15 km → trusted; curated always trusted.
- Extraction: fixture cached page (committed test fixture, not live fetch) → conditions record
  snapshot; nearby-record completeness assertion.
- Existing 13 test files keep passing unchanged (rateSurfSpot keeps a back-compat wrapper).

## 8. Rollout

1. **M1 — mapping & data:** regenerate matches under the §5.8 name-first close rule; apply-feedback
   importer; curate the demoted/needs-review queue; conditions extractor + units fix; **Surfline
   native cam extraction (`staticMetadata.surflineCams`)**; promotion manifest + build (map
   selection as seed, stretch semantics); persistent promotion map page (§5.9).
2. **M2 — app:** forecast-sources resolution + rating changes + provenance chips; promoted spots
   merged, favoritable, on Explore map; fence + freshness gates on Might-be-good.
3. **M3 — refresh:** step 0 probe workflow (report pages + KBYG from a runner); then scheduled GH
   Action with politeness budget, validate-before-commit, step summaries, failure alerting, and the
   6 h freshness-guard issue — or launchd CDP fallback if the probe fails; staleness banner;
   on-load Open-Meteo refresher.
4. Out of scope v1: Surfline live proxy, dual-entity refactor, per-user fence config, drive-time
   work (issue #1), service worker/offline.

## 9. Decisions from review (2026-07-06) + remaining input

Resolved by user review:

1. **Matching:** name-first trust rule (§5.8) — the cam must be AT the spot; distance tolerance
   exists only to absorb bad geo pins when names match; no-name tolerance ≤ 0.2 km.
2. **Runner:** GH Actions primary with probe + fail-safe + logging/alerting (§5.6); local CDP as
   tested fallback. Everything dry-runs locally before scheduling.
3. **Rating:** Surfline `POOR` hard-vetoes, hardcoded v1.
4. **Fence:** lat 38.40–39.65 with lon ≤ −9.05 — Sesimbra kept, Arrábida/Setúbal pocket out.

5. **Promotion list received (2026-07-06):** 44 spots; per the user's "only promote with good cams —
   feel free to override" instruction plus the follow-up "I want that long stretch of beach visible",
   the gate splits them 36 at-spot-cam / 6 stretch-cam / 2 deferred (§5.1).
6. **Caparica naming hazard** flagged by user → ambiguity-zone handling in §5.8.
7. **Castelo pause → rule fix:** requiring an exception for the user's favorite spot exposed the
   primary-only reading of curated rows as too strict; curated rows are now author-trusted for all
   members (§5.8), and Surfline's native Castelo cam (Irmão restaurant) independently confirms it.
8. **Caxias finding:** no cam at Caxias on either provider (Surfline page: 0 cams); the big-day
   check is the Paço de Arcos cam on the same seawall — Caxias promotes as a stretch spot with that
   labeling rather than being dropped.

No remaining inputs — spec is complete pending final approval to start implementation planning.
