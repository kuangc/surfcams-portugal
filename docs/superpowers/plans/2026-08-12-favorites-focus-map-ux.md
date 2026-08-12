# Favorites, Focus, and Map Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manage an unlimited set of playable favorites in place, deliberately watch one or two feeds without a timeout, and move between map-primary and spot-primary Explore layouts without losing context.

**Architecture:** Keep `src/main.js` as the DOM coordinator, but extract four directly tested policy seams: the playable favorite catalog, monitor view transitions, gallery playback lifetime, and Explore emphasis. The ordinary gallery owns visibility-scoped 60-second preview sessions; Focus, Compare, and Explore own untimed players that are cleared by route/document lifecycle. The existing Leaflet instance and existing visual tokens remain authoritative.

**Tech Stack:** Static HTML, modern browser JavaScript modules, CSS Grid, Leaflet 1.9.4, native `<dialog>`, Fullscreen API, IntersectionObserver, hls.js 1.6.4, Node 20 built-in test runner.

---

## Task 1: Remove the collection cap and add the playable favorite domain helpers

**Files:**

- Create: `src/favorite-catalog.js`
- Create: `test/favorite-catalog.test.js`
- Modify: `src/monitor-cameras.js`
- Modify: `src/config.js`
- Modify: `test/monitor-cameras.test.js`
- Modify: `test/forecast-sources.test.js`

- [ ] **Step 1: Write the failing unlimited-Monitor tests**

Replace the slot/padding expectations with tests for a camera collection:

```js
import { monitorFavoriteCameras } from "../src/monitor-cameras.js";

test("monitorFavoriteCameras returns every playable favorite without padding or truncation", () => {
  const cameras = Array.from({ length: 10 }, (_, index) => ({
    id: `cam-${index}`,
    hasStream: true,
    streamUrl: `https://example.test/${index}.m3u8`
  }));
  const ids = cameras.map(({ id }) => id);

  assert.deepEqual(
    monitorFavoriteCameras(cameras, new Set(ids), ids).map(({ id }) => id),
    ids
  );
});
```

Keep coverage for derived distance order and for excluding `adviceGuideOnly`, missing-stream, and missing-URL rows.

- [ ] **Step 2: Run the Monitor domain tests and verify RED**

Run:

```bash
node --test test/monitor-cameras.test.js test/forecast-sources.test.js
```

Expected: failure because `monitorFavoriteCameras` does not exist and the old helper still pads/caps.

- [ ] **Step 3: Implement the uncapped collection helper**

In `src/monitor-cameras.js`, remove the `MONITOR_CAMERA_LIMIT` import and replace `monitorCameraSlots` with:

```js
export function monitorFavoriteCameras(
  cameras,
  favoriteIds,
  favoriteOrder,
  { getDriveDistanceKm = null } = {}
) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  return sortByDistance(
    favoriteOrder
      .filter((id) => favoriteIds.has(id))
      .map((id) => byId.get(id))
      .filter((camera) => camera?.hasStream && camera.streamUrl && !camera.adviceGuideOnly),
    getDriveDistanceKm
  );
}
```

Remove `MONITOR_CAMERA_LIMIT` from `src/config.js` and update all imports/call sites/tests.

- [ ] **Step 4: Run the Monitor domain tests and verify GREEN**

Run the command from Step 2. Expected: all targeted tests pass.

- [ ] **Step 5: Write the failing playable-catalog tests**

Create `test/favorite-catalog.test.js` for these behaviors:

- only rows with `hasStream`, an HTTPS `streamUrl`, and no `adviceGuideOnly` flag are returned;
- `Sao Juliao` matches `São Julião`;
- name, location, and region are searchable case-insensitively;
- optional region and provider filters compose with the query;
- already-saved rows are returned with `saved: true` and cannot be duplicated by `addFavorite`;
- exact-name matches sort before partial matches, then by base-sensitive name.

Use the wished-for API:

```js
import {
  addFavorite,
  playableFavoriteCatalog,
  searchFavoriteCatalog
} from "../src/favorite-catalog.js";
```

- [ ] **Step 6: Run the catalog test and verify RED**

Run:

```bash
node --test test/favorite-catalog.test.js
```

Expected: module-not-found failure for the intentionally absent catalog module.

- [ ] **Step 7: Implement the smallest catalog API**

Implement accent folding with Unicode normalization and diacritic removal. Preserve input order when no query exists; otherwise sort exact name matches first. Return `{ camera, saved }` records so listbox options can remain text-only. Make `addFavorite` return a new `Set` and leave an existing set unchanged when the ID is already present or absent from the playable catalog.

- [ ] **Step 8: Run the catalog tests and verify GREEN**

Run:

```bash
node --test test/favorite-catalog.test.js test/monitor-cameras.test.js test/forecast-sources.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 9: Commit the domain foundation**

