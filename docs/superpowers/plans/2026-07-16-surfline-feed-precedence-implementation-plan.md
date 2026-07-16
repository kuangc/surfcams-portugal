# Surfline Feed Precedence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve one feed-backed runtime roster where matched raw Surfline feeds always beat exact MEO feeds, no-feed research subjects disappear from every product surface, and report substitutes are removed.

**Architecture:** Keep the merged camera/advice database as the canonical research layer, then pass it through a new pure feed-policy module before constructing any product surface. The policy normalizes the private raw Surfline registry, matches ordered Surfline camera still identifiers, materializes explicit feed provenance, uses only exact MEO fallback, and returns only playable records. `src/main.js` stores the canonical database separately while Monitor, Might be good, Favorites, and Explore all consume the resolved roster.

**Tech Stack:** Browser-native ES modules, Node.js `node:test`, JSON camera fixtures, HLS.js playback.

---

### Task 1: Add the pure raw-feed policy

**Files:**
- Create: `src/feed-policy.js`
- Create: `test/feed-policy.test.js`

- [ ] **Step 1: Write failing normalization and camera-id extraction tests**

Create `test/feed-policy.test.js` with focused tests that import `extractSurflineCameraId` and `normalizeRawSurflineFeeds`. Cover the current array registry, first-valid duplicate behavior, reserved ids, invalid schemes, malformed images, malformed ids, unknown still hosts, credentials, ports, and a later valid camera after a malformed first camera:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSurflineCameraId,
  normalizeRawSurflineFeeds
} from "../src/feed-policy.js";

test("normalizeRawSurflineFeeds accepts the first valid HTTPS entry per safe id", () => {
  const feeds = normalizeRawSurflineFeeds({
    __rawSurflineFeeds: [
      { id: "pt-good", streamUrl: "http://example.test/rejected.m3u8" },
      { id: "pt-good", streamUrl: "https://hls.example.test/good.m3u8", image: "https://images.example.test/good.jpg" },
      { id: "pt-good", streamUrl: "https://hls.example.test/duplicate.m3u8" },
      { id: "__meta", streamUrl: "https://hls.example.test/meta.m3u8" },
      { id: "bad/id", streamUrl: "https://hls.example.test/bad.m3u8" },
      { id: "pt-bad-image", streamUrl: "https://hls.example.test/bad-image.m3u8", image: "javascript:alert(1)" }
    ],
    "pt-top-level": { streamUrl: "https://hls.example.test/top-level.m3u8" }
  });

  assert.deepEqual([...feeds], [["pt-good", {
    id: "pt-good",
    streamUrl: "https://hls.example.test/good.m3u8",
    image: "https://images.example.test/good.jpg"
  }]]);
});

test("extractSurflineCameraId accepts only the known still host and safe final directory", () => {
  assert.equal(extractSurflineCameraId("https://camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"), "pt-carcavelosov");
  assert.equal(extractSurflineCameraId("https://example.test/eu-west-1/pt-carcavelosov/latest_small.jpg"), null);
  assert.equal(extractSurflineCameraId("http://camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"), null);
  assert.equal(extractSurflineCameraId("https://user@camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg"), null);
  assert.equal(extractSurflineCameraId("https://camstills.cdn-surfline.com:444/eu-west-1/pt-carcavelosov/latest_small.jpg"), null);
  assert.equal(extractSurflineCameraId("https://camstills.cdn-surfline.com/eu-west-1/bad%2Fid/latest_small.jpg"), null);
});
```

- [ ] **Step 2: Run the policy tests and verify RED**

Run: `node --test test/feed-policy.test.js`

Expected: FAIL because `src/feed-policy.js` does not exist.

- [ ] **Step 3: Implement safe normalization and extraction**

Create `src/feed-policy.js` with these public functions and private validation helpers:

```js
const RAW_REGISTRY_KEY = "__rawSurflineFeeds";
const RESERVED_IDS = new Set(["__meta", "__proto__", "constructor", "prototype"]);
const SAFE_CAMERA_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const SURFLINE_STILL_HOSTS = new Set(["camstills.cdn-surfline.com"]);

function safeHttpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeRawSurflineFeeds(localOverrides = {}) {
  const rows = Array.isArray(localOverrides?.[RAW_REGISTRY_KEY])
    ? localOverrides[RAW_REGISTRY_KEY]
    : [];
  const feeds = new Map();
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!SAFE_CAMERA_ID.test(id) || RESERVED_IDS.has(id) || feeds.has(id)) continue;
    const streamUrl = safeHttpsUrl(row.streamUrl);
    const hasImage = Object.hasOwn(row, "image");
    const image = hasImage ? safeHttpsUrl(row.image) : null;
    if (!streamUrl || (hasImage && !image)) continue;
    feeds.set(id, { id, streamUrl, ...(image ? { image } : {}) });
  }
  return feeds;
}

export function extractSurflineCameraId(stillUrl) {
  if (typeof stillUrl !== "string") return null;
  try {
    const url = new URL(stillUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!SURFLINE_STILL_HOSTS.has(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts.at(-2) || "";
    return SAFE_CAMERA_ID.test(id) && !RESERVED_IDS.has(id) ? id : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the policy tests and verify GREEN**

Run: `node --test test/feed-policy.test.js`

Expected: both tests PASS.

### Task 2: Resolve Surfline precedence, exact MEO fallback, and exclusions

**Files:**
- Modify: `src/feed-policy.js`
- Modify: `test/feed-policy.test.js`

- [ ] **Step 1: Write failing feed-resolution unit tests**

Extend `test/feed-policy.test.js` to import `resolveFeedBackedCameras` and `normalizeSpotAdviceRuntime`. Add small fixture helpers and separate tests proving:

```js
import { normalizeSpotAdviceRuntime } from "../src/spot-advice.js";

function spotData(byCameraId = {}) {
  return {
    advice: normalizeSpotAdviceRuntime({
      subjects: {
        "surfline-alpha": { id: "surfline-alpha", name: "Alpha" },
        "surfline-no-feed": { id: "surfline-no-feed", name: "No feed" }
      },
      identityReport: { byCameraId }
    })
  };
}

function registry(rows) {
  return { __rawSurflineFeeds: rows };
}

test("raw Surfline feed wins for promoted and trusted native representations", () => {
  const cameras = [
    { id: "meo-alpha", streamUrl: "https://meo.example/alpha.m3u8", image: "https://meo.example/alpha.jpg", hasStream: true, livecamId: "42" },
    { id: "surfline-alpha", promoted: true, linkedCamId: "meo-alpha", surflineCams: [
      { stillUrl: "https://camstills.cdn-surfline.com/eu-west-1/pt-missing/latest_small.jpg" },
      { stillUrl: "https://camstills.cdn-surfline.com/eu-west-1/pt-alpha/latest_small.jpg" }
    ] }
  ];
  const resolved = resolveFeedBackedCameras(
    { cameras },
    spotData({ "meo-alpha": "surfline-alpha" }),
    registry([{ id: "pt-alpha", streamUrl: "https://surfline.example/alpha.m3u8", image: "https://surfline.example/alpha.jpg" }])
  );

  assert.deepEqual(resolved.map(({ id, streamSource, feedCameraId, streamUrl }) => ({ id, streamSource, feedCameraId, streamUrl })), [
    { id: "meo-alpha", streamSource: "surfline-raw", feedCameraId: "pt-alpha", streamUrl: "https://surfline.example/alpha.m3u8" },
    { id: "surfline-alpha", streamSource: "surfline-raw", feedCameraId: "pt-alpha", streamUrl: "https://surfline.example/alpha.m3u8" }
  ]);
});

test("promoted subjects use only exact linked MEO fallback and never stretch cameras", () => {
  const resolved = resolveFeedBackedCameras({ cameras: [
    { id: "meo-alpha", streamUrl: "https://meo.example/alpha.m3u8", image: "https://meo.example/alpha.jpg", hasStream: true, livecamId: "42" },
    { id: "stretch", streamUrl: "https://meo.example/stretch.m3u8", hasStream: true },
    { id: "surfline-alpha", promoted: true, linkedCamId: "meo-alpha", stretchCamIds: ["stretch"], surflineCams: [] },
    { id: "surfline-no-feed", promoted: true, linkedCamId: null, stretchCamIds: ["stretch"], surflineCams: [] }
  ] }, spotData({ "meo-alpha": "surfline-alpha" }), registry([]));

  const alpha = resolved.find((camera) => camera.id === "surfline-alpha");
  assert.equal(alpha.streamSource, "meo");
  assert.equal(alpha.feedCameraId, "42");
  assert.equal(alpha.streamUrl, "https://meo.example/alpha.m3u8");
  assert.equal(resolved.some((camera) => camera.id === "surfline-no-feed"), false);
  assert.equal(resolved.some((camera) => camera.id === "stretch"), true);
});

test("an unrelated native MEO camera retains its stream and missing feeds are excluded", () => {
  const resolved = resolveFeedBackedCameras({ cameras: [
    { id: "native", streamUrl: "https://meo.example/native.m3u8", hasStream: true },
    { id: "broken", streamUrl: "", hasStream: false }
  ] }, spotData(), registry([]));

  assert.deepEqual(resolved.map(({ id, streamSource, feedCameraId }) => ({ id, streamSource, feedCameraId })), [
    { id: "native", streamSource: "meo", feedCameraId: "native" }
  ]);
});
```

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `node --test test/feed-policy.test.js`

Expected: normalization tests PASS and resolver tests FAIL because `resolveFeedBackedCameras` is not exported.

- [ ] **Step 3: Implement subject-level feed resolution**

Add `import { adviceSubjectIdFor } from "./spot-advice.js";` and implement `resolveFeedBackedCameras(cameraDb, spotData, localOverrides)` without mutating inputs. Build a camera map, find each promoted subject's first provider-ordered raw match, apply that raw feed to every trusted representation returned by `adviceSubjectIdFor`, otherwise copy only `linkedCamId` for promoted records, retain valid native MEO streams, and filter every unresolved record. Every returned record must have `streamSource`, `feedCameraId`, `streamUrl`, `image`, and `hasStream: true`.

Use these internal boundaries:

```js
function hasHttpsStream(camera) {
  return Boolean(safeHttpsUrl(camera?.streamUrl));
}

function logicalSubjectId(camera, spotData) {
  if (camera?.promoted && typeof camera.id === "string") return camera.id;
  return adviceSubjectIdFor(camera, spotData);
}

function rawFeedForSubject(subject, rawFeeds) {
  for (const camera of subject?.surflineCams || []) {
    const id = extractSurflineCameraId(camera?.stillUrl);
    if (id && rawFeeds.has(id)) return rawFeeds.get(id);
  }
  return null;
}
```

Do not use `stretchCamIds`, proximity, `pageUrl`, or playback health in this module.

- [ ] **Step 4: Run the resolver tests and verify GREEN**

Run: `node --test test/feed-policy.test.js`

Expected: all policy tests PASS.

### Task 3: Prove the complete 44-subject data outcome

**Files:**
- Modify: `test/feed-policy.test.js`
- Modify: `test/spot-advice-subjects.test.js`

- [ ] **Step 1: Write the failing real-data integration test**

In `test/feed-policy.test.js`, import the real JSON data plus `mergePromotedSpots`, `mergeAdviceGuideSubjects`, and `normalizeSpotAdviceRuntime`. Define the 22 approved subject-to-camera-id matches with dummy HTTPS streams and assert the exact current partition:

```js
const RAW_MATCHES = new Map([
  ["surfline-nazare", "pt-nazareov"],
  ["surfline-baleal", "pt-baleal"],
  ["surfline-lagide", "pt-lagide"],
  ["surfline-cantinho-da-baia", "pt-baiaoverview"],
  ["surfline-supertubos", "pt-supertubosoverview"],
  ["surfline-ribeira-d-ilhas", "pt-ribeiradeilhas"],
  ["surfline-reef", "pt-reef"],
  ["surfline-pedra-branca", "pt-pedrabranca"],
  ["surfline-praia-do-sul", "pt-praiadosulericeira"],
  ["surfline-foz-do-lizandro", "pt-fozdolizandro"],
  ["surfline-praia-pequena", "pt-praiapequena"],
  ["surfline-praia-grande", "pt-praiagrande"],
  ["surfline-praia-do-guincho", "pt-guincho"],
  ["surfline-paco-de-arcos", "pt-pacodearcos"],
  ["surfline-santo-amaro", "pt-santoamaro"],
  ["surfline-carcavelos", "pt-carcavelosov"],
  ["surfline-cova-do-vapor", "pt-covadovapor"],
  ["surfline-sao-joao-da-caparica", "pt-saojoaocaparica"],
  ["surfline-praia-do-barbas", "pt-barbas"],
  ["surfline-costa-da-caparica", "pt-costadacaparicaoverview"],
  ["surfline-castelo", "pt-castelo"],
  ["surfline-fonte-da-telha", "pt-fontedatelhafront"]
]);
```

Build the canonical database using the same merge order as the app. Assert 22 promoted `surfline-raw`, 14 promoted `meo`, six promoted absent, both guide-only subjects absent, all eight named excluded subjects absent, and all 44 advice subjects still present in the normalized canonical advice map.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --test test/feed-policy.test.js test/spot-advice-subjects.test.js`

Expected: FAIL where legacy tests still expect guide-only/report-only subjects in Explore and where the current policy integration has not yet been reconciled with those expectations.

- [ ] **Step 3: Update canonical-versus-roster subject tests**

Change `test/spot-advice-subjects.test.js` so it proves guide-only records and excluded promoted subjects remain inspectable in `mergeActualAppSubjects()` and `spotData.advice`, while the result of `resolveFeedBackedCameras` contains neither. Remove tests and imports for `firstClassCameras` and `routeCameraPlayback`; replace their user-facing expectations with the central feed-backed roster contract.

- [ ] **Step 4: Run the integration tests and verify GREEN**

Run: `node --test test/feed-policy.test.js test/spot-advice-subjects.test.js`

Expected: all policy and subject tests PASS.

### Task 4: Carry the raw registry through loading and wire one runtime roster

**Files:**
- Modify: `src/camera-data.js`
- Modify: `src/main.js`
- Modify: `test/camera-data.test.js`
- Modify: `test/source-safety.test.js`

- [ ] **Step 1: Write failing loader and startup-wiring tests**

Update `test/camera-data.test.js` so the existing `loadCameraDb` fixture asserts that the returned database includes the exact parsed `localStreamOverrides` object while direct camera overrides still apply. Replace legacy `firstClassCameras` expectations with `availableCameras` only where they still describe the base loader.

Update `test/source-safety.test.js` to require:

```js
assert.match(mainSource, /resolveFeedBackedCameras/);
assert.match(mainSource, /const \{ localStreamOverrides = \{\}, \.\.\.baseCameraDb \} = cameraDb/);
assert.match(mainSource, /state\.cameras\s*=\s*sortCamerasByLatitudeDescending\(\s*resolveFeedBackedCameras\(/s);
assert.match(mainSource, /function manageSpotCameras\(\)\s*\{\s*return state\.cameras/s);
assert.doesNotMatch(mainSource, /state\.db\?\.cameras\s*\|\|\s*state\.cameras/);
assert.match(mainSource, /sanitizeFavoriteIds\(state\.cameras,\s*loadFavoriteIds\(state\.cameras\)\)/);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/camera-data.test.js test/source-safety.test.js`

Expected: FAIL because the loader does not retain the local registry and startup still derives `firstClassCameras` from the canonical database.

- [ ] **Step 3: Implement loader and startup wiring**

In `loadCameraDb`, return:

```js
return {
  ...applyCameraStreamOverrides(cameraDb, streamOverrides),
  localStreamOverrides: streamOverrides
};
```

In `src/main.js`, remove the `firstClassCameras` import, import `resolveFeedBackedCameras`, destructure `localStreamOverrides` before constructing `state.db`, and set `state.cameras` only from the policy result. Make `manageSpotCameras()` return `state.cameras`. Load and sanitize favorites against `state.cameras`. Keep `state.db` for conditions, advice, and provenance lookups only.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/camera-data.test.js test/source-safety.test.js`

Expected: both test files PASS.

### Task 5: Remove report substitutes and keep playback camera-only

**Files:**
- Modify: `src/camera-data.js`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Modify: `test/source-safety.test.js`
- Modify: `test/today-recommendations-ui.test.js`

- [ ] **Step 1: Write failing source-safety assertions**

Replace positive report-UI assertions with negative assertions covering source and generated user-facing markup:

```js
for (const forbidden of [
  "Open Surfline report",
  "isReportOnlyCamera",
  "createReportFrame",
  "createSurflineControl",
  "renderReportLink",
  "explore-report-link",
  "report-frame",
  "surfline-control"
]) {
  assert.doesNotMatch(`${mainSource}\n${styleSource}`, new RegExp(forbidden));
}
```

Keep an affirmative assertion for the Local playbook evidence renderer, including `safeAdviceSourceUrl`, `target="_blank"`, and `rel="noopener noreferrer"`. Change the recommendation card assertion to require only `Watch live cam`.

- [ ] **Step 2: Run the UI safety tests and verify RED**

Run: `node --test test/source-safety.test.js test/today-recommendations-ui.test.js`

Expected: FAIL on the existing report frame, recommendation link, nearby selector, Explore report link, and associated styles.

- [ ] **Step 3: Delete report-only UI and routing**

In `src/main.js`:

- remove `findSurflineMatches` and `routeCameraPlayback` imports;
- remove `reportLinkEl` state;
- delete `isReportOnlyCamera`, `reportUrl`, `createReportFrame`, `createSurflineControl`, and `renderReportLink`;
- make every monitor tile use `createFeedTilePlayer`;
- make every recommendation action a `Watch live cam` button;
- remove the `showSurfline` option and nearby selector from `createConditionStrip`;
- call `state.explorePlayer.play(camera)` directly in `playExploreCamera`; and
- remove report-link cleanup/render calls from Explore selection.

In `src/camera-data.js`, delete `firstClassCameras` and `routeCameraPlayback`. In `src/styles/app.css`, delete the report-frame, nearby-selector, external-link-icon, and Explore-report-link rules. Leave Local playbook evidence-link styles and logic intact.

- [ ] **Step 4: Run the UI safety tests and verify GREEN**

Run: `node --test test/source-safety.test.js test/today-recommendations-ui.test.js test/spot-advice-subjects.test.js`

Expected: all three test files PASS and no report-substitute text or branch remains.

### Task 6: Prefer raw Surfline representatives and verify the whole contract

**Files:**
- Modify: `src/today-recommendations-ui.js`
- Modify: `test/today-recommendations-ui.test.js`
- Modify: `docs/superpowers/specs/2026-07-15-surfline-feed-precedence-design.md`

- [ ] **Step 1: Write the failing representative-precedence test**

Change the duplicate representative test so both candidates have streams but one has `streamSource: "surfline-raw"` and the other `streamSource: "meo"`. Assert the raw Surfline record wins regardless of array order. Add a no-feed record with only `pageUrl` and assert it is never returned.

- [ ] **Step 2: Run the recommendation test and verify RED**

Run: `node --test test/today-recommendations-ui.test.js`

Expected: FAIL because current utility treats all `streamUrl` records equally and still gives report pages partial utility.

- [ ] **Step 3: Implement explicit recommendation feed utility**

Change `cameraUtility` and selection eligibility to:

```js
function cameraUtility(camera) {
  if (!camera?.streamUrl || !camera?.hasStream) return 0;
  return camera.streamSource === "surfline-raw" ? 2 : 1;
}
```

Skip utility-zero candidates before grouping. Do not use `pageUrl` or `surfline.pageUrl` as recommendation eligibility.

- [ ] **Step 4: Run deterministic derived-data checks**

Run:

```sh
npm run check-spot-advice
git diff --check
```

Expected: the canonical advice artifact is current and the diff has no whitespace errors.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 6: Audit every acceptance criterion against fresh evidence**

Read the design acceptance criteria and record evidence from:

- `test/feed-policy.test.js` for raw precedence, exact MEO fallback, eight exclusions, canonical advice retention, ordered matching, validation, and no stretch fallback;
- `test/source-safety.test.js` for central startup ordering and absence of report substitutes;
- `test/today-recommendations-ui.test.js` for raw representative preference and no report eligibility;
- `test/video-player.test.js` for honest unavailable playback without provider switching; and
- the complete `npm test` output for regression coverage.

- [ ] **Step 7: Commit the implementation**

```sh
git add docs/superpowers/specs/2026-07-15-surfline-feed-precedence-design.md \
  docs/superpowers/plans/2026-07-16-surfline-feed-precedence-implementation-plan.md \
  src/feed-policy.js src/camera-data.js src/main.js src/styles/app.css \
  src/today-recommendations-ui.js \
  test/feed-policy.test.js test/camera-data.test.js test/source-safety.test.js \
  test/spot-advice-subjects.test.js test/today-recommendations-ui.test.js
git commit -m "feat: enforce Surfline camera feed precedence"
```
