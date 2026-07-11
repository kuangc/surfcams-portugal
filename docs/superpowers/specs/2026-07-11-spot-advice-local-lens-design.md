# Spot Advice and Local Lens Design

Date: 2026-07-11
Status: Approved direction; written specification awaiting final user review

## 1. Goal

Give each of the 44 selected Surfline spots useful, source-backed local advice and surface the most relevant advice while the user is choosing where to surf.

The feature must distinguish open-water or provider surf height from the breaking waves likely at a specific beach. It must also preserve the user's local knowledge, show where advice is area-level rather than spot-specific, and provide an editable review workflow before proposed numerical corrections influence ratings.

## 2. User outcome

On the Favorites, Monitor, and Explore surfaces, a user can answer three questions without opening another forecast service:

1. Is the provider's displayed size likely to translate into waves at this spot?
2. Is the current or upcoming tide, swell direction, and wind a good fit?
3. Why does the app think that, and how strong is the evidence?

The compact answer is a context-sensitive **Local lens** line. The full answer is an expandable **spot playbook** with advice, sources, scope, confidence, and disagreements.

## 3. Scope

### Included

- The 44 spot ids in `data/surfline-promotions.json`.
- Web research for spot mechanics, swell exposure, tide, wind, useful size, season, skill, and hazards.
- Spot-, stretch-, and area-scoped advice with explicit inheritance.
- A hand-editable canonical data file.
- A generated local review cockpit that can revise records and export review JSON.
- A feedback-application script, following the existing Surfline mapping-review pattern.
- A Local lens on compact spot summaries and a full playbook in spot detail.
- Structured display-only rules that can be evaluated for Local lens text without changing forecast calculations.
- A guide-only Explore representation for selected spots that do not have a trusted camera.

### Not included in the first implementation

- A hosted editing backend or authentication system.
- Automatic learning from user sessions.
- Scraping providers at app runtime.
- Pretending that sparse advice is spot-specific.
- Changing estimates or ratings. Schema v1 is display-only; calculation activation is a later slice.
- Replacing Surfline as the underlying forecast source.

## 4. Selected spots

The canonical roster remains `data/surfline-promotions.json`:

- Nazaré and Peniche: Nazaré, Baleal, Lagide, Cantinho da Baía, Supertubos, Consolação.
- Santa Cruz and Ericeira: Santa Cruz, Cave, Ribeira D'Ilhas, Reef, Pedra Branca, Matadouro, Praia do Sul, Foz do Lizandro, São Julião.
- Sintra and Guincho: Praia das Maçãs, Praia Pequena, Praia Grande, Praia da Adraga, Praia da Ursa, Praia do Guincho.
- Linha: Praia de Caxias, São Pedro do Estoril, Paço de Arcos, Parede, Praia da Laje, Santo Amaro, Carcavelos, Praia de Torre.
- Caparica stretch: Cova do Vapor, São João da Caparica, Marcelino, Praia do Barbas, Costa da Caparica, Praia da Saúde, Praia da Cornélia, Praia da Rainha, Castelo, Praia do Pescador, Praia do Rei, Fonte da Telha.
- South: Lagoa de Albufeira, Bicas, Sesimbra.

A build check must fail if the promotion roster and advice research ledger diverge. All 44 spots must have completed research, an explicit direct-source outcome, and at least one published decision-relevant effective claim. A spot without credible spot-specific research may inherit a stretch or area claim only after the editor explicitly approves that claim's applicability to the spot. The UI must label inherited scope honestly.

The current promotion build produces 42 runtime records and defers Cave and Praia da Ursa because neither has a trusted camera. Advice coverage does not weaken that safety gate. Instead, the advice build emits guide-only Explore subjects for those two spots, using their normalized Surfline coordinates and metadata but no camera or live-conditions claims. Every one of the 44 spots must therefore be openable in Explore even when it cannot appear as a live camera tile.

## 5. Evidence observed during design

The research pass already demonstrates why scope and disagreement are first-class data:

- Caxias is described as sheltered and rarely breaking; Torre is inconsistent and favors south-southwest swell. A swell-component height and a provider's spot-specific breaking-surf range are different inputs and must never be labeled interchangeably.
- Published Caparica guidance ranges from “all tides, depending on the sandbank” to a mid-tide preference at Praia da Rainha. The user's experience that the Caparica coastline works best at high tide must remain visible as local knowledge rather than being silently averaged with generic guidance.
- Cave favors low and falling tide, Reef and Pedra Branca favor high and rising tide, and nearby São Julião favors mid tide. A single Ericeira tide rule would be wrong.
- Open beaches such as Praia Grande, Praia Pequena, Adraga, Lagoa de Albufeira, and São Julião receive swell differently from sheltered Linha and Sesimbra spots.

Initial research sources include:

- Surfline's cached spot travel metadata already normalized in `data/surfline-spots.json`.
- Surf-Forecast spot guides for the 44-spot corridor.
- Local and official sources such as the Ericeira World Surfing Reserve guide, Dr. Bernard's Caparica guide, and Sesimbra municipal beach guidance.
- The user's explicit observations for Sesimbra, Caxias, Torre, Caparica, and São Julião.

## 6. Advice taxonomy

Every advice record has five independent dimensions.

### 6.1 Scope

- `spot`: applies only to one Surfline spot id.
- `stretch`: applies to named members of a continuous coastline, such as the Caparica strip.
- `area`: fallback advice for a broader surf area, such as the Linha or Sintra coast.

Resolution order is `spot > stretch > area`. Every record has an `overrideKey`, such as `tide.preferred-stage` or `size.minimum-primary-swell`. A narrower published record shadows a broader published record only for the same `overrideKey`. Other inherited claims remain available.

`data/stretches.json` is the sole authority for stretch membership. `data/spot-advice.json.areas` is the sole authority for area membership. A spot may belong to at most one advice area and at most one stretch. These memberships are flat, so there is no inheritance graph or cycle behavior.

Two published records at the same scope and `overrideKey` are valid only when they share a `conflictGroupId` and represent explicit alternatives. Otherwise the build fails. An unresolved conflict is compiled for the playbook but cannot produce decisive Local lens text.

### 6.2 Topic

- `size-translation`: how outside/provider height translates locally.
- `tide`: preferred, workable, or poor tide stages and direction of movement.
- `swell`: useful or blocked swell direction.
- `period-energy`: whether period or energy changes the translation materially.
- `wind`: offshore, sheltered, or destructive directions and speeds.
- `season`: seasonal consistency.
- `mechanics`: break type, sandbank, reef, channel, and shelter behavior.
- `ability`: useful skill-level context.
- `hazard`: rocks, rips, shorebreak, pollution, crowd, and access risks.
- `crowd-access`: practical timing and access advice that changes the outing decision.

### 6.3 Rule shape

Schema v1 supports only the structured shapes needed for display-only Local lens evaluation:

- `minimum`: starts working at or above an inclusive threshold.
- `tide-preference`: preferred tide stage, with optional rising/falling direction.
- `direction-preference`: one or more inclusive compass arcs; arcs may wrap through 0°.
- `qualitative`: useful advice that should not be forced into arithmetic.

Multipliers, offsets, and local-height calculations are deliberately excluded from schema v1. Unsupported research remains qualitative until a later calculation design defines it.

### 6.4 Provenance

- `user-observed`: explicit local knowledge from the user.
- `local-guide`: local surf school, surf organization, reserve, or municipality.
- `specialist-guide`: dedicated surf guide or surf forecast spot guide.
- `provider`: Surfline spot metadata or another forecast provider.
- `inference`: synthesis derived from multiple sources or geography.

An inference must cite its inputs and be labeled as inference in both the review cockpit and playbook.

### 6.5 Publication and disagreement

- Publication status: `draft`, `published`, or `rejected`.
- Consensus: `settled` or `unresolved`.
- Optional `conflictGroupId` and `position` preserve published alternatives.
- `calculationCandidate` records editorial interest only; schema v1 requires it to be `false` in generated runtime data and never changes calculations.

