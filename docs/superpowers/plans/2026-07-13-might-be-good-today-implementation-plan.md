# Might Be Good Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “Might be good” show only trustworthy surf opportunities for the remaining daylight today, with a clear best time to go and explicit reasons when a spot is merely worth checking.

**Architecture:** Keep provider inputs, local advice, and the recommendation verdict separate. Normalize full-day Open-Meteo marine/wind series in the browser, combine them with fresh current Surfline spot-face estimates and reviewed advice in a pure hourly decision engine, then render strict Best bets and separate Worth checking results. A Surfline-anchored local face curve may qualify only while the Surfline anchor is fresh; raw offshore wave height is never presented as local face height. Private session feedback is stored separately and does not silently mutate advice.

**Tech Stack:** Browser-native ES modules, Node.js test runner, static JSON data, localStorage, Open-Meteo Marine/Weather APIs, existing Surfline/tide/advice caches.

---

## Scope guardrails

- Preserve Favorites behavior and all Explore/Favorites configuration behavior.
- Do not depend on the unused review cockpit for everyday recommendation UX.
- Do not label Open-Meteo `wave_height` or `swell_wave_height` as breaking face height.
- Do not place `unknown`, `possible`, conflicted, stale, or low-confidence windows in Best bets.
- Keep reviewed canonical advice read-only at runtime; session feedback is a separate local record.
- Keep recommendation logic in pure modules; DOM code only renders its contract.

## Task 1: Retain and normalize the full today forecast

**Files:**
- Modify: `src/live-forecast.js`
- Modify: `test/live-forecast.test.js`

- [ ] Add a failing test that supplies hourly wave, primary swell, and wind arrays and expects a normalized `hours` array rather than only the current hour. Each point must have:

```js
{
  time: "2026-07-07T15:00:00.000Z",
  offshoreWaveM: 1.2,
  primarySwellHeightM: 0.9,
  primarySwellPeriodS: 9,
  primarySwellDirectionDeg: 300,
  windKmh: 22,
  windDirectionDeg: 345
}
```

- [ ] Run `node --test test/live-forecast.test.js` and confirm the new assertion fails because `hours` is absent.
- [ ] Extend the marine request with `swell_wave_height,swell_wave_period`; retain `wave_period` only as fallback when the primary-swell period is missing.
- [ ] Add and export `normalizeHourlyForecast(marine, wind)` that joins rows by ISO hour, drops rows without a valid time, and fills missing wind fields with `null`.
- [ ] Keep the existing current-point properties for Explore and condition-strip compatibility, deriving them from the normalized point nearest `now`.
- [ ] Version the cache key to `surfcamLiveForecast:v2:<cameraId>` so v1 current-only payloads cannot masquerade as hourly data.
- [ ] Add tests for: marine-only degradation, mismatched wind timestamps, malformed cache recovery, and a cache hit retaining all hours.
- [ ] Run `node --test test/live-forecast.test.js` and confirm it passes.
- [ ] Commit: `git add src/live-forecast.js test/live-forecast.test.js && git commit -m "feat: retain hourly live forecast series"`

## Task 2: Expose recommendation-ready advice without coupling it to presentation

**Files:**
- Modify: `src/spot-advice.js`
- Modify: `test/spot-advice-runtime.test.js`

- [ ] Add failing tests for a new `recommendationAdviceFor(camera, spotData, now)` helper. It must return active decisive claims plus conflict metadata and omit expired claims.
- [ ] Prove the helper preserves scope (`spot`, `stretch`, `area`), confidence, topic, consensus, and structured rule fields without mutating canonical advice.
- [ ] Run `node --test test/spot-advice-runtime.test.js` and confirm failure because the helper is missing.
- [ ] Implement `recommendationAdviceFor` using `adviceSubjectIdFor`, `runtimeAdvice`, `safeArray`, and the existing expiry logic.
- [ ] Return a frozen contract:

```js
{
  subjectId,
  claims: activeDecisiveClaims,
  conflicts: subject.conflicts,
  researched: true
}
```