```bash
git add src/favorite-catalog.js src/monitor-cameras.js src/config.js test/favorite-catalog.test.js test/monitor-cameras.test.js test/forecast-sources.test.js
git commit -m "feat: remove favorite collection limit"
```

## Task 2: Rebuild Favorites around saved cameras, add-by-name, remove, and undo

**Files:**

- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/favorites.js`
- Modify: `src/styles/app.css`
- Modify: `test/favorites.test.js`
- Modify: `test/index.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Write failing mutation and undo-window tests**

Extend `test/favorites.test.js` around a pure controller exported from `src/favorites.js`:

```js
const undo = createFavoriteUndo({
  durationMs: 10_000,
  setTimer,
  clearTimer
});
```

Cover offering one removed ID, consuming it once, expiry at exactly 10 seconds, and cancellation by the next favorite mutation. Add a transactional persistence test showing a throwing storage adapter does not require mutating the current `Set`.

- [ ] **Step 2: Run the Favorites unit test and verify RED**

Run:

```bash
node --test test/favorites.test.js
```

Expected: failure because `createFavoriteUndo` and immutable mutation helpers are missing.

- [ ] **Step 3: Implement immutable mutation and undo helpers**

Keep `saveFavoriteIds` throwing on storage failure. Add small helpers that construct the next `Set` before persistence, and an undo controller that owns one timer and one ID. Do not put DOM concerns in `src/favorites.js`.

- [ ] **Step 4: Verify the Favorites unit test GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing shell/accessibility assertions**

Update `test/index.test.js` and `test/source-safety.test.js` to require:

- a primary `#addFavoriteCamera` button on the Favorites page;
- no main-page favorite search/status/stream/distance/sort toolbar;
- `#favoriteAddDialog`, `#favoriteAddInput` with `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, and `aria-expanded`;
- a text-only `#favoriteAddResults` listbox;
- a collapsed `#favoriteAddFilters` disclosure containing only region and provider/source filters;
- a dedicated `#favoriteStatusLive` live region and one `#favoriteUndoToast`;
- an explicit `Remove` action in the Favorites renderer (`Open large` is added with its Focus behavior in Task 4);
- poster thumbnails with non-empty accessible names;
- dialog open/close focus handling and Escape behavior.

- [ ] **Step 6: Run the shell tests and verify RED**

Run:

```bash
node --test test/index.test.js test/source-safety.test.js
```

Expected: failures against the old all-spots toolbar and implicit heart-only removal.

- [ ] **Step 7: Implement the Favorites shell and dialog/bottom sheet**

In `index.html`, replace the toolbar with `Add camera`, add the native dialog, combobox/listbox, `Filters` disclosure, live region, and undo toast. In CSS, preserve the existing tokens/radii, render the dialog compactly on desktop, and pin it as a full-width bottom sheet below 640px.

In `src/main.js`:

- render only `favoriteCameras()` on the default page;
- make every saved card show poster, feed source/status, `Open large`, and labeled `Remove`;
- source suggestions from `playableFavoriteCatalog(state.cameras)`;
- implement Arrow Up/Down, Home/End, Enter, and Escape while DOM focus remains in the input and `aria-activedescendant` tracks the active text-only option;
- selecting an unsaved option transactionally persists, updates UI, announces success, clears the query, and keeps the dialog open;
- already-saved options use `aria-disabled="true"` and are ignored by acceptance;
- closing restores focus to `#addFavoriteCamera`;
- removal transactionally persists first, then renders and offers 10-second Undo;
- the next favorite mutation clears the previous undo offer;
- persistence errors retain the current UI set and announce a failure;

- [ ] **Step 8: Verify shell tests and run focused regressions**

Run:

