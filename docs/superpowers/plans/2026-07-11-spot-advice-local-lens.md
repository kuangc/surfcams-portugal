# Spot Advice Local Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research and publish decision-relevant advice for all 44 selected spots, make it safely editable in a local review cockpit, and surface the best current advice through a compact Local lens and detailed playbook without changing forecast or rating calculations.

**Architecture:** `data/spot-advice.json` is the canonical publishable research ledger and claim store. A deterministic compiler validates the 44-spot contract, resolves spot/stretch/area inheritance, and emits a public runtime DTO; a gitignored HTML cockpit edits the canonical document through digest-checked atomic feedback. Runtime helpers bind advice only through trusted Surfline identities, evaluate display-only rules against fresh typed conditions and tide snapshots, and render one non-interactive compact line plus an accessible detail disclosure.

**Tech Stack:** Node.js 20+ ES modules, JSON data files, built-in `node:test`, static HTML/CSS/JavaScript, existing Surfline/tide normalization helpers, no new runtime dependencies.

---

## File map

- Create `data/spot-advice.json`: complete 44-spot research ledger, evidence, areas, and publishable claims.
- Create `data/spot-advice-resolved.json`: deterministic compiled runtime artifact.
- Create `scripts/lib/spot-advice-build.js`: schema validation, digesting, identity validation, inheritance, conflict handling, and compilation.
- Create `scripts/build-spot-advice.js`: file-oriented compiler CLI.
- Create `scripts/build-spot-advice-review-html.js`: local review cockpit generator.
- Create `scripts/apply-spot-advice-feedback.js`: digest-safe atomic feedback application.
- Create `scripts/check-spot-advice-links.js`: manual non-deterministic accepted-source URL audit.
- Create `src/spot-advice.js`: runtime normalization, subject resolution, tri-state rule evaluation, tide phase calculation, Local lens selection, and playbook formatting.
- Modify `src/config.js`: public runtime advice URL.
- Modify `src/spot-data.js`: load and normalize compiled advice.
- Modify `src/forecast-sources.js`: expose typed primary swell fields without changing ratings.
- Modify `src/camera-data.js`: merge guide-only subjects for deferred selected spots.
- Modify `src/main.js`: load guide subjects and render Local lens/playbook.
- Modify `src/styles/app.css`: compact lens, disclosure, scope/confidence/source styling.
- Modify `.gitignore`: ignore `.local/` review output.
- Modify `package.json`: build, freshness, review, and feedback commands.
- Create tests focused by responsibility under `test/spot-advice-*.test.js`.

### Task 1: Canonical 44-spot research dataset

**Files:**
- Create: `data/spot-advice.json`
- Create: `test/spot-advice-data.test.js`
- Read: `data/surfline-promotions.json`
- Read: `data/surfline-spots.json`
- Read: `data/stretches.json`

- [ ] **Step 1: Write the failing roster and evidence tests**

Create `test/spot-advice-data.test.js` with assertions that express the editorial contract before the file exists:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

test("spot advice completes research and decision guidance for all 44 selected spots", () => {
  const promotions = readJson("data/surfline-promotions.json").promoted.map((row) => row.surflineSpotId);
  const advice = readJson("data/spot-advice.json");
  assert.equal(promotions.length, 44);
  assert.deepEqual(advice.spotResearch.map((row) => row.spotId).sort(), [...promotions].sort());
  assert.ok(advice.spotResearch.every((row) => row.status === "complete"));
  assert.ok(advice.spotResearch.every((row) => ["found", "no-credible-spot-source-found"].includes(row.directEvidenceOutcome)));
  assert.ok(advice.spotResearch.every((row) => row.checkedSources.length > 0));
  for (const row of advice.spotResearch) {
    assert.ok(row.checkedSources.every((source) => source.title && source.publisher && source.url));
    assert.ok(row.checkedSources.every((source) => source.locationMatch && source.decision && source.rationale));
    for (const claimId of row.directClaimIds || []) {
      const claim = advice.advice.find((item) => item.id === claimId);
      assert.equal(claim?.scope?.id, row.spotId);
      assert.ok(claim.evidence.some((item) => item.status === "accepted" && (item.kind === "user-observed" || item.locationMatch === "exact-spot")));
    }
    if (row.directEvidenceOutcome === "found") assert.ok((row.directClaimIds || []).length > 0);
  }
});