- [ ] Return `{ subjectId: null, claims: [], conflicts: [], researched: false }` when no trusted advice subject exists; absence of advice must not be interpreted as evidence that no local rule exists.
- [ ] Add fixed assertions for Sesimbra/Caxias 2 m minimum, Torre 1.5 m minimum, Caparica high-tide preference, São Julião mid-tide preference, and unresolved Supertubos advice.
- [ ] Run `node --test test/spot-advice-runtime.test.js` and confirm it passes.
- [ ] Commit: `git add src/spot-advice.js test/spot-advice-runtime.test.js && git commit -m "feat: expose advice for recommendation decisions"`

## Task 3: Build the pure hourly decision engine

**Files:**
- Create: `src/today-recommendations.js`
- Create: `test/today-recommendations.test.js`
- Modify: `src/surf-rating.js`
- Modify: `test/surf-rating.test.js`

- [ ] Write fixed-fixture tests for `buildLocalFaceCurve`, `evaluateTodayHour`, `buildSurfWindows`, and `recommendTodaySpots`.
- [ ] Prove `buildLocalFaceCurve` anchors the hourly temporal curve to a fresh current Surfline face range:

```js
const ratio = hourlyOffshoreWaveM / anchorOffshoreWaveM;
const localFaceMinM = surflineAnchorMinM * ratio;
const localFaceMaxM = surflineAnchorMaxM * ratio;
```

Cap ratios to `0.5..2` and mark the result `source: "surfline-anchored-model"`, `confidence: "medium"`. Return no local face estimate when the Surfline anchor, offshore anchor, or hourly offshore value is invalid or stale.
- [ ] Run `node --test test/today-recommendations.test.js` and confirm failures because the module is absent.
- [ ] Implement pure direction, daylight, freshness, and tide-phase helpers. Reuse the same tide-stage boundaries as `spot-advice.js`: first/last 20% is low/high, middle is mid.
- [ ] Implement hard eligibility gates in this order: daylight; fresh hourly input; local face estimate exists; user min/max face-size range; reviewed minimum primary-swell rule; fresh observed-provider veto when provenance explicitly says observed.
- [ ] Treat tide, wind, swell direction, period, and modeled Surfline rating as quality factors. A direction preference mismatch is a penalty, not a gate.
- [ ] Compute quality and confidence independently. Use public values `good`, `possible`, `poor` and `high`, `medium`, `low`; do not expose a numeric score.
- [ ] Cap confidence at medium for an anchored curve, stretch advice, or missing drive time; cap at low for area-only decisive evidence, unresolved decisive conflict, missing researched advice, or unknown mandatory inputs.
- [ ] Produce at most three deterministic reason strings ordered: local hard gate/size, tide, wind/swell/period, provider corroboration.
- [ ] Merge adjacent good hourly points into windows, extend each point by 30 minutes on either side, require at least 90 minutes total, and clamp to current time/last light.
- [ ] Rank Best bets by `quality === "good"`, confidence, earliest usable window, window stability, then drive time. Distance must not outrank quality or confidence.
- [ ] Put every remaining fenced, non-favorite candidate with data into Worth checking with exactly one primary exclusion reason.
- [ ] Add the five required spot scenarios plus: stale forecast, outside daylight, oversized surf, missing local face anchor, modeled poor rating, observed poor veto, area-only evidence, and equal-quality distance tie.
- [ ] Refactor/export the coast-bearing helpers needed by the engine from `src/surf-rating.js` without changing current `rateSurfSpot` outputs.
- [ ] Run `node --test test/today-recommendations.test.js test/surf-rating.test.js` and confirm all pass.
- [ ] Commit: `git add src/today-recommendations.js test/today-recommendations.test.js src/surf-rating.js test/surf-rating.test.js && git commit -m "feat: evaluate trustworthy surf windows today"`

## Task 4: Orchestrate today forecasts for the recommendation roster

**Files:**
- Create: `src/today-forecast-store.js`
- Create: `test/today-forecast-store.test.js`
- Modify: `src/main.js`