```bash
node --test test/favorites.test.js test/favorite-catalog.test.js test/index.test.js test/source-safety.test.js test/spot-advice-ui.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 9: Commit Favorites management**

```bash
git add index.html src/main.js src/favorites.js src/styles/app.css test/favorites.test.js test/index.test.js test/source-safety.test.js
git commit -m "feat: manage playable favorites in place"
```

## Task 3: Make gallery playback visibility-scoped and harden async player cleanup

**Files:**

- Create: `src/feed-lifecycle.js`
- Create: `test/feed-lifecycle.test.js`
- Modify: `src/video-player.js`
- Modify: `src/main.js`
- Modify: `test/video-player.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Write failing gallery-preview lifecycle tests**

Create `test/feed-lifecycle.test.js` using injected timer functions and a real fake player object. Cover:

- becoming visible calls `play(camera)` and arms one 60,000 ms timer;
- 59,999 ms does not expire, 60,000 ms does;
- restart works only from expired state and grants a fresh 60,000 ms;
- leaving the visible viewport cancels the timer and clears the player;
- re-entry after leaving starts a fresh preview;
- cleanup cancels delayed starts and expiry;
- a hidden document does not start a preview.

Use:

```js
createGalleryPreviewSession({
  camera,
  player,
  durationMs: 60_000,
  setTimer,
  clearTimer
});
```

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run:

```bash
node --test test/feed-lifecycle.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the preview session**

Keep collection rendering separate from stream ownership. The session owns one player, delayed start, expiry, and visible state. Its public methods are `setVisible(visible)`, `restart()`, `clear()`, and `state()`.

- [ ] **Step 4: Verify lifecycle GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing late-completion and autoplay tests**

Extend `test/video-player.test.js` for both native HLS and hls.js:

- `clear()` during pending `video.play()` prevents a later resolution from setting `playing`;
- `clear()` before `ensureHls()` resolves prevents Hls construction/attachment;
- an old Hls `MANIFEST_PARSED` or fatal error callback cannot change a newer/cleared player;
- rejected autoplay ends in a `blocked` state with `Press play to start`, not `playing`;
- one player failure leaves a separate player untouched.

- [ ] **Step 6: Run the player test and verify RED**

Run:

```bash
node --test test/video-player.test.js
```

Expected: late completions currently resurrect or relabel cleared players, and rejected native autoplay currently reports `Playing`.

- [ ] **Step 7: Add operation-generation protection**

Increment a generation token on every `play`, `clear`, and `expire`. Capture it before async work and ignore every continuation/event that is no longer current. Return the final state from `play()` and expose `blocked` distinctly from `unavailable` and `expired`.

- [ ] **Step 8: Verify player GREEN**

Run:

```bash
node --test test/video-player.test.js test/feed-lifecycle.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 9: Write failing integration/source assertions for observer ownership**

Require one `IntersectionObserver` rooted at the viewport with no positive root margin, registration of every populated gallery tile, `setVisible(entry.isIntersecting)` handoff, observer disconnect on rerender/route exit, and all tiles still present as poster shells.

- [ ] **Step 10: Wire gallery sessions into Monitor**

Replace stagger/timer branches in `src/main.js` with `createGalleryPreviewSession`. Render every favorite card, observe each card, and never play an offscreen card. A card within the surrounding document remains rendered with its poster. Clicking an expired frame calls `restart()`; a blocked pane exposes a real `Play`/`Retry` button.

- [ ] **Step 11: Run focused integration regressions**

Run:

```bash
node --test test/source-safety.test.js test/monitor-cameras.test.js test/feed-lifecycle.test.js test/video-player.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 12: Commit playback policy**

```bash
git add src/feed-lifecycle.js src/video-player.js src/main.js test/feed-lifecycle.test.js test/video-player.test.js test/source-safety.test.js
git commit -m "feat: scope gallery playback to visible previews"
```

## Task 4: Add one-camera Focus, equal two-camera Compare, and app-owned fullscreen

**Files:**

- Create: `src/monitor-view.js`
- Create: `src/fullscreen-controller.js`
- Create: `test/monitor-view.test.js`
- Create: `test/fullscreen-controller.test.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Modify: `test/index.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Write failing Monitor transition tests**

Use a pure state API:

```js
createMonitorViewState();
openMonitorFocus(state, cameraId, { scrollY, originCameraId });
addComparisonCamera(state, cameraId);
replaceFocusedCamera(state, paneIndex, cameraId);
removeComparisonCamera(state, paneIndex);
exitMonitorFocus(state);
```

Cover gallery → focus-one, adding exactly one distinct second camera, duplicate rejection, pane-local replacement, removing either pane back to focus-one, and preserving gallery scroll/origin metadata for exit.

- [ ] **Step 2: Run transition tests and verify RED**

Run:

```bash
node --test test/monitor-view.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement immutable Monitor transitions**

