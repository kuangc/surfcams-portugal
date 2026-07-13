# Might Be Good Today Design

Date: 2026-07-13

Status: Design baseline selected; written specification awaiting final user review

Supersedes: the ranking and decision-surface portions of `2026-06-07-best-today-monitor-deck-design.md`

Builds on: `2026-07-11-spot-advice-local-lens-design.md`

## 1. Goal

Make **Might be good** a precision-first answer to two practical questions:

1. Which nearby breaks are genuinely worth considering today for this user?
2. When should the user leave and surf each break today?

The feature must combine fresh hourly forecast data, reviewed local spot advice, the user's surf preferences, travel time, daylight, and evidence confidence. It must prefer an honest empty state over a confident-looking false positive.

## 2. Product decision

`Might be good` means **personally surfable for the user, after the break clears an objective surf-quality floor**.

This is deliberately different from:

- ranking objectively powerful waves that are too large or difficult for the user;
- accepting anything inside the user's size range even when the surf is poor; or
- copying Surfline's condition label across spots as if `Fair` means the same thing everywhere.

The surface remains a recommendation aid rather than a guarantee. It must expose why a spot qualified and how confident the app is.

## 3. User outcome

Within a few seconds of opening `Might be good`, the user can see:

- whether there are any trustworthy options today;
- the best surf window for each qualifying break;
- when to leave, including estimated drive time and a setup buffer;
- the three or fewer factors that most affected the recommendation;
- whether the claim is supported by spot-specific advice, inherited advice, a camera, or only a model; and
- which uncertain cases are worth checking without letting them dilute the main recommendations.

A successful card reads like:

> **São Julião · Good for you**
>
> Leave by 9:45 · surf 10:30–12:30
>
> Suitable size · mid tide approaching · light offshore
>
> Medium confidence · check live cam

## 4. Evidence and reference products

### 4.1 Observed product patterns

The following are observed product behaviors, not claims that Surfcams Portugal should copy wholesale.

#### Surfline

- Surfline publishes hourly spot ratings and encourages using them to compare times at a familiar spot.
- Surfline states that ratings are relative to each spot's potential and that model ratings at many spots use surf height and wind but can miss tide, residual chop, and other local dynamics.
- Surfline distinguishes modeled ratings from forecaster-observed ratings; human observation carries more context.
- Surfline's synchronized forecast views let users compare surf height, swell, wind, tide, and rating at the same hour.
- Surf Alerts allow preferred surf-height, rating, and time-window criteria.
- Surfline Sessions and Forecast Matches use previously logged sessions to identify similar future conditions.
- Cam Matches compare a future forecast with footage from historically similar conditions.

Sources:

- [Surf Ratings & Colors](https://support.surfline.com/hc/en-us/articles/36277684017819-Surf-Ratings-Colors)
- [Understanding the Spot Forecast Page](https://support.surfline.com/hc/en-us/articles/13749782983579-Understanding-the-Spot-Forecast-Page-on-the-Surfline-Website)
- [Surfline What's New: forecast customization, matches, and alerts](https://www.surfline.com/lp/whatsnew/home)
- [Surf Alerts](https://support.surfline.com/hc/en-us/articles/360045676592-Surf-Alerts-iOS-only)

#### Surf-Forecast

- Surf-Forecast collapses swell size, period, and wind into a star rating.
- It explicitly distinguishes open-water swell height from breaking-wave height at a beach or reef.
- It recommends calibrating a local break by remembering the forecast swell, period, and energy on known good and known limiting days.
- Wave energy is treated as an important power signal that can distinguish equal-height swells.

Source: [Surf-Forecast FAQ](https://www.surf-forecast.com/pages/faq)

#### Windy.app

- Windy.app keeps detailed raw forecast variables in a sport-specific forecast profile.
- Its Spot Info separates evergreen local knowledge such as bottom, best tide, working swell and wind directions, useful size, and crowd from the time-series forecast.
- The map supports finding and comparing nearby spots.

Source: [Windy.app surfing guide](https://windy.app/guide/mini-guide-to-surfing.html)

#### Strike Mission

- Strike Mission ranks nearby home breaks by today's score and divides a day into several session times.
- It surfaces live swell, wind, tide, confidence, hazard warnings, and alert thresholds.
- It accounts for prior onshore or offshore wind as a lagging quality factor.
- Its single 0–100 score is highly scannable but creates more apparent precision than this product should claim initially.

Source: [Strike Mission](https://www.strikemission.app/)

#### Spotadvisor

- Spotadvisor treats modeled nearshore face height as fallible.
- It lets users rate logged sessions and learns which conditions worked for them at a spot.

Source: [Spotadvisor](https://spotadvisor.app/)

### 4.2 Product inference

The strongest shared pattern is not a universal score. It is a loop:

1. use hourly forecast data to locate candidate windows;
2. translate the forecast through local spot knowledge;
3. show a simple recommendation with inspectable reasons;
4. verify with observation or a camera; and
5. learn from the actual session.

Surfcams Portugal should use that loop while preserving its existing strengths: a curated Lisbon-area roster, camera-led checking, explicit local advice, and a privacy-preserving static architecture.

### 4.3 Source coverage and limits

This design used public official product/support pages, the current repository, and the current canonical advice data. Surfline's documentation is strong evidence for how its ratings are intended to be interpreted. Surf-Forecast, Windy.app, Strike Mission, and Spotadvisor are useful pattern references, but their public pages do not prove forecast accuracy in Portugal. No logged-in competitor flows, private product telemetry, support tickets, or moderated user interviews were available. Competitor marketing claims are therefore treated as product-positioning evidence, not accuracy evidence.

### 4.4 Opportunity map

- **Immediate:** prove the hourly local-breaking-surf data path, activate reviewed hard gates in a pure decision engine, and stop distance-first ranking.
- **Next product slice:** ship Best bets, Worth checking, leave times, and the synchronized today timeline.
- **Deeper validation:** accumulate session outcomes, measure false positives, and review calibration suggestions before activating numerical face-height corrections.

## 5. Current-state findings

### P0: the current model cannot answer “when today”

`src/live-forecast.js` requests hourly Open-Meteo arrays but retains only the current hour. `data/surfline-conditions.json` stores a current provider snapshot, not an hourly today series. The app can judge a moment, but it cannot compare morning, midday, and afternoon.

### P0: reviewed local advice does not influence recommendation eligibility

The July advice implementation intentionally made advice display-only. Tests require recommendation ordering and `rateSurfSpot` behavior to remain unchanged by advice. That was a safe first slice, but it now contradicts the product objective: a known-flat Sesimbra or Caxias can still qualify if generic provider numbers pass.

### P1: the current ranking optimizes distance before predicted session quality

`mightBeGoodCameras` filters on a binary `isRecommended` result, then sorts by drive distance. Surfline rating only breaks distance ties. A nearer marginal spot can outrank a much better option.

### P1: Surfline model ratings are treated too strongly and too uniformly

`rateSurfSpot` hard-vetoes `POOR` and `VERY_POOR` without retaining whether the rating was model-generated or forecaster-observed. Surfline itself warns that modeled ratings can omit tide and local spot dynamics and are relative to a spot's own potential.

### P1: verdict and confidence are conflated

Freshness, scope, source type, unresolved evidence, and missing inputs do not form a separate confidence judgment for recommendations.

### P2: there is no calibration loop

The app cannot record whether a recommendation was worth the trip or how the observed breaking-wave size compared with the forecast.

## 6. Product principles

1. **Precision over coverage.** An empty Best bets section is better than filling the monitor with doubtful spots.
2. **Evaluate sessions, not spots.** The core unit is a spot during a reachable daylight window.
3. **Separate quality from confidence.** “Likely good” and “well supported” answer different questions.
4. **Local rules change decisions.** Reviewed structured advice may gate or modify a recommendation; prose-only advice may not.
5. **Observed beats modeled for now.** A structured current human observation can override a current model call, while future windows remain forecast-based. A raw camera stream is a verification affordance, not an automatically scored observation.
6. **No false precision.** The public UI uses `Good`, `Worth checking`, and `Poor`, not an unexplained 0–100 score.
7. **Explain the decisive factors.** Show no more than three reasons by default.
8. **Keep advanced detail available.** Raw hourly data and sources remain behind disclosure.
9. **Preserve privacy.** Session feedback is local and exportable unless a future design explicitly introduces accounts.

## 7. Advice-to-UX taxonomy

Advice type determines whether a record gates eligibility, changes a time-window assessment, adjusts confidence, or only explains the break.

| Advice shape | Decision role | Compact UX | Detail UX |
| --- | --- | --- | --- |
| Numeric minimum swell | Hard eligibility gate for each hour | Suppress from Best bets below threshold; explain in Worth checking or detail | “Needs about 2 m primary swell before waves appear here” |
| Reviewed local size calibration | Transform or qualify the expected local face-size estimate | Show the calibrated local range | Provider estimate, local estimate, evidence, and confidence |
| Qualitative sheltered-size advice | Confidence or explanation only until converted into a reviewed calculation | “Sheltered; outside forecast may overstate this spot” | Full claim and sources |
| Tide preference | Time-dependent quality modifier | “Mid tide approaching” and a best window | Preferred stage/direction over the today timeline |
| Swell direction preference | Time-dependent reach/quality modifier | “W swell reaches this bay” or “direction is marginal” | Accepted direction arcs and hourly direction |
| Wind direction or speed preference | Time-dependent quality modifier | “Light offshore until noon” | Hourly wind, coast exposure, and residual-wind caveat |
| Period or energy preference | Time-dependent power modifier when structured | “Enough energy” or “weak short-period swell” | Hourly period/energy and supported range |
| Mechanics | Explanation only unless a separate structured rule exists | Usually omitted | Why the break behaves this way |
| Ability or hazard | Always visible when material; gating only if structured and reviewed | Hazard or skill warning | Full context and source |
| Crowd or access | Practical modifier, never surf-quality arithmetic | Timing/access note | Full advice |
| Stretch or area inheritance | Same rule behavior with a confidence penalty | “Caparica pattern” or “Area pattern” | Scope and affected spots |
| Unresolved conflict | Must not score | Move to Worth checking | Show both positions and sources |
| Expired or stale advice | Must not score | Omit from reasons; reduce confidence if material | “Needs revalidation” |

### 7.1 Scope behavior

Existing precedence remains `spot > stretch > area` for the same `overrideKey`.

- Spot-specific reviewed advice has full decision weight.
- Stretch advice may affect the decision but caps confidence at `medium` unless corroborated at the spot.
- Area advice may explain or create a `Worth checking` result, but it cannot by itself produce a Best bet.
- An unresolved same-key conflict makes that factor unknown rather than averaging the sources.

### 7.2 Numeric size calibration

The current Sesimbra, Caxias, and Torre records are activation thresholds, not face-height transforms. They can say whether a spot is likely flat or may start working, but they cannot yet say that Surfline overstates faces by a fixed percentage.

A future calibration rule may be activated only when it defines:

- the input source and field;
- the applicable spot and conditions;
- the output local-face estimate;
- evidence count and confidence; and
- behavior outside the observed range.

Until then, the UI must label those rules as thresholds.

## 8. Today decision engine

### 8.1 Unit of evaluation

Evaluate each selected spot for every hourly point from the current Lisbon hour through last light. Do not evaluate past hours. Merge adjacent qualifying hours into candidate surf windows.

The pure evaluation unit is:

```js
evaluateSpotAtTime({
  subject,
  hourlyForecast,
  tidePhase,
  advice,
  preferences,
  observation,
  sourceFreshness
})
```

It returns:

```js
{
  eligibility: "eligible" | "ineligible" | "unknown",
  quality: "good" | "possible" | "poor",
  confidence: "high" | "medium" | "low",
  reasons: [],
  blockers: [],
  warnings: [],
  expectedLocalSurf: null | { minM, maxM, basis },
  evidence: []
}
```

Quality and confidence must be computed independently.

### 8.2 Eligibility gates

An hour is ineligible when any applicable hard gate fails:

- hourly marine or wind data is too stale for a today recommendation;
- the reviewed local minimum-swell threshold is not met;
- the expected local surf range does not overlap the user's configured size range;
- a reviewed structured swell-direction rule explicitly declares the outside-arc effect as blocked;
- a reviewed structured safety or skill rule excludes the session; or
- the hour is outside daylight.

An unknown mandatory input produces `unknown`, not `eligible`.

Existing qualitative mechanics and hazards do not become hidden gates merely because they sound important. They remain warnings until the data model expresses an explicit reviewed decision rule.

The current `direction-preference` rules identify useful directions but do not declare that every other direction is blocked. A mismatch is therefore a quality penalty, not an eligibility failure, until the schema and reviewed claim explicitly define a blocking outside-arc effect.

### 8.3 Quality

For an eligible hour, assess only factors that exist for that spot:

- local size fit;
- wind alignment and speed;
- tide preference;
- swell direction quality;
- period or energy fit; and
- provider condition evidence.

The first implementation uses ordered rule outcomes rather than opaque learned weights:

- `good`: size fits, no known destructive factor is active, and every available critical local factor is favorable or neutral;
- `possible`: eligibility passes but one dynamic factor is marginal or unknown;
- `poor`: a destructive quality factor is active even though the spot remains physically surfable.

For a reviewed tide preference, a matching stage/direction is favorable and a nonmatching stage is marginal unless a separate reviewed rule explicitly marks that stage poor. This is what allows tide advice to move a window without pretending the break is physically impossible at every other tide.

A modeled Surfline `POOR` or `VERY_POOR` is a negative quality factor, not an unconditional cross-spot veto. A fresh forecaster-observed `POOR` or `VERY_POOR` can veto the current hour. The extraction layer must preserve whether a provider rating is modeled or observed before this distinction is activated.

### 8.4 Confidence

Confidence depends on evidence coverage, not on whether conditions are good:

- `high`: fresh hourly inputs, spot-specific reviewed rules for every decisive local factor, and a confirming structured human or provider observation;
- `medium`: fresh hourly inputs plus reviewed spot or stretch rules, with no decisive conflict;
- `low`: material missing inputs, area-only advice, unresolved evidence, or a stale observation.

Only `good` windows with `high` or `medium` confidence enter **Best bets**.

### 8.5 Window construction

- Merge adjacent `good` hours into a window.
- A candidate window must span at least 90 minutes after interpolation around hour boundaries.
- Compute earliest reachable surf time as `now + drive estimate + setup buffer`.
- Default setup buffer is 15 minutes and is user-configurable.
- After travel and setup, at least 60 minutes of the candidate window must remain.
- Exclude a window that ends after last light unless at least 60 daylight minutes remain.
- Select the best reachable window per spot for the primary card; other windows remain in detail.

Public times should match the data resolution. Hourly forecasts use rounded, human-friendly windows such as `10am–12pm`, not minute-level false precision. Tide-event labels may include their actual event time in detail.

### 8.6 Ranking

Rank Best bets in this order:

1. a fresh structured human/provider observation confirming the current candidate window;
2. confidence;
3. useful in-water duration after travel;
4. stability across adjacent forecast hours;
5. drive time; and
6. deterministic spot name tie-break.

Drive time must no longer outrank predicted session quality.

The internal comparison may use ordinal tuples. Do not expose a single numeric score until field evidence demonstrates that the number is calibrated and useful.

## 9. Might be good UX

### 9.1 Surface structure

Keep the existing Monitor route and camera-led tiles. Within `Might be good`, render:

1. **Best bets** — strict qualifying recommendations.
2. **Worth checking** — collapsed uncertain or marginal cases.
3. A decision-specific empty state when no Best bet exists.

Do not auto-fill Best bets to the monitor limit.

### 9.2 Best bet card

The time call is the first text after the spot name:

- `Go now · good until noon`
- `Leave by 9:15 · surf 10am–12pm`
- `Later today · surf 4–6pm`

Then show:

- `Good for you`;
- expected local surf range and its basis;
- no more than three decisive reasons;
- confidence and evidence basis;
- a material hazard warning, if any; and
- `Check live cam` or the existing provider-report action.

The existing video/report frame remains the visual anchor. The condition strip becomes recommendation-specific rather than a generic dump of metrics.

### 9.3 Today timeline

Every card includes a compact daylight timeline with:

- poor, possible, and good intervals;
- a visible `now` marker;
- the selected best window; and
- darkness outside first-light/last-light bounds.

Expanding the card reveals synchronized size, swell, wind, tide, and provider evidence for the selected hour, following Surfline's useful linked-time pattern without copying its full forecast interface.

### 9.4 Worth checking

Place a spot here when:

- forecast conditions are promising but a decisive input is unknown;
- relevant advice is inherited only from an area;
- sources conflict;
- a structured observation made from the camera or beach disagrees with the model;
- the window is too short after travel; or
- quality is `possible` rather than `good`.

Every entry must say why it did not qualify. Worth checking never occupies a Best bet slot.

### 9.5 Empty states

Use specific language:

- `Nothing reliably good today.`
- `No fresh hourly forecast — cannot make a trustworthy call.`
- `The remaining good window is too short after the drive.`

The old “best fresh reading” near-miss must not masquerade as a recommendation.

## 10. Hourly data architecture

### 10.1 Required series

For every selected subject, retain today's hourly:

- spot-level expected breaking-surf minimum and maximum, when a trusted provider forecast or reviewed local conversion can supply it;
- significant wave height and direction;
- primary swell height, direction, and period;
- wind speed and direction;
- forecast timestamp and fetch timestamp;
- tide phase derived from the existing tide events; and
- first light and last light.

An hourly spot-level breaking-surf estimate is mandatory for Best bets because the user's configured size range describes breaking surf, not offshore significant-wave height. Open-Meteo's wave and swell heights must never be labeled or compared as local face height without a reviewed spot conversion.

The first implementation must therefore establish at least one trusted size path for a spot:

1. a permitted Surfline or other provider hourly breaking-surf series; or
2. a reviewed local conversion from hourly swell inputs to an expected breaking-surf range.

If neither path exists, the spot may appear in Worth checking with offshore/model context, but it cannot enter Best bets. The current cache/extractor preserves only a current Surfline face estimate, so hourly provider extraction is a required data-readiness task rather than an assumed capability.

### 10.2 Open-Meteo batching

Open-Meteo's Marine and Weather APIs accept multiple comma-separated coordinates. The app should fetch the selected 44-spot roster in bounded batches, cache the normalized result for one hour, and reuse identical coordinate results for linked camera/advice subjects.

Use separate marine and weather requests. A failed batch may be retried as smaller batches, but missing data must remain explicit. Do not silently fall back to static MEO data for a positive recommendation.

Source: [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)

### 10.3 Source roles

- **Open-Meteo hourly series:** temporal shape of offshore swell, significant wave, and wind today; never an unqualified local face estimate.
- **Existing tide cache:** tide stages and daylight.
- **Trusted hourly provider series:** spot-level expected breaking-surf range when a permitted, verifiable source is available.
- **Fresh Surfline spot snapshot:** current spot face estimate, condition evidence, and model/observed provenance once preserved.
- **Reviewed local advice:** convert, gate, or interpret the forecast.
- **Structured human observation:** validate or override current conditions only.
- **Camera stream:** let the user verify the recommendation; it does not score conditions automatically.
- **Static MEO snapshot:** display fallback, never Best bet evidence.

### 10.4 Freshness

Freshness thresholds remain named configuration rather than scattered constants. The initial implementation should distinguish:

- hourly forecast fetch freshness for today decisions;
- provider observation freshness for current overrides;
- tide-cache freshness; and
- advice expiry.

Future-dated, missing, or stale timestamps produce unknown evidence. Tests use fixed clocks at threshold boundaries.

## 11. Feedback and calibration

### 11.1 Private session check-in

After the recommended window, offer an optional compact check-in:

> Was it worth going? `Good` / `Meh` / `Bad`
>
> Actual faces: `flat` / `baby` / `0.5 m` / `1 m` / `bigger`

Record:

- spot id;
- arrival and surf time;
- recommendation id or forecast snapshot digest;
- verdict;
- observed face-size bucket; and
- optional note.

Store this locally in the browser. Provide JSON export/import so the observations remain reviewable and portable.

### 11.2 Learning policy

Feedback does not silently mutate canonical advice or recommendation rules.

After repeated comparable observations, generate a review suggestion such as:

> Torre started working at 1.7 m primary swell in 4 of 5 observations. Current rule: 1.5 m. Review an update?

A human-approved change enters the canonical advice workflow with its supporting local observations. The user need not use the current raw review cockpit; a later design may provide a simpler calibration-review surface.

### 11.3 Product metrics

The primary metric is recommendation precision:

- percentage of recommended sessions rated `Good`;
- false-positive rate: recommended but rated `Meh` or `Bad`;
- predicted-versus-observed local face-size error;
- percentage of recommendations with a usable leave time; and
- evidence confidence versus actual outcome.

Coverage—the percentage of days with at least one Best bet—is secondary. Do not improve coverage by weakening the quality floor.

## 12. Failure handling

- **No fresh hourly data:** no Best bets; explain the missing source.
- **Partial batch failure:** evaluate only spots with complete required inputs; name the unavailable region or spots.
- **Missing local advice:** allow model-based assessment only when the completed research ledger explicitly shows no applicable structured local gate; absence of research never counts as evidence. Cap confidence and explain the gap.
- **Unresolved advice conflict:** ignore that factor, cap confidence, and move the result to Worth checking when the factor is decisive.
- **Observation contradicts model:** a fresh structured human/provider observation controls `now`; the forecast remains available for later windows with a mismatch warning. A raw camera stream alone does not create this state.
- **Stale provider snapshot:** omit it from decisive evidence.
- **Static MEO-only conditions:** display the camera but do not recommend the spot.
- **No reachable daylight window:** exclude the spot and explain that the useful window is too short after travel.
- **No drive estimate:** omit departure time, cap confidence at `medium`, and show the surf window only.
- **Expired advice:** stop scoring the claim and expose its revalidation status in detail.

## 13. Testing and verification

### 13.1 Pure decision tests

Add deterministic tests for:

- minimum-swell gates at, below, and above the threshold;
- tide preference at high, mid, low, rising, and falling phases;
- wrapped swell/wind direction arcs;
- modeled versus observed provider ratings;
- quality and confidence independence;
- spot, stretch, area, conflict, and expiry behavior;
- missing or stale mandatory inputs;
- daylight and travel-time reachability;
- window merging and minimum duration;
- ranking quality before distance; and
- deterministic tie-breaking.

### 13.2 Required local scenarios

Use fixed hourly fixtures to prove:

- Sesimbra and Caxias cannot qualify below a 2 m primary swell;
- Torre cannot qualify below its reviewed threshold and can become eligible when the threshold is met;
- the Caparica stretch becomes more favorable near its preferred high-tide window, while spot-specific exceptions override it;
- São Julião's preferred mid-tide window changes the suggested surf time;
- an inherited-only area rule cannot create a Best bet by itself;
- a Surfline model `POOR` does not erase stronger reviewed local evidence automatically;
- a fresh observed `POOR` can suppress the current hour; and
- a later good window remains visible when current conditions are poor.

### 13.3 Data tests

- Normalize batched marine and weather responses into one per-subject hourly contract.
- Preserve fetch time, source time, units, and missing values.
- Cache for one hour and invalidate deterministically.
- Split and retry failed batches without duplicating subjects.
- Preserve Surfline modeled-versus-observed provenance when available.
- Reject static-only or future-dated inputs for Best bets.

### 13.4 UI tests

- Best bets contains only `good` plus `high`/`medium` confidence windows.
- Worth checking remains separate and collapsed by default.
- Cards show one time call, no more than three reasons, confidence, and a camera/report action.
- `Go now`, future leave time, later today, and empty states render correctly.
- The timeline marks now, daylight, and the selected window.
- Keyboard and screen-reader users can expand a card and return focus.
- Mobile cards preserve the time call and camera before advanced detail.

### 13.5 Field verification

Automated tests prove rule consistency, not surf accuracy. Before calling the feature accurate:

1. run the engine against at least ten varied forecast days or archived snapshots;
2. inspect recommendations against available cameras;
3. record actual outcomes for the user's favorite breaks; and
4. calculate false-positive rate separately for high- and medium-confidence recommendations.

Do not describe the product as calibrated until field outcomes support that claim.

## 14. Scope

### Included in the implementation plan

- Full-day hourly marine and wind series for the selected 44-spot roster.
- A pure spot-by-time evaluation engine.
- Structured advice activation for existing minimum, tide, and direction rules.
- Separate quality and confidence.
- Reachable surf-window and leave-time calculation.
- Best bets, Worth checking, today timeline, and honest empty states in Monitor.
- Current camera/report verification.
- Private session feedback with JSON export/import.
- Deterministic unit, data, and UI tests.

### Deferred

- Automatic mutation of advice from feedback.
- A hosted account or shared feedback backend.
- A public 0–100 score.
- Crowd prediction without credible data.
- Automatic numerical face-height correction without reviewed calibration evidence.
- A redesign of the raw advice review cockpit.
- Long-range trip planning beyond today.

## 15. Acceptance criteria

The design objective is satisfied only when current evidence proves all of the following:

1. `Might be good` evaluates the remaining daylight hours today, not only the current snapshot.
2. A break cannot enter Best bets when a reviewed local hard gate fails.
3. Tide and other dynamic advice can move the recommended surf window.
4. Every Best bet has a reachable surf window and, when drive data exists, a leave time.
5. Best bets includes only `good` recommendations with at least medium confidence.
6. Uncertain, conflicted, or marginal cases stay in Worth checking.
7. Session quality outranks drive distance; drive time breaks close ties.
8. Modeled Surfline ratings are supporting evidence rather than an unconditional cross-spot veto.
9. A current structured human/provider observation can override the current model call without rewriting future hours; a camera remains an explicit user verification step.
10. Static-only or stale inputs cannot produce a positive recommendation.
11. The UI explains each recommendation with no more than three decisive reasons and explicit confidence.
12. The user can privately record whether a recommended session was good and export the observation.
13. Deterministic tests cover the named local scenarios and all rule/failure boundaries.
14. Field verification reports recommendation precision and false-positive rate before accuracy claims are made.

## 16. Design completion note

This specification defines the product behavior, data boundaries, evidence hierarchy, UX, failure states, and verification contract. Implementation begins only after final user review of this written spec and creation of a separate implementation plan.