- [ ] Add failing tests for deduplicating linked spot/camera coordinates, bounded concurrency, one-hour reuse, partial failures, and a generation token that prevents late responses from replacing newer results.
- [ ] Run `node --test test/today-forecast-store.test.js` and confirm the module is absent.
- [ ] Implement `createTodayForecastStore({ fetchForecast, now, concurrency = 6 })` with `load(cameras)`, `get(camera)`, `status(camera)`, and `clear()`.
- [ ] Reuse the existing per-camera localStorage cache inside `fetchLiveForecast`; the store only coordinates in-memory work.
- [ ] Deduplicate exact coordinate pairs and alias the same normalized payload to linked camera/advice subjects.
- [ ] In `src/main.js`, add store state plus a `recommendationGeneration` counter. Load only fenced, non-guide recommendation candidates when Might be good is opened, and rerender progressively as results settle.
- [ ] Preserve Explore’s existing one-spot live forecast behavior.
- [ ] Display loading and partial-failure status without promoting incomplete candidates.
- [ ] Run `node --test test/today-forecast-store.test.js test/source-safety.test.js test/spot-advice-ui.test.js` and confirm all pass.
- [ ] Commit: `git add src/today-forecast-store.js test/today-forecast-store.test.js src/main.js && git commit -m "feat: load today forecasts for recommendation candidates"`