test("published claims are traceable and the user's five observations are seeded", () => {
  const advice = readJson("data/spot-advice.json");
  const published = advice.advice.filter((row) => row.publicationStatus === "published");
  assert.ok(published.every((row) => row.overrideKey && row.reviewedAt));
  assert.ok(published.every((row) => row.evidence.some((item) => item.status === "accepted" && item.supportedClaim)));
  for (const id of [
    "user-sesimbra-minimum-primary-swell",
    "user-caxias-minimum-primary-swell",
    "user-torre-minimum-primary-swell",
    "user-caparica-high-tide",
    "user-sao-juliao-mid-tide"
  ]) assert.ok(published.some((row) => row.id === id), `missing ${id}`);
});
```

- [ ] **Step 2: Run the tests and verify the missing-file failure**

Run: `node --test test/spot-advice-data.test.js`

Expected: FAIL with `ENOENT: no such file or directory, open 'data/spot-advice.json'`.

- [ ] **Step 3: Create the canonical document structure and the five user claims**

Create `data/spot-advice.json` with:

- `schemaVersion: 1`, `updatedAt: "2026-07-11"`.
- Area membership for Peniche, Ericeira, Sintra, Linha, and South; do not duplicate Caparica/Linha stretch membership from `data/stretches.json`.
- Exactly 44 `spotResearch` rows in promotion order.
- A direct-source outcome and `checkedSources` records for every spot. Each checked source records `title`, `publisher`, `url`, `locationMatch: "exact-spot" | "stretch" | "area" | "mismatch"`, `decision: "accepted" | "rejected"`, and a one-sentence `rationale`.
- At least one published decision-relevant effective claim per spot in `size-translation`, `tide`, `swell`, `wind`, or `mechanics`.
- Spot claims where evidence exists. Each research row lists its own `directClaimIds`. Otherwise add an approval shaped like `inheritedApprovals: [{ "claimId": "caparica-stretch-high-tide", "claimDigest": "c8c3a859f0412f6d30b554c25fe144e9d1f062310a98e9cbdc50c060f1762a82" }]`, using the actual `digestClaim()` output; never use a single blanket boolean.
- The five user claims with these structured rules:

```json
{
  "id": "user-caxias-minimum-primary-swell",
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
  "evidence": [{
    "kind": "user-observed",
    "title": "User observation",
    "publisher": "Local knowledge",
    "url": null,
    "accessedAt": "2026-07-11",
    "supportedClaim": "Caxias only starts to show baby waves near a 2 m outside swell.",
    "quality": "first-hand",
    "status": "accepted"
  }],
  "confidence": "medium",
  "publicationStatus": "published",
  "consensus": "settled",
  "calculationCandidate": false,
  "reviewedAt": "2026-07-11T00:00:00.000Z",
  "revalidateAfter": null
}
```

Use the same shape for Sesimbra at `2`. Torre uses threshold `1.5` plus `effectAtOrAbove: "may-start-working"` so a fresh 1.6 m primary swell can produce positive Local lens text. Caparica uses `tide-preference` stage `high`, and São Julião uses `tide-preference` stage `mid`. Store paraphrases only; do not copy long source prose.

- [ ] **Step 4: Research Nazaré and Peniche (6 spots)**

Research Nazaré, Baleal, Lagide, Cantinho da Baía, Supertubos, and Consolação. For every spot, inspect its Surfline page plus at least one independent dedicated or local source. Record rejected location mismatches. Prefer tide, swell direction, shelter, and mechanics that affect the outing decision.

- [ ] **Step 5: Research Santa Cruz and Ericeira (9 spots)**

Research Santa Cruz, Cave, Ribeira D'Ilhas, Reef, Pedra Branca, Matadouro, Praia do Sul, Foz do Lizandro, and São Julião. Keep distinct tide rules for Cave, Reef/Pedra Branca, and São Julião; do not flatten them into one Ericeira rule.

- [ ] **Step 6: Research Sintra and Guincho (6 spots)**

Research Praia das Maçãs, Praia Pequena, Praia Grande, Adraga, Ursa, and Guincho. Mark access/scenery-only pages as rejected for condition claims. Use inherited Sintra advice only with per-claim digest approval.

- [ ] **Step 7: Research the Linha (8 spots)**

Research Caxias, São Pedro do Estoril, Paço de Arcos, Parede, Praia da Laje, Santo Amaro, Carcavelos, and Torre. Preserve the explicit Caxias/Torre primary-swell thresholds and distinguish sheltered rare breaks from Carcavelos.

- [ ] **Step 8: Research the Caparica stretch (12 spots)**

Research Cova do Vapor through Fonte da Telha. Preserve spot-specific exceptions such as Cova's river-mouth wedge and Praia da Rainha's published mid-tide guidance alongside the user's stretch-wide high-tide observation as an unresolved or clearly scoped alternative where appropriate. Add a per-spot `tideCameraId` when a trusted stretch camera is intended to supply tide data.

- [ ] **Step 9: Research Lagoa de Albufeira, Bicas, and Sesimbra (3 spots)**

Research all three south spots. Preserve Bicas's reef/mid-tide mechanics, Lagoa's exposed beach behavior, and the user-supplied Sesimbra 2 m primary-swell threshold.

- [ ] **Step 10: Run a blind editorial source-quality review**

Give a reviewer the 44 promotion ids and canonical document without the implementation code. Require a per-spot verdict on location match, source credibility, claim support, scope honesty, and whether the advice is decision-relevant. Fix every Critical/Important finding and record rejected sources rather than deleting their audit trail.

- [ ] **Step 11: Run the data tests**

Run: `node --test test/spot-advice-data.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 12: Keep the dataset uncommitted until the real compiler validates it**