Keep the state shape exactly `{ view, focusedCameraIds, galleryScrollY, originCameraId }`. Invalid/missing camera IDs leave state unchanged; Focus/Compare never contain duplicates or more than two IDs.

- [ ] **Step 4: Verify transition tests GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing fullscreen-controller tests**

Cover feature detection, a direct `target.requestFullscreen()` call, `document.exitFullscreen()`, rejection reporting without changing Monitor state, `fullscreenchange` label sync, and listener removal by `destroy()`.

- [ ] **Step 6: Run fullscreen tests and verify RED**

Run:

```bash
node --test test/fullscreen-controller.test.js
```

Expected: module-not-found failure.

- [ ] **Step 7: Implement the fullscreen controller**

Inject the document and status callback for tests. The controller targets the complete focus composition wrapper and returns a rejected/unsupported result instead of throwing into the UI event loop.

- [ ] **Step 8: Verify fullscreen tests GREEN**

Run the command from Step 6. Expected: all tests pass.

- [ ] **Step 9: Write failing Focus/Compare shell assertions**

Require `#monitorFocus` alongside `#monitorGrid`, a focus heading, Exit Focus, Compare picker/action, composition fullscreen button, favorite switcher, pane-local replace/remove/retry controls, explicit `Open large` controls in both Monitor and Favorites renderers, and no timed-preview session creation inside the Focus renderer. Require `visibilitychange` cleanup/reactivation and route cleanup.

- [ ] **Step 10: Implement Focus and Compare rendering**

In `src/main.js`:

- store the pure Monitor view state in session-only `state.monitorView`;
- add `Open large` to every playable Monitor tile and Favorites card, with both routes calling the same Focus entry point;
- `Open large` records scroll/focus origin, switches to `focus-one`, and focuses the Focus heading/control;
- create one independent `createFeedTilePlayer` per focused pane and call it directly, never through `createGalleryPreviewSession`;
- a Compare picker lists favorite cameras except the current pane and adds exactly one distinct camera;
- pane-local replacement changes only that pane; removing either side returns to focus-one with the remaining camera;
- Exit clears focused players, returns to the gallery, restores scroll after paint, then restores focus to the originating tile when present;
- hiding the document clears focused players; becoming visible recreates the selected composition without a timer; blocked autoplay shows pane-local Retry;
- fullscreen targets `#monitorFocusComposition`, keeps the composition on rejection, and reports status in the dedicated live region.

- [ ] **Step 11: Implement responsive Focus/Compare CSS**

Use existing colors, radii, and typography. One feed uses the useful page width. Compare uses two equal `minmax(320px, 1fr)` columns only when the available composition is at least 640px; otherwise it stacks. Do not give either pane a secondary visual weight. Add `:fullscreen` styling for the whole composition and preserve visible focus rings/reduced-motion behavior.

- [ ] **Step 12: Run Focus/Compare regressions**

Run:

```bash
node --test test/monitor-view.test.js test/fullscreen-controller.test.js test/feed-lifecycle.test.js test/video-player.test.js test/index.test.js test/source-safety.test.js
```

Expected: all targeted tests pass, including explicit proof that Focus/Compare have no 60-second timer.

- [ ] **Step 13: Commit deliberate viewing**

```bash
git add src/monitor-view.js src/fullscreen-controller.js index.html src/main.js src/styles/app.css test/monitor-view.test.js test/fullscreen-controller.test.js test/index.test.js test/source-safety.test.js
git commit -m "feat: add focus and compare viewing"
```

## Task 5: Add automatic Explore drill-in and preserved map expansion

**Files:**

- Create: `src/explore-emphasis.js`
- Create: `test/explore-emphasis.test.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Modify: `test/index.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Write failing Explore state tests**