## Task 5: Replace the current Might be good grid with decision-focused UX

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/monitor-cameras.js`
- Modify: `src/styles/app.css`
- Modify: `test/monitor-cameras.test.js`
- Modify: `test/source-safety.test.js`
- Create: `test/today-recommendations-ui.test.js`

- [ ] Add DOM/source-contract tests proving the mode contains a `Best bets` heading, a collapsed `Worth checking` disclosure, and honest loading/empty states.
- [ ] Update monitor tests so recommendations are decision records rather than raw camera arrays; remove assertions that lock distance-first ranking and the old binary `rateSurfSpot` gate.
- [ ] Run `node --test test/monitor-cameras.test.js test/today-recommendations-ui.test.js test/source-safety.test.js` and confirm the new tests fail.
- [ ] Keep the Favorites grid unchanged. Add a separate recommendation root used only in Might be good mode.
- [ ] Render a Best bet card with: spot name; `Go now` or `Best <time range>`; `Leave by <time>` when drive data exists; calibrated local face range; up to three decisive reasons; confidence label; live camera/report action.
- [ ] Add a compact horizontal today timeline. Each remaining daylight hour is a button/segment with `good`, `possible`, or `poor` tone and an accessible label containing time and primary reason. Selecting a segment updates synchronized size, swell, wind, tide, and provider evidence.
- [ ] Render Worth checking inside a native `<details>` element, collapsed by default. Each row states one exclusion reason and links to its camera/report; these rows never start monitor video playback.
- [ ] Use exact empty states:
  - `No trustworthy Best bets for the rest of today.`
  - `No fresh hourly forecast — cannot make a trustworthy call.`
  - `Forecast loaded, but every researched spot misses a hard gate.`
- [ ] Replace the old generic model disclaimer with confidence/source-specific language.
- [ ] Style the surface as a calm recommendation briefing: one-column decision cards, restrained timeline colors, compact evidence disclosure, touch targets at least 44 px, keyboard-visible focus, and mobile horizontal timeline scrolling.
- [ ] Keep Best bets sparse; do not create empty video slots or auto-fill to the monitor limit.
- [ ] Run the three targeted test files and confirm they pass.
- [ ] Run `npm test` and fix only regressions caused by this slice.
- [ ] Commit: `git add index.html src/main.js src/monitor-cameras.js src/styles/app.css test/monitor-cameras.test.js test/source-safety.test.js test/today-recommendations-ui.test.js && git commit -m "feat: show best surf windows for today"`

## Task 6: Add private session feedback without automatic scoring mutation

**Files:**
- Create: `src/session-feedback.js`
- Create: `test/session-feedback.test.js`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Modify: `test/today-recommendations-ui.test.js`

- [ ] Add failing tests for localStorage schema/versioning, input validation, export, import/merge by id, and corrupt payload recovery.
- [ ] Define the stored record:

```js
{
  id,
  spotId,
  startedAt,
  predictedQuality,
  predictedConfidence,
  predictedFaceMinM,
  predictedFaceMaxM,
  actualFace: "flat" | "ankle" | "knee-waist" | "waist-chest" | "head-plus",
  actualQuality: "poor" | "okay" | "good",
  tideStage,
  note
}
```

- [ ] Run `node --test test/session-feedback.test.js` and confirm failure because the module is absent.
- [ ] Implement immutable list/add/export/import helpers under `surfcamSessionFeedback:v1`; cap notes at 500 characters and reject unknown enum values.
- [ ] Add a small `How was it?` disclosure on recommendation cards plus JSON Export and Import controls in Configure.
- [ ] Store the recommendation snapshot with feedback. Do not update canonical advice, thresholds, or ranking from feedback in this release.
- [ ] Run `node --test test/session-feedback.test.js test/today-recommendations-ui.test.js` and confirm they pass.
- [ ] Commit: `git add src/session-feedback.js test/session-feedback.test.js src/main.js src/styles/app.css test/today-recommendations-ui.test.js && git commit -m "feat: capture private surf session feedback"`

## Task 7: Verify source provenance and refresh behavior

**Files:**
- Modify: `scripts/lib/surfline-extract.js`
- Modify: `test/surfline-extract.test.js`
- Modify: `src/forecast-sources.js`
- Modify: `test/forecast-sources.test.js`

- [ ] Add failing extraction tests that preserve `waveHeight.human` and `conditions.human` as explicit provenance fields on the current Surfline record.
- [ ] Run `node --test test/surfline-extract.test.js test/forecast-sources.test.js` and confirm the new assertions fail.
- [ ] Extend `normalizeRecord` with `surfObserved` and `ratingObserved`; propagate them through `resolveConditions` without changing numeric values.
- [ ] Ensure the today engine only applies an observed-provider veto when the relevant provenance boolean is `true`; missing provenance means modeled/unknown, never observed.
- [ ] Run the two targeted tests plus `test/today-recommendations.test.js` and confirm they pass.
- [ ] Commit: `git add scripts/lib/surfline-extract.js test/surfline-extract.test.js src/forecast-sources.js test/forecast-sources.test.js src/today-recommendations.js test/today-recommendations.test.js && git commit -m "feat: preserve Surfline observation provenance"`

## Task 8: Full verification, review, and delivery

**Files:**
- Verify all modified files
- Update if needed: `README.md`

- [ ] Run `npm test` twice; the second run catches cache/order coupling.
- [ ] Run `npm run check-spot-advice` and `npm run check-spot-advice-links`.
- [ ] Run `git diff --check` and `rg -n "TODO|TBD|FIXME|placeholder" src test index.html docs/superpowers/plans/2026-07-13-might-be-good-today-implementation-plan.md` and resolve product-code placeholders.
- [ ] Check contract/type consistency across `live-forecast`, `today-recommendations`, `today-forecast-store`, and `main`: field names, nullable values, enum values, imports, and exports must match their tests and callers.
- [ ] Start the app with `npm run dev`, exercise Favorites and Might be good at desktop and mobile widths, and verify keyboard operation. If localhost bind is blocked by the environment, record the exact error and use direct module/DOM probes instead.
- [ ] Refresh Surfline and tide data if the required browser/session is available; otherwise verify that stale inputs produce the specified honest empty state.
- [ ] Field-check the fixed scenarios in the UI: Sesimbra, Caxias, Torre, Caparica, São Julião, and conflicted Supertubos.
- [ ] Update `README.md` only if commands, data freshness, or user-facing operation changed.
- [ ] Use `superpowers:requesting-code-review` for a whole-branch review and address every valid P0/P1/P2 finding.
- [ ] Use `superpowers:verification-before-completion`; record exact passing counts and any environment-only limitation.
- [ ] Use `superpowers:finishing-a-development-branch`, merge the verified branch to `main`, push `main`, and verify local `main` equals `origin/main`.

## Completion contract

The work is complete only when a user opening Might be good can see the best remaining surf window today, can understand why it qualifies, can distinguish uncertain spots in Worth checking, and never sees a raw offshore model height presented as local surf-face height.