Run `git diff --check`. Expected: silent. Task 2 adds compiler validation and commits the dataset only after `npm run check-spot-advice` succeeds.

### Task 2: Deterministic compiler and public runtime artifact

**Files:**
- Create: `scripts/lib/spot-advice-build.js`
- Create: `scripts/build-spot-advice.js`
- Create: `data/spot-advice-resolved.json`
- Create: `test/spot-advice-build.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing compiler tests**

Create `test/spot-advice-build.test.js` covering validation, inheritance, conflicts, public-field filtering, guide-only subjects, and deterministic digest:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { compileSpotAdvice, validateSpotAdvice } from "../scripts/lib/spot-advice-build.js";

test("spot scope overrides the same key while unrelated inherited claims remain", () => {
  const compiled = compileSpotAdvice(fixtureDocument(), fixtureContext());
  const subject = compiled.subjects["surfline-sao-juliao"];
  assert.equal(subject.claims.find((row) => row.overrideKey === "tide.preferred-stage").scope.type, "spot");
  assert.ok(subject.claims.some((row) => row.overrideKey === "wind.preferred-direction"));
});

test("unresolved alternatives reach playbook but not decisive claims", () => {
  const compiled = compileSpotAdvice(conflictDocument(), fixtureContext());
  const subject = compiled.subjects["surfline-praia-da-rainha"];
  assert.equal(subject.conflicts.length, 1);
  assert.ok(subject.decisiveClaims.every((row) => row.conflictGroupId == null));
});

test("schema v1 rejects incomplete research and calculation activation", () => {
  assert.throws(() => validateSpotAdvice(incompleteResearchDocument(), fixtureContext()), /research/i);
  assert.throws(() => validateSpotAdvice(calculationEnabledDocument(), fixtureContext()), /calculation/i);
});

test("identity report covers selected subjects and rejects untrusted MEO attachment", () => {
  const compiled = compileSpotAdvice(fixtureDocument(), fixtureContext());
  assert.equal(compiled.identityReport.selectedSurflineIds.length, 44);
  assert.ok(compiled.identityReport.defaultFavoriteIds.every((id) => compiled.identityReport.byCameraId[id]));
  assert.throws(() => compileSpotAdvice(fixtureDocument(), mismatchedEnrichmentContext()), /identity/i);
});

test("changed inherited claim digest invalidates per-spot approval", () => {
  assert.throws(() => compileSpotAdvice(staleInheritedApprovalDocument(), fixtureContext()), /approval digest/i);
});
```

Fixtures must contain complete concrete objects in the test file, including the referenced spots, stretch/area memberships, and evidence.

- [ ] **Step 2: Verify the compiler tests fail**

Run: `node --test test/spot-advice-build.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/spot-advice-build.js`.

- [ ] **Step 3: Implement pure validation and compilation**

In `scripts/lib/spot-advice-build.js`, implement canonical serialization and digesting exactly as follows, then export `validateSpotAdvice(document, context)` and `compileSpotAdvice(document, context)` with the validation/compilation behavior listed below:

```js
import { createHash } from "node:crypto";

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])])
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function digestDocument(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function digestClaim(claim) {
  return digestDocument(claim);
}
```

Implementation requirements:

- Validate exact promotion/research identity, enums, evidence fields, unique ids, one area and one stretch maximum, structured rule discriminants, calculation-inactive state, direct/inherited applicability by claim id and digest, and published decision coverage.
- Resolve `spot > stretch > area` by `overrideKey`.
- Treat same-precedence duplicates as errors unless they form one unresolved conflict group.
- Emit published claims and accepted evidence only; omit checked research URLs, rejected evidence, drafts, rejected claims, and `calculationCandidate`.
- Mark Cave and Praia da Ursa `guideOnly: true` using `promotedDb.deferred`.
- Build MEO identity only from enrichment rows whose `reviewStatus` is neither `needs-review` nor `rejected` and whose `conditionsSourceSpotId` is present. Prove all 44 selected Surfline ids, all ids in `src/config.js` `DEFAULT_FAVORITE_IDS`, every advice-bearing MEO camera, and negative mismatches in the identity report tests.
- Do not include wall-clock timestamps.

- [ ] **Step 4: Implement the file CLI and npm commands**

Create `scripts/build-spot-advice.js` to read these exact inputs and context keys:

- `data/spot-advice.json` as `document`.
- `data/surfline-promotions.json` as `promotions` and selected roster.
- `data/surfline-spots.json` as `surflineSpots` and guide metadata.
- `data/stretches.json` as `stretches` and sole stretch membership.
- `data/promoted-spots.json` as `promotedDb` for linked cams/deferred guide subjects.
- `data/spot-metadata-enrichment.json` as `enrichmentDb` for trusted MEO identity.

Import `DEFAULT_FAVORITE_IDS` from `src/config.js` into context. Call `compileSpotAdvice` and write `data/spot-advice-resolved.json` only when bytes differ. Support `--check`, which compares expected bytes and exits nonzero without writing.