Use:

```js
createExploreViewState();
initializeExploreSelection(state, cameraId);
selectExploreSpot(state, cameraId, { explicit: true });
openSelectedExploreSpot(state);
expandExploreMap(state);
```

Cover initialization keeping `emphasis: "map"`, explicit marker/result selection producing `detail`, nearby replacement staying in `detail`, contextual Open selected spot producing `detail`, and Expand map retaining `selectedCameraId` plus any supplied view-context object.

- [ ] **Step 2: Run Explore state tests and verify RED**

Run:

```bash
node --test test/explore-emphasis.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement immutable Explore transitions**

Keep selection and emphasis separate. Never store Leaflet objects in this pure module; preserve opaque map context unchanged if passed through tests.

- [ ] **Step 4: Verify Explore state tests GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing Explore shell/layout assertions**

Require:

- `.map-layout[data-emphasis="map"]` on initial HTML;
- a persistent `.map-shell` containing the same `#map` node and contextual `#expandExploreMap`;
- `#openSelectedSpot` in the compact selected summary;
- separate summary/detail content wrappers so mobile detail can order camera summary → map → longer details → nearby results;
- explicit marker/result handlers selecting with detail emphasis;
- initialization selecting without promotion;
- emphasis changes scheduling `invalidateSize({ pan: false })` through `afterNextPaint` and never calling `fitBounds`, `panTo`, or recreating the map during Expand map.

- [ ] **Step 6: Run shell tests and verify RED**

Run:

```bash
node --test test/index.test.js test/source-safety.test.js
```

Expected: failures because Explore is a fixed map/detail grid with no emphasis state or contextual controls.

- [ ] **Step 7: Restructure Explore without recreating Leaflet**

Wrap (do not replace) the existing `#map` element in `.map-shell`, preserving the same Leaflet node and instance. Split the spot panel into a camera summary and longer-details wrapper. Remove `aria-live` from the complete spot panel; use the small existing/dedicated status live region instead.

In `src/main.js`:

- initialize `state.exploreView` with map emphasis and a selected camera without promotion;
- marker/result and explicit recommendation actions call selection with `{ explicit: true }`;
- `Open selected spot` promotes the already-selected camera;
- `Expand map` changes only emphasis;
- update `data-emphasis`, button visibility, and relevant accessible labels in one renderer;
- after every emphasis change, call the existing `afterNextPaint` then `state.map.invalidateSize({ pan: false })` inside a local error boundary;
- never recreate `state.map`, refit bounds, or pan when only changing emphasis;
- retain the current filters, selected camera, Leaflet center/bounds/zoom, and result list.

- [ ] **Step 8: Implement the approved desktop/mobile proportions**

Desktop map-primary retains the large map and compact selected summary. Detail-primary gives the camera/details most of the width and keeps a smaller interactive map with `Expand map` plus nearby results. At mobile widths, map-primary is map-first; detail-primary uses normal flow in the exact order camera summary, compact map, longer conditions/playbook, nearby results. Only use a detail/map side-by-side tablet layout when detail can remain at least 480px and map at least 280px.

- [ ] **Step 9: Run Explore regressions**

Run:

```bash
node --test test/explore-emphasis.test.js test/camera-filters.test.js test/index.test.js test/source-safety.test.js test/spot-advice-ui.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 10: Commit Explore emphasis**

```bash
git add src/explore-emphasis.js index.html src/main.js src/styles/app.css test/explore-emphasis.test.js test/index.test.js test/source-safety.test.js
git commit -m "feat: promote selected explore spots"
```

## Task 6: Complete integrated accessibility and regression verification

**Files:**

- Modify as required by failures: `index.html`, `src/*.js`, `src/styles/app.css`, `test/*.test.js`

- [ ] **Step 1: Run the complete suite**

Run outside the sandbox because `test/dev-server.test.js` binds localhost:

```bash
npm test -- --test-reporter=dot
```

Expected: 423 baseline tests plus all new tests pass; zero failures, skips, warnings, or unhandled rejections.

- [ ] **Step 2: Run static integrity checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional feature files are modified. Delete the worktree-only install-generated `package-lock.json` rather than committing it because the dependency graph did not change.

- [ ] **Step 3: Perform keyboard-only interaction checks in the chosen in-app browser**

Verify:

- Add-camera dialog focus entry/return, editable combobox navigation, Enter acceptance, and Escape dismissal;
- explicit Remove and 10-second Undo announcement;
- Focus entry/exit focus restoration, Compare replace/remove, and Retry controls;
- fullscreen unsupported/rejection fallback without leaving Focus;
- marker-equivalent keyboard browsing through Explore results, automatic detail promotion, and Expand map context preservation;
- visible `:focus-visible` rings and reduced-motion behavior.

- [ ] **Step 4: Fix every discovered bug test-first**

For each issue, add or strengthen the smallest failing automated test, observe RED, implement the fix, and observe GREEN before proceeding.

- [ ] **Step 5: Commit integration fixes**

```bash
git add index.html src test
git commit -m "fix: harden responsive camera workflows"
```

Skip this commit if no fixes were necessary.

## Task 7: Visual design QA against the approved target

**Files:**

- Create: `design-qa.md`
- Reference: `/Users/kuangchen/.codex/visualizations/2026/08/11/019fef77-8303-7d30-9a69-d452e279463f/map-auto-drill-flow-retry.png`

- [ ] **Step 1: Start the verified worktree preview**

Run the existing server on an available local port and open it in the user's in-app browser. Keep this preview open for handoff.

- [ ] **Step 2: Capture matched implementation states**

At the same viewport as the approved reference, capture map-primary and selected spot-primary Explore. Also capture Favorites, one-camera Focus, equal Compare, portrait mobile Compare, and portrait mobile Explore detail.

- [ ] **Step 3: Compare reference and implementation together**

Build one side-by-side comparison image containing the approved reference and matched implementation screenshot. Judge hierarchy, geometry, typography, spacing, borders/radii, cropping, and control placement from the combined input. A screenshot alone is not a QA verdict.

- [ ] **Step 4: Record and fix all P0/P1/P2 findings**

Create `design-qa.md` with viewport/state evidence, findings, fixes, and a final checklist. Fix every P0/P1/P2 issue, recapture, and repeat the combined comparison until it passes. The last non-empty line must be:

```text
final result: passed
```

- [ ] **Step 5: Re-run tests and commit QA fixes/evidence**

```bash
npm test -- --test-reporter=dot
git diff --check
git add design-qa.md index.html src test
git commit -m "fix: complete camera experience design QA"
```

Skip source/test paths with no changes, but always commit the completed `design-qa.md`.

## Task 8: Final review, production deployment, and live verification

**Files:**

- Review: all commits since `2e00cbe`

- [ ] **Step 1: Dispatch final spec and code-quality reviews**

Review the entire diff against `docs/superpowers/specs/2026-08-12-favorites-focus-map-ux-design.md`. Fix all Important or higher issues through a new failing test and re-run the relevant review until approved.

- [ ] **Step 2: Produce fresh final verification evidence**

Run:

```bash
npm test -- --test-reporter=dot
git diff --check
git status --short --branch
```

Expected: all tests pass and the feature branch is clean.

- [ ] **Step 3: Integrate the already-approved deployment into local `main`**

From the primary checkout, verify the only unrelated item is its pre-existing untracked `package-lock.json`, then fast-forward:

```bash
git merge --ff-only codex/favorites-focus-map-ux
```

Do not stage or modify the unrelated root `package-lock.json`.

- [ ] **Step 4: Push the production branch**

```bash
git push origin main
```

Inspect the repository's configured GitHub Pages source immediately before pushing. If it serves static `main` content as expected, push `main`; if it uses an existing Pages workflow, follow that workflow without initializing a second hosting stack.

- [ ] **Step 5: Verify CI and the live deployment**

Wait for the `validate` workflow triggered by the pushed commit and confirm it succeeds. In the chosen in-app browser, open `https://kuangc.github.io/surfcams-portugal/`, hard-refresh past caches, and verify the deployed commit supports:

- more than seven favorites with no padded slots;
- in-place add/remove/undo;
- 60-second gallery preview policy;
- untimed Focus/Compare while visible;
- automatic Explore drill-in and preserved Expand map context.

- [ ] **Step 6: Mark the implementation goal complete**

Only after CI and live behavior are verified, report the deployed commit and close the active `implement test and deploy` goal.