Only published records enter the public runtime artifact. Published unresolved alternatives enter the playbook with their evidence, but not decisive compact text. Any material edit to a claim's summary, rule, scope, override key, evidence, or confidence resets it to `draft`, clears `reviewedAt`, and resets `calculationCandidate` to `false`.

## 7. Canonical data model

Create `data/spot-advice.json` as the reviewed, hand-editable source of truth. Generated app artifacts must never overwrite it.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-11",
  "areas": [
    {
      "id": "linha",
      "name": "Linha de Cascais/Oeiras",
      "spotIds": ["surfline-sao-pedro-do-estoril", "surfline-parede"]
    }
  ],
  "spotResearch": [
    {
      "spotId": "surfline-praia-de-caxias",
      "status": "complete",
      "directEvidenceOutcome": "found",
      "checkedSourceUrls": ["https://www.surf-forecast.com/breaks/Caxias"],
      "inheritedApplicabilityApproved": true,
      "reviewedAt": "2026-07-11T00:00:00.000Z"
    }
  ],
  "advice": [
    {
      "id": "user-caxias-minimum-outside-swell",
      "scope": { "type": "spot", "id": "surfline-praia-de-caxias" },
      "topic": "size-translation",
      "overrideKey": "size.minimum-primary-swell",
      "summary": "Usually needs a 2 m primary swell before baby waves appear.",
      "rule": {
        "type": "minimum",
        "input": "primary-swell-height-m",
        "value": 2,
        "comparison": "greater-than-or-equal",
        "effectBelow": "likely-flat"
      },
      "evidence": [
        {
          "kind": "user-observed",
          "label": "User observation",
          "url": null,
          "accessedAt": "2026-07-11",
          "supportedClaim": "Caxias only starts to show baby waves near 2 m outside swell.",
          "quality": "first-hand",
          "status": "accepted"
        }
      ],
      "confidence": "medium",
      "publicationStatus": "published",
      "consensus": "settled",
      "calculationCandidate": false,
      "reviewedAt": "2026-07-11T00:00:00.000Z",
      "revalidateAfter": null
    }
  ]
}
```

### Required fields

- Stable `id`.
- Explicit `scope`.
- One taxonomy `topic`.
- Stable `overrideKey`.
- Short human-readable `summary`.
- Zero or one structured `rule`; qualitative advice may omit it.
- At least one evidence item containing the supported paraphrased claim and evidence review status.
- `confidence`, `publicationStatus`, `consensus`, `calculationCandidate`, and `reviewedAt`.
- Optional `revalidateAfter` for changing sandbank, access, pollution, or hazard claims.

All canonical content is treated as publishable repository content. Private notes do not belong in this file. The public runtime artifact still contains only published claims and accepted evidence; drafts, rejected claims, rejected evidence, and editorial metadata are omitted.

### Confidence

- `high`: corroborated spot-specific guidance or a repeatedly confirmed local observation.
- `medium`: one credible spot-specific source or corroborated area guidance.
- `low`: inherited area advice, a single weak source, or an inference needing field validation.

Confidence is not a source ranking. A user observation can be the best evidence for a favorite spot while still being marked medium until repeated.

### 7.1 Research ledger

Every promotion id has exactly one `spotResearch` entry. Its status is `pending` or `complete`; its direct-evidence outcome is `found` or `no-credible-spot-source-found`. A completed entry records the URLs checked, including sources that were rejected as weak or inapplicable. An inherited claim counts toward coverage only when `inheritedApplicabilityApproved` is true for that spot.

Coverage requires at least one published effective claim in `size-translation`, `tide`, `swell`, `wind`, or `mechanics`. Season, hazard, ability, and access facts alone do not satisfy “good advice” coverage.

### 7.2 Advice subject identity

Runtime lookup uses `adviceSubjectIdFor(camera, spotData)`:

1. A selected Surfline promotion or guide-only subject resolves to its own Surfline id.
2. A MEO camera resolves to `surfMetadata.conditionsSourceSpotId` only when the current enrichment already marks that association trusted and not `needs-review` or `rejected`.
3. Stretch-only and ambiguous one-to-many camera associations do not receive a member spot's spot-scoped advice. They may receive stretch or area advice through their explicit membership in `data/stretches.json`.
4. Nearest-coordinate matching is never used at runtime for advice identity.

The build emits an identity report covering all 44 Surfline ids, all default MEO favorites, and every MEO camera that gains advice. Any camera-to-spot attachment without the same trusted association used for conditions fails the build.

### 7.3 Typed condition inputs

Local lens evaluation receives an explicit snapshot, never a generic “wave height”:

```js
{
  sourceSpotId,
  fetchedAt,
  ageHours,
  providerSpotSurfMinM,
  providerSpotSurfMaxM,
  primarySwellHeightM,
  primarySwellPeriodS,
  primarySwellDirectionDeg,
  windKmh,
  windDirectionDeg,
  tide
}
```

`primarySwell*` comes from Surfline's first swell component, preserving the provider's primary ordering. The user phrase “outside waves” is rendered as **primary swell** in the app. The seeded Sesimbra, Caxias, and Torre thresholds use `primary-swell-height-m`; they never compare against the already-local `surfMinM/surfMaxM` range.

Condition-triggered text requires the same freshness contract as Surfline conditions: non-negative age under `SURFLINE_FRESH_MAX_AGE_HOURS` (currently 36 hours). Missing, future-dated, or stale inputs produce evaluator state `unknown` and suppress the triggered claim. Guide-only subjects without conditions show evergreen wording only.

## 8. Source and synthesis rules

1. Prefer spot-specific local guidance over generic provider prose.
2. Complete the research ledger for each of the 44 spots even when no credible direct source is found.
3. Use at least one direct source for every spot-specific claim.
4. Preserve source title, publisher, URL, access date, supported paraphrase, quality, and evidence review status; store paraphrases, not copied guide text.
5. Define credible evidence as first-hand user knowledge, official/local surf guidance, or a dedicated specialist spot guide whose location clearly matches the selected spot. Generic travel copy and search snippets may lead to sources but cannot support published claims by themselves.
6. When sources disagree, store separate published records under one unresolved `conflictGroupId`; do not average categorical advice.
7. A Local lens evaluator returns `triggered`, `not-triggered`, or `unknown`. Missing or stale inputs are `unknown`, never false.
8. Direction arcs are inclusive and normalized to 0–359.999°; a start greater than its end wraps through north.
9. Use area inheritance only when spot-specific evidence is absent, the spot's research ledger is complete, and applicability is explicitly approved. Label it `Area pattern` in the app.
10. Treat shifting sandbank advice as time-sensitive mechanics with `revalidateAfter`, not a permanent numerical constant.
11. Treat user observations as first-class evidence with their own provenance.
12. Schema v1 is display-only. `calculationCandidate` is editorial metadata and never changes estimates or ratings.

## 9. Seeded user observations

The first dataset must include these user-provided records:

- Sesimbra: baby waves generally begin only when outside waves reach at least 2 m.
- Caxias: baby waves generally begin only when outside waves reach at least 2 m.
- Torre: begins working around 1.5 m outside.
- Caparica stretch: high tide is the user's preferred tide pattern.
- São Julião: mid tide is the preferred window.

These records are published for display because the user supplied them explicitly. All remain calculation-inactive in schema v1.

## 10. Derived runtime model

Add a small build step that validates and compiles the canonical file into a public runtime artifact, `data/spot-advice-resolved.json`.

For each of the 44 spots it contains:

- Direct advice.
- Inherited stretch and area advice.
- Which broader records were overridden.
- A compact topic index.
- Safe accepted evidence with title, publisher, URL, supported claim, and access date.
- Scope, confidence, review date, expiry, and conflict metadata.
- A guide-only subject flag for deferred spots.

The runtime app only consumes published advice and accepted evidence. Draft and rejected content remains available to the local review cockpit. Published unresolved alternatives are compiled for the playbook but marked non-decisive and excluded from compact Local lens selection. Editorial notes, research queries, evidence rejection reasons, and material-edit history are never emitted to runtime.

The build is deterministic and fails on:

- Unknown spot ids or taxonomy values.
- Duplicate advice ids.
- Invalid numeric units or ranges.
- Any calculation-enabled state in schema v1.
- Missing or incomplete research-ledger rows for any of the 44 promotion ids.
- Missing decision-relevant effective advice for any spot.
- Inherited coverage without explicit applicability approval.
- Unknown areas/stretches or multiple membership at the same scope.
- Same-scope `overrideKey` collisions that are not an explicit conflict group.
- Generated output that embeds wall-clock timestamps. The artifact uses a canonical source digest so identical input produces identical bytes.

The build uses this total order only to choose among otherwise eligible compact claims: topic priority, scope rank (`spot > stretch > area`), confidence (`high > medium > low`), `reviewedAt` descending, then stable advice id. It never uses array order. Conflicting alternatives are removed before ranking.

## 11. Editable review cockpit

Generate `.local/spot-advice-review.html` from canonical data and current spot metadata. `.local/` is gitignored and never deployed by GitHub Pages. The cockpit is modeled after the existing Surfline curation tools while keeping draft/rejected editorial state out of the published site.

### Layout

- Filter bar: area, scope, topic, confidence, publication status, consensus, expiry, and “missing spot-specific evidence.”
- Spot list: all 44 spots with research-ledger status, direct-source outcome, applicability signoff, coverage, and unresolved conflicts.
- Editor pane: full create/update/delete, split/merge, re-scope, summary, override key, structured rule fields, confidence, publication, consensus, review date, expiry, and evidence.
- Source pane: clickable links, title/publisher, provenance, access dates, quality/review state, and the exact paraphrased claim supported by each source.
- Inheritance preview: effective advice after spot/stretch/area resolution.
- Live Local lens preview using representative conditions.

### Editing behavior

- Autosave edits to localStorage under the canonical document digest. Show saved time and pending-change count.
- Support importing a prior feedback export, resetting to canonical data, and recovering autosaved edits after reload or an accidental close.
- Export `{ schemaVersion, baseDigest, document }` as a complete feedback JSON file; never partially mutate canonical data in the browser.
- `scripts/apply-spot-advice-feedback.js <feedback.json>` rejects a stale `baseDigest`, validates the full candidate in memory, writes a temporary file in the canonical file's directory, and renames it atomically.
- Material claim edits automatically reset publication and calculation-candidate state as defined in §6.5.
- Rebuilding the cockpit after application must reproduce the accepted values exactly.
- The cockpit warns before page exit only when browser state has not reached localStorage.

This retains the static GitHub Pages architecture and avoids inventing a backend.

## 12. Local lens in the app

### Compact surfaces

Add one line below the surf-size/provenance row on Favorites cards, Monitor tiles, and the selected Explore spot:

- `Local lens · 1.7 m primary swell → probably still flat here`
- `Local lens · High tide suits this stretch`
- `Local lens · Mid tide sweet spot · in 1h 40m`
- `Area pattern · Exposed beach; catches more swell than the Linha`

Only one primary line appears in compact UI. It uses plain language and never implies a numerical local estimate; schema v1 describes thresholds and fit without calculating local wave height.

### Selection priority

Choose the primary Local lens line deterministically:

1. A currently triggered size-translation minimum or avoid rule.
2. A tide rule relevant to the current or next six hours.
3. A currently relevant wind or swell mismatch.
4. A useful spot-specific mechanics note.
5. A stretch or area fallback.

Within the same priority, use the total order in §10. A structured rule evaluates to `triggered`, `not-triggered`, or `unknown`; only triggered rules may make a current-condition assertion. Hazards do not compete for this one-line slot and remain prominent in the playbook.

The Local lens line inside existing compact rows is non-interactive, avoiding nested controls inside current row buttons. Selecting the row opens the existing detail surface. A separate `Local playbook` disclosure control lives in detail, uses `aria-expanded` and `aria-controls`, moves focus into the expanded region when explicitly opened by keyboard, and returns focus to its trigger when closed. Escape closes an overlay implementation; an inline implementation preserves normal document focus. Source links remain ordinary keyboard-focusable links.

### Tide semantics

Tide evaluation uses the existing `data/portugal-tides.json` extremes in `Europe/Lisbon`:

1. A MEO camera uses its own `cameraStations` entry.
2. A promoted or guide-only Surfline subject may use the station of its trusted `linkedCamId`.
3. A stretch record may use the explicitly listed stretch camera selected for that spot in the compiled subject record.
4. If no trusted station or bracketing previous/next extremes exist, tide state is `unknown` and no countdown is shown.

Between a low and next high, the tide is rising; between high and next low, it is falling. The first and last 20% of the interval are the respective extreme stage. The middle 60% is `mid`, with rising/falling retained as direction. A mid-tide target time is the midpoint between bracketing extremes. Countdowns use absolute event times, render in `Europe/Lisbon`, and appear only for fresh tide data within the next six hours. Daylight filtering uses the cache's existing daylight window; an after-dark future window is labeled rather than silently recommended.

### Spot playbook

Opening spot detail and expanding `Local playbook` reveals:

- `Size here`: outside-to-local translation advice.
- `Best window`: tide, swell, wind, and period/energy.
- `How it breaks`: mechanics and variability.
- `Know before you go`: skill, hazards, crowds, and access.
- `Why we say this`: sources, scope, confidence, and disagreements.

The playbook visually distinguishes `Spot advice`, `Stretch pattern`, `Area pattern`, and `Your observation`.

## 13. Estimate and rating integration

Schema v1 surfaces advice without changing the forecast values returned by `resolveConditions()` or any result from `src/surf-rating.js`. The build rejects any state that claims to activate a correction. `calculationCandidate` is a review note only and is omitted from runtime.

A later calculation slice requires a separate approved design covering translation math, calibration evidence, evaluation against observed sessions, rollback, and the distinction between provider spot surf and primary swell. If that slice ships, it must preserve the raw provider value beside a separately labeled local estimate and cite the exact rule id. None of that behavior is implied by this release.

## 14. Error and sparse-data behavior

- Missing advice data: show the existing forecast UI unchanged; log one non-fatal diagnostic.
- Missing current conditions: show evergreen playbook advice but no condition-triggered claim.
- Published unresolved alternatives: show `Guidance differs` in the playbook with both supported claims and omit a decisive compact line for that conflict group.
- Inherited advice: label it as a stretch or area pattern.
- Expired advice: keep it in the playbook with a visible `Needs revalidation` label, but exclude it from compact selection.
- Broken source URL: does not break runtime. A separate non-deterministic audit reports link health; the deterministic build never depends on the network.

## 15. Likely code boundaries

- `data/spot-advice.json`: canonical research and review state.
- `data/spot-advice-resolved.json`: generated runtime artifact.
- `scripts/build-spot-advice.js`: validation, coverage, inheritance, compilation.
- `scripts/build-spot-advice-review-html.js`: generator for gitignored `.local/spot-advice-review.html`.
- `scripts/apply-spot-advice-feedback.js`: validated atomic feedback application.
- `src/spot-advice.js`: subject identity, runtime indexing, tri-state rule evaluation, and Local lens selection.
- `src/spot-data.js`: load resolved advice alongside existing spot data.
- `src/camera-data.js`: merge guide-only Explore subjects for deferred selected spots.
- `src/main.js`: render compact Local lens and the detail playbook disclosure.
- `src/styles/app.css`: compact line, scope chips, playbook, and review-state styling.

The advice selector remains independent from `src/surf-rating.js`. `package.json` and CI gain a deterministic build/freshness command so roster drift or stale generated output fails without relying on a developer remembering to run the script.

## 16. Testing and verification

### Data tests

- All 44 promotion ids have completed research-ledger entries and at least one published decision-relevant effective claim.
- A completed `no-credible-spot-source-found` outcome is preserved and inherited advice requires explicit applicability approval.
- Unknown ids, invalid enums, bad units, duplicates, and invalid memberships fail.
- Spot advice overrides the same stretch/area `overrideKey` while unrelated inherited claims remain.
- Same-scope collisions fail unless modeled as an explicit conflict group.
- Draft and rejected records are excluded; published unresolved alternatives retain public conflict metadata.
- The five seeded user observations round-trip unchanged.
- The identity report proves all 44 Surfline subjects and every advice-bearing MEO camera resolve through trusted mappings only.
- Cave and Praia da Ursa compile into guide-only Explore subjects.

### Review workflow tests

- Generated cockpit contains all 44 spots, research-ledger state, CRUD controls, and source links.
- localStorage autosave survives reload; import and reset recover predictably.
- Edits export deterministically with a canonical `baseDigest`.
- Apply script rejects malformed, partial, or stale feedback without modifying canonical data.
- Material edits reset publication, review date, and calculation candidacy.
- The atomic apply path validates in memory and renames a same-directory temporary file; simulated pre-rename failure leaves the canonical file unchanged.
- Apply followed by rebuild reproduces accepted values.

### Runtime tests

- Local lens selection follows the stated priority.
- Fresh Caxias conditions with `primarySwellHeightM: 1.7` select the likely-flat threshold advice; the same number in `providerSpotSurfMaxM` does not.
- Fresh Torre conditions with `primarySwellHeightM: 1.6` select the begins-working advice.
- Caparica near high tide selects the user tide pattern unless a more specific published spot override applies.
- São Julião selects the mid-tide advice.
- Tide boundary tests cover rising/falling intervals, the 20/60/20 stage split, timezone rendering, after-dark labels, and missing brackets.
- Missing, future-dated, or stale conditions produce `unknown` and fall back to evergreen advice.
- Conflicts suppress decisive claims.
- Existing surf rating and forecast provenance remain unchanged in the display-only release.

### UI verification

- Check mobile and desktop Favorites, Monitor, and Explore layouts.
- Verify the compact line does not make cards materially taller when absent.
- Verify compact lines are non-interactive inside row buttons and create no nested controls.
- Verify the detail playbook control, focus behavior, Escape handling where relevant, focus return, mobile scrolling, and source links are keyboard accessible.
- Verify scope and confidence remain understandable without color alone.
- Verify all 44 subjects can be located and opened in Explore, including the two guide-only subjects.

### Regression verification

- Run the full existing test suite.
- Run the new data build twice and confirm no diff on the second run.
- Run the CI freshness command and confirm canonical/source digest matches committed generated output.
- Run the separate source-link audit and report failures without making the deterministic build network-dependent.
- Run `git diff --check`.

## 17. Rollout sequence

1. Complete and cite the 44-spot research ledger and claims in canonical data.
2. Build validation, inheritance, and runtime artifact generation.
3. Build the editable review cockpit and apply workflow.
4. Review and revise all 44 spot ledgers and their claims in the cockpit.
5. Add read-only Local lens and playbook UI.
6. Verify display behavior and existing forecast/rating regression safety.
7. If desired, begin a separate design for calibrated local-estimate calculations.

## 18. Acceptance criteria

The feature is complete when:

- Exactly the 44 selected spots have completed research-ledger entries and at least one published decision-relevant effective claim.
- Every claim is traceable to accepted evidence and labeled by scope.
- Every inherited claim has an explicit per-spot applicability signoff; generic inheritance alone cannot pass coverage.
- Sparse spots inherit honest area/stretch advice rather than fabricated specificity.
- The user's five initial observations are present and visible.
- All 44 are openable in Explore; Cave and Praia da Ursa are honestly labeled guide-only.
- MEO camera advice attaches only through trusted same-spot identity mappings.
- The gitignored review cockpit supports full editing, autosave recovery, import/reset, digest-safe export, atomic apply, and exact reproduction.
- Compact app surfaces show one relevant Local lens line without clutter.
- The playbook exposes full advice, sources, confidence, and conflicts.
- No advice rule changes estimates or ratings in schema v1.
- Tests cover data integrity, review round-trip, selection behavior, and regressions.