Add to `package.json`:

```json
"build-spot-advice": "node scripts/build-spot-advice.js",
"check-spot-advice": "node scripts/build-spot-advice.js --check"
```

- [ ] **Step 5: Run focused tests and build twice**

Run:

```bash
node --test test/spot-advice-data.test.js test/spot-advice-build.test.js
npm run build-spot-advice
cp data/spot-advice-resolved.json /tmp/spot-advice-resolved.json
npm run build-spot-advice
cmp -s data/spot-advice-resolved.json /tmp/spot-advice-resolved.json
npm run check-spot-advice
```

Expected: all tests PASS; `cmp` exits 0; freshness check exits 0.

- [ ] **Step 6: Commit compiler and artifact**

```bash
git add data/spot-advice.json test/spot-advice-data.test.js scripts/lib/spot-advice-build.js scripts/build-spot-advice.js data/spot-advice-resolved.json test/spot-advice-build.test.js package.json
git commit -m "feat: compile reviewed advice for 44 surf spots"
```

### Task 3: Recoverable local review cockpit and atomic feedback

**Files:**
- Modify: `.gitignore`
- Create: `scripts/lib/spot-advice-review.js`
- Create: `scripts/build-spot-advice-review-html.js`
- Create: `scripts/apply-spot-advice-feedback.js`
- Create: `test/spot-advice-review.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing review workflow tests**

Create `test/spot-advice-review.test.js` that imports pure exports from both scripts and asserts:

```js
test("review html contains all 44 spots and recovery controls", () => {
  const html = renderSpotAdviceReview({ document, spots, sourceDigest });
  assert.equal((html.match(/data-spot-id=/g) || []).length, 44);
  for (const id of ["feedback-import", "feedback-export", "review-reset", "autosave-status"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /localStorage/);
});

test("material edits reset publication before apply", () => {
  const candidate = prepareFeedbackCandidate(original, editedPublishedClaim());
  assert.equal(candidate.advice[0].publicationStatus, "draft");
  assert.equal(candidate.advice[0].reviewedAt, null);
  assert.equal(candidate.advice[0].calculationCandidate, false);
});

test("stale digest is rejected before writing", async () => {
  await assert.rejects(() => applyFeedback({ baseDigest: "stale", document }, paths), /stale/i);
  assert.deepEqual(readCanonical(paths), original);
});
```

Add table-driven cases for create, delete, split, merge, re-scope, summary/rule/override/evidence/confidence/conflict edits, nonmaterial UI edits, localStorage serialization/recovery, import/reset, stale digest, a digest change immediately before rename, and temporary-write failure cleanup. New and materially edited claims must be draft; canonical bytes must be unchanged on every failed apply.

- [ ] **Step 2: Verify review tests fail**

Run: `node --test test/spot-advice-review.test.js`

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the gitignored review generator**

Add `.local/` to `.gitignore`. Put pure editor transitions, material-change comparison, autosave serialization, import/reset, and export construction in `scripts/lib/spot-advice-review.js` so Node tests exercise behavior rather than strings. Export `renderSpotAdviceReview()` from `scripts/build-spot-advice-review-html.js`; its generated page must provide filters, 44-spot ledger navigation, full claim/evidence CRUD, split/merge, re-scope, conflict fields, inheritance preview, Local lens fixture preview, import/export/reset, pending count, exit warning, and digest-keyed localStorage autosave.

Escape all source-derived HTML. Accept only `http:` and `https:` source URLs, and emit `target="_blank" rel="noopener noreferrer"` for external links. Add malicious title/summary and `javascript:` URL cases to the review tests.

The browser export shape is exactly:

```js
{ schemaVersion: 1, baseDigest: SOURCE_DIGEST, document: workingDocument }
```

The generator writes `.local/spot-advice-review.html` and creates `.local/` when absent.

- [ ] **Step 4: Implement digest-safe atomic feedback**

Export `prepareFeedbackCandidate()` and `applyFeedback()` from `scripts/apply-spot-advice-feedback.js`. Compare `baseDigest` to the current canonical digest, reset materially changed published claims, validate the complete candidate through `validateSpotAdvice`, write a temporary file beside `data/spot-advice.json`, fsync/close it, re-read and re-digest the canonical file immediately before rename, reject if that digest changed, and rename the temporary file over the canonical file. Remove the temporary file on failure.

- [ ] **Step 5: Add npm commands and verify round trip**

Add:

```json
"build-spot-advice-review": "node scripts/build-spot-advice-review-html.js",
"apply-spot-advice-feedback": "node scripts/apply-spot-advice-feedback.js"
```

Run:

```bash
node --test test/spot-advice-review.test.js
npm run build-spot-advice-review
test -s .local/spot-advice-review.html
git check-ignore .local/spot-advice-review.html
```

Expected: tests PASS; HTML exists and is ignored.

- [ ] **Step 6: Exercise the rendered cockpit in a browser**

Serve the repository locally and open `.local/spot-advice-review.html`. Verify filters, spot navigation, claim/evidence create-update-delete, split/merge, re-scope, inheritance preview, Local lens preview, autosave reload recovery, import/reset, pending count, exit warning, and safe source links. Export a fixture change, apply it to a temporary canonical copy, rebuild, and compare the accepted claim bytes exactly. Capture failures as test cases before proceeding.

- [ ] **Step 7: Commit review workflow**

```bash
git add .gitignore scripts/lib/spot-advice-review.js scripts/build-spot-advice-review-html.js scripts/apply-spot-advice-feedback.js test/spot-advice-review.test.js package.json
git commit -m "feat: add local spot advice review cockpit"
```

### Task 4: Review and sign off all 44 records through the cockpit

**Files:**
- Modify: `data/spot-advice.json`
- Modify: `data/spot-advice-resolved.json`

- [ ] **Step 1: Generate the current cockpit and start the app server**

Run:

```bash
npm run build-spot-advice-review
npm run dev
```

Expected: `.local/spot-advice-review.html` loads from the local server with source digest matching `data/spot-advice.json`.

- [ ] **Step 2: Inspect every spot in six geographic batches**

Use the cockpit's pending/editorial filters and inspect all 44 spots in the same six batches as Task 1. For each spot verify the checked-source audit, exact location match, accepted evidence support, decision relevance, scope, override behavior, tide camera identity, expiry, confidence, and compact/playbook preview. Correct weak or misleading claims; preserve rejected sources with rationale. Update the row's `reviewedAt` only after its effective advice is satisfactory.

- [ ] **Step 3: Export, apply, and rebuild the real canonical document**

Export the full feedback JSON from the cockpit, then run:

```bash
npm run apply-spot-advice-feedback -- .local/spot-advice-feedback.json
npm run build-spot-advice
npm run check-spot-advice
```

Expected: digest-safe apply succeeds once, runtime artifact rebuilds, and freshness check exits 0.

- [ ] **Step 4: Verify exact readback and complete coverage**

Regenerate the cockpit and confirm the accepted claim text, source links, review dates, conflicts, and inheritance approvals match the export exactly. Run the data/compiler tests and use the cockpit filters to prove zero pending spots, zero missing decision coverage, zero stale inherited approvals, and no unresolved accidental collisions.

- [ ] **Step 5: Run a second blind editorial review**

Give an independent reviewer only the final canonical document, promotion roster, and source links. Require findings by severity for source credibility, claim support, location match, scope, and usefulness. Fix verified Critical/Important findings through another cockpit export/apply/rebuild cycle.

- [ ] **Step 6: Commit the cockpit-reviewed dataset**

```bash
git add data/spot-advice.json data/spot-advice-resolved.json
git commit -m "data: review local advice across 44 surf spots"
```

### Task 5: Runtime advice, identity, typed conditions, and tide evaluation

**Files:**
- Create: `src/spot-advice.js`
- Create: `test/spot-advice-runtime.test.js`
- Modify: `src/config.js`
- Modify: `src/spot-data.js`
- Modify: `src/forecast-sources.js`
- Modify: `test/forecast-sources.test.js`
- Modify: `test/spot-data.test.js`

- [ ] **Step 1: Write failing runtime tests**

Cover trusted identity, display-only typed inputs, freshness, minimum thresholds, direction arcs, tide 20/60/20 phase, conflict suppression, and deterministic priority:

```js
test("minimum uses fresh primary swell height, not provider spot surf max", () => {
  const claim = minimumClaim(2);
  assert.equal(evaluateAdviceRule(claim, freshSnapshot({ primarySwellHeightM: 1.7, providerSpotSurfMaxM: 3 })), "triggered");
  assert.equal(evaluateAdviceRule(claim, staleSnapshot({ primarySwellHeightM: 1.7 })), "unknown");
});

test("subject identity accepts promoted self and trusted conditions source only", () => {
  assert.equal(adviceSubjectIdFor({ id: "surfline-sao-juliao", promoted: true }, spotData), "surfline-sao-juliao");
  assert.equal(adviceSubjectIdFor({ id: "sao-juliao" }, trustedSpotData), "surfline-sao-juliao");
  assert.equal(adviceSubjectIdFor({ id: "ambiguous-stretch-cam" }, ambiguousSpotData), null);
});

test("tide phase uses the middle sixty percent and keeps direction", () => {
  assert.deepEqual(tidePhase(between(lowAt(0), highAt(10), 5)), { stage: "mid", direction: "rising", progress: 0.5 });
});

test("trusted tide camera resolves direct, linked, and explicit stretch identities", () => {
  assert.equal(resolveAdviceTideCameraId(meoCamera, meoSubject, spotData), meoCamera.id);
  assert.equal(resolveAdviceTideCameraId(promotedCamera, linkedSubject, spotData), linkedSubject.tideCameraId);
  assert.equal(resolveAdviceTideCameraId(stretchCamera, stretchSubject, spotData), stretchSubject.tideCameraId);
  assert.equal(resolveAdviceTideCameraId(guideOnlyCamera, guideSubjectWithoutStation, spotData), null);
});
```

Add tests for missing brackets, tide cache older than 48 hours, the six-hour cutoff, midpoint target, `Europe/Lisbon` winter/summer DST formatting, after-dark labeling, wraparound direction arcs, `windDirDeg` → `windDirectionDeg` mapping, and unresolved conflict suppression.

- [ ] **Step 2: Verify runtime tests fail**

Run: `node --test test/spot-advice-runtime.test.js test/forecast-sources.test.js test/spot-data.test.js`

Expected: FAIL because runtime exports and advice loading do not exist.

- [ ] **Step 3: Implement runtime normalization and selection**

In `src/spot-advice.js`, export `normalizeSpotAdviceRuntime(payload = {})`, `adviceSubjectIdFor(camera, spotData)`, `resolveAdviceTideCameraId(camera, subject, spotData)`, `findAdviceTideSnapshot(camera, spotData, tideData, now = new Date())`, `adviceConditionSnapshot(resolved)`, `tidePhase(events, now = new Date())`, `evaluateAdviceRule(claim, snapshot, now = Date.now())`, `selectLocalLens(camera, spotData, snapshot, tideSnapshot, now = Date.now())`, and `formatSpotPlaybook(camera, spotData)`. Return normalized maps, trusted subject ids, trusted direct/linked/explicit-stretch tide camera ids, resolved fresh tide snapshots, a condition snapshot whose public field is `windDirectionDeg` mapped from legacy `windDirDeg`, tide-stage records, tri-state strings, compact lens objects, and grouped playbook sections respectively; do not expose mutable source objects.

Minimum semantics: return `triggered` below the inclusive working threshold when `effectBelow` is present; return `triggered` at or above it when `effectAtOrAbove` is present; otherwise return `not-triggered`. Include the selected effect in the lens result so Caxias below threshold renders `likely flat` and Torre above threshold renders `may start working`. Tide and direction rules return `triggered` when current values match their preference. Expired claims and unresolved conflicts are never decisive.

Tide selection calls `findTideSnapshot({ id: trustedTideCameraId }, tideData, now)` only after `resolveAdviceTideCameraId` succeeds. Treat the tide cache as stale when `generatedAt` is more than 48 hours old, suppress target countdowns beyond six hours, format absolute targets in `Europe/Lisbon`, and use existing daylight events to label after-dark targets.

- [ ] **Step 4: Expose typed Surfline conditions without changing rating fields**

Modify `resolveConditions()` so fresh Surfline results additionally contain:

```js
sourceSpotId: surflineId,
providerSpotSurfMinM: entry.surfMinM ?? null,
providerSpotSurfMaxM: entry.surfMaxM ?? null,
primarySwellHeightM: primarySwell.hM ?? null,
primarySwellPeriodS: primarySwell.periodS ?? null,
primarySwellDirectionDeg: primarySwell.dirDeg ?? null
```

Keep `waveMinM`, `waveMaxM`, `periodS`, `swellDirDeg`, and all rating behavior unchanged.

Add a regression test that runs representative Surfline-fresh, live-model, and MEO-static fixtures through `resolveConditions`, `formatConditionLine`, `formatConditionChips`, monitor sorting, and `rateSurfSpot` with empty advice and populated advice. Deep-equal every legacy forecast/rating field and ordering result; advice may add only separate Local lens/playbook output.

- [ ] **Step 5: Load runtime advice through spot data**

Add `SPOT_ADVICE_URL = "./data/spot-advice-resolved.json"` to `src/config.js`. Extend `emptySpotData()`, `normalizeSpotData()`, and `loadSpotData()` to include normalized advice maps and identity report. A failed advice fetch must degrade to empty advice while other spot data remains usable.

- [ ] **Step 6: Run focused runtime tests**

Run: `node --test test/spot-advice-runtime.test.js test/forecast-sources.test.js test/spot-data.test.js`

Expected: PASS.

- [ ] **Step 7: Commit runtime foundation**

```bash
git add src/spot-advice.js src/config.js src/spot-data.js src/forecast-sources.js test/spot-advice-runtime.test.js test/forecast-sources.test.js test/spot-data.test.js
git commit -m "feat: resolve local surf advice at runtime"
```

### Task 6: Guide-only subjects for all 44 Explore spots

**Files:**
- Modify: `src/camera-data.js`
- Modify: `src/main.js`
- Create: `test/spot-advice-subjects.test.js`
- Modify: `test/camera-data.test.js`

- [ ] **Step 1: Write failing guide-subject tests**

```js
test("mergeAdviceGuideSubjects adds deferred selected spots without inventing cameras", () => {
  const merged = mergeAdviceGuideSubjects({ cameras: [] }, runtimeAdvice);
  assert.deepEqual(merged.cameras.map((row) => row.id).sort(), ["surfline-cave", "surfline-praia-da-ursa"]);
  assert.ok(merged.cameras.every((row) => row.adviceGuideOnly && row.streamUrl == null));
});

test("all 44 selected advice subjects are inspectable after app merges", () => {
  const ids = inspectableAdviceSubjectIds(mergedDb, runtimeAdvice);
  assert.equal(ids.size, 44);
});

test("deferred guides survive real Explore search and detail selection", () => {
  const cave = filterCameras(mergedDb.cameras, { search: "Cave", region: "", favoritesOnly: false }, new Set());
  assert.equal(cave[0].id, "surfline-cave");
  assert.equal(cave[0].adviceGuideOnly, true);
  assert.equal(cave[0].streamUrl, undefined);
  assert.ok(formatSpotPlaybook(cave[0], spotData).sections.length > 0);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/spot-advice-subjects.test.js test/camera-data.test.js test/camera-filters.test.js`

Expected: FAIL because `mergeAdviceGuideSubjects` is not exported.

- [ ] **Step 3: Implement guide-only merge**

Add `mergeAdviceGuideSubjects(cameraDb, adviceRuntime)` to `src/camera-data.js`. Append only runtime subjects with `guideOnly: true`, shaping them as report-only camera records with id, name, region, lat/lon, `surfline.pageUrl`, `adviceGuideOnly: true`, and no stream/forecast. Never override a real or promoted record.

Update app initialization order:

```js
state.db = mergeAdviceGuideSubjects(
  mergePromotedSpots(applySpotMetadataToCameraDb(cameraDb, spotData), spotData.promotedDb),
  spotData.adviceRuntime
);
```

- [ ] **Step 4: Run subject and camera tests**

Run: `node --test test/spot-advice-subjects.test.js test/camera-data.test.js test/camera-filters.test.js test/index.test.js`

Expected: PASS; existing first-class camera behavior remains intact.

- [ ] **Step 5: Commit guide subjects**

```bash
git add src/camera-data.js src/main.js test/spot-advice-subjects.test.js test/camera-data.test.js
git commit -m "feat: expose guide-only selected surf spots"
```

### Task 7: Local lens and accessible spot playbook UI

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Create: `test/spot-advice-ui.test.js`
- Modify: `test/index.test.js`

- [ ] **Step 1: Write failing UI wiring tests**

Use source-level structure tests consistent with the repository's existing UI tests:

```js
test("compact Local lens is rendered as non-interactive text", () => {
  const source = fs.readFileSync("src/main.js", "utf8");
  assert.match(source, /className = "local-lens"/);
  assert.doesNotMatch(source, /local-lens[^\n]*addEventListener/);
});

test("detail playbook uses an explicit accessible disclosure", () => {
  const source = fs.readFileSync("src/main.js", "utf8");
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
  assert.match(source, /Local playbook/);
});
```

Also test source links use safe anchors, scope labels are text, expired claims say `Needs revalidation`, unresolved groups say `Guidance differs`, and no code calls `rateSurfSpot` with advice-adjusted values. Treat these source checks as fast guards; Step 6 supplies executable browser behavior coverage.

- [ ] **Step 2: Verify UI tests fail**

Run: `node --test test/spot-advice-ui.test.js test/index.test.js`

Expected: FAIL on missing Local lens/playbook wiring.

- [ ] **Step 3: Add compact lens rendering to Favorites, Monitor, and selected Explore detail**

Create focused helpers in `src/main.js`:

```js
function renderLocalLens(container, camera) {
  const resolved = resolveCameraConditions(camera);
  const tide = findAdviceTideSnapshot(camera, state.spotData, state.tideData, new Date());
  const lens = selectLocalLens(camera, state.spotData, resolved, tide, Date.now());
  if (!lens) return;
  const line = document.createElement("p");
  line.className = "local-lens";
  line.textContent = `${lens.scopeLabel} · ${lens.text}`;
  container.append(line);
}
```

Call it after the condition/provenance line in monitor/favorite cards and inside selected Explore detail. Keep list-row Local lens text non-interactive.

- [ ] **Step 4: Add detail playbook disclosure**

Render one button and controlled region in selected spot detail. Group claims under `Size here`, `Best window`, `How it breaks`, `Know before you go`, and `Why we say this`. Include scope/confidence/expiry text, accepted source links, and published alternatives. Toggle `hidden` and `aria-expanded`; Escape closes and returns focus when the disclosure uses an overlay on narrow screens.

- [ ] **Step 5: Add responsive and accessible styles**

Add `.local-lens`, `.spot-playbook-toggle`, `.spot-playbook`, `.advice-scope`, `.advice-confidence`, `.advice-source-list`, `.advice-conflict`, and `.advice-expired` styles. Preserve card density, use text/icons in addition to color, and provide visible `:focus-visible` states. On mobile, constrain playbook height and allow internal scrolling without moving the map behind it.

- [ ] **Step 6: Execute browser behavior checks against the running app**

Start `npm run dev` and use the browser to assert actual DOM/interaction behavior:

- Each Favorites card, Monitor tile, and selected Explore detail has at most one `[data-role="local-lens"]`.
- Every compact lens element is a `p`/`div` containing no `button`, `a`, or element with `tabindex`.
- The detail `Local playbook` control owns a unique region id, toggles `aria-expanded` and `hidden`, returns focus when closed, and closes on Escape in overlay layout.
- Source links reject unsafe schemes and open with `noopener noreferrer`.
- Searching `Cave` and `Praia da Ursa` finds guide-only subjects; selecting each shows evergreen playbook content and no camera/live-condition claim.
- Desktop and mobile widths show no map-blocking overflow or nested interactive controls.

Convert any failure that can be expressed deterministically into `test/spot-advice-ui.test.js` before proceeding.

- [ ] **Step 7: Run focused UI and runtime tests**

Run:

```bash
node --test test/spot-advice-ui.test.js test/spot-advice-runtime.test.js test/index.test.js test/condition-summary.test.js test/monitor-cameras.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit UI**

```bash
git add src/main.js src/styles/app.css test/spot-advice-ui.test.js test/index.test.js
git commit -m "feat: surface local surf advice in the app"
```

### Task 8: Full verification, rendered review, and documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Create: `.github/workflows/validate.yml`
- Modify: `.github/workflows/update-surfline-conditions.yml`
- Create: `scripts/check-spot-advice-links.js`
- Create: `test/spot-advice-links.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Add failing build-path assertions**

Extend `test/source-safety.test.js` to require `build-spot-advice`, `check-spot-advice`, `build-spot-advice-review`, `apply-spot-advice-feedback`, and `check-spot-advice-links` scripts and to verify `.local/` is ignored. Create `test/spot-advice-links.test.js` with a fake fetcher proving the link collector deduplicates accepted HTTP(S) evidence, ignores null user-observation URLs, retries GET after a rejected HEAD, and reports per-URL failures.

- [ ] **Step 2: Run the source-safety test and verify failure**

Run: `node --test test/source-safety.test.js`

Expected: FAIL because the manual link-audit script and npm command do not exist.

- [ ] **Step 3: Document the operator workflow**

Update README with the Local lens/playbook behavior and guide-only spot meaning. Update CLAUDE.md with exact research/review commands:

```bash
npm run build-spot-advice
npm run check-spot-advice
npm run build-spot-advice-review
npm run apply-spot-advice-feedback -- .local/spot-advice-feedback.json
```

Document that schema v1 never changes estimates/ratings and that `.local/spot-advice-review.html` is local-only.

- [ ] **Step 4: Implement the manual source-link audit**

Create `scripts/check-spot-advice-links.js` with exported `collectAcceptedUrls(document)` and `auditUrls(urls, { fetcher, concurrency: 4 })`. Use HEAD first, fall back to GET for 403/405 or unsupported HEAD responses, enforce a 10-second AbortController timeout per request, print one status line per unique URL, and set a nonzero exit code when any URL is unreachable. Add:

```json
"check-spot-advice-links": "node scripts/check-spot-advice-links.js"
```

Run: `node --test test/spot-advice-links.test.js`

Expected: PASS without network access because tests use a fake fetcher.

- [ ] **Step 5: Wire deterministic freshness into CI**

Create `.github/workflows/validate.yml` for `pull_request` and pushes to `main`, with checkout, Node 22 setup, `npm test`, and `npm run check-spot-advice`. Also add a defense-in-depth `Validate committed spot advice` step immediately after Node setup in `.github/workflows/update-surfline-conditions.yml`. Do not add external URL checks to deterministic CI.

- [ ] **Step 6: Run complete automated verification**

Run:

```bash
npm run build-spot-advice
npm run check-spot-advice
npm run build-spot-advice-review
npm test
git diff --check
```

Expected: all tests PASS, freshness check exits 0, review HTML exists under ignored `.local/`, and diff check is silent. Run `npm run check-spot-advice-links` separately; report any remote failures but do not make them part of deterministic CI.

- [ ] **Step 7: Run the app and inspect mobile/desktop behavior**

Run `npm run dev`, open the local app, and inspect Favorites, Monitor, Explore, Cave, Praia da Ursa, Caxias, Torre, Caparica, and São Julião at desktop and mobile widths. Verify:

- Exactly one compact lens line appears when eligible.
- No nested interactive controls appear in compact rows.
- The playbook opens/closes with keyboard and pointer, returns focus, and scrolls on mobile.
- Scope/confidence/expiry/conflict information is understandable without color.
- All 44 selected subjects can be found and opened.
- Forecast numbers, provenance, and ratings match the pre-feature behavior.

- [ ] **Step 8: Commit docs and CI verification**

```bash
git add README.md CLAUDE.md .github/workflows/validate.yml .github/workflows/update-surfline-conditions.yml scripts/check-spot-advice-links.js test/spot-advice-links.test.js test/source-safety.test.js package.json
git commit -m "docs: document spot advice review workflow"
```

- [ ] **Step 9: Final branch audit**

Run:

```bash
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: clean worktree on `codex/spot-advice-local-lens`, with the design, ignore safety commit, plan, and seven focused implementation commits ahead of `origin/main`.
