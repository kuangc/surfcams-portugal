import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const mainSource = fs.readFileSync("src/main.js", "utf8");

function functionSource(name, nextName) {
  const expression = new RegExp(
    `function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n\\nfunction ${nextName}\\(`
  );
  return mainSource.match(expression)?.[0] || "";
}

test("Favorites removal and Undo restore a useful focus target", () => {
  const removeSource = functionSource("removeFavoriteCamera", "undoFavoriteRemoval");
  const undoSource = functionSource("undoFavoriteRemoval", "toggleFavorite");

  assert.match(removeSource, /favoriteUndoButton\.focus\(\{ preventScroll: true \}\)/);
  assert.match(removeSource, /favoriteUndo\.offer\(removedCamera,\s*restoreFavoriteFocus\)/);
  assert.match(undoSource, /restoreFavoriteFocus\(camera\)/);
  assert.doesNotMatch(undoSource, /favoritesList\.querySelectorAll/);
  assert.match(mainSource, /function restoreFavoriteFocus\(camera\)[\s\S]*state\.activeRoute === "favorites"[\s\S]*favorite-remove-button[\s\S]*state\.activeRoute === "explore"[\s\S]*detailFavorite\.focus/);
});

test("mutating the selected Explore favorite refreshes metadata without restarting its feed", () => {
  const mutationSource = functionSource("renderFavoriteMutationSurfaces", "addFavoriteCamera");

  assert.match(mutationSource, /renderExploreSelectionMetadata\(state\.selectedExploreCamera\)/);
  assert.doesNotMatch(mutationSource, /renderExploreSelection\(state\.selectedExploreCamera\)/);
});

test("gallery and Explore video plus Retry controls carry camera-specific accessible names", () => {
  const tileSource = functionSource("createMonitorTile", "recommendationInputs");
  const exploreSelectionSource = functionSource("renderExploreSelectionMetadata", "renderExploreSelection");

  assert.match(tileSource, /video\.setAttribute\("aria-label", `\$\{camera\.name\} live camera`\)/);
  assert.match(tileSource, /retryButton\.setAttribute\("aria-label", `[^`]*\$\{camera\.name\}[^`]*`\)/);
  assert.match(exploreSelectionSource, /exploreVideo\.setAttribute\("aria-label", `\$\{camera\.name\} live camera`\)/);
  assert.match(exploreSelectionSource, /exploreRetry[^\n]*setAttribute\("aria-label", `[^`]*\$\{camera\.name\}[^`]*`\)/);
  assert.match(html, /id="map"[^>]*aria-label="Surf camera map"/);
});

test("Explore exposes a visible Retry wired to the existing persistent player", () => {
  assert.match(html, /<button[^>]*id="exploreRetry"[^>]*hidden[^>]*>Retry<\/button>/);
  assert.match(
    mainSource,
    /createFeedTilePlayer\(\{[\s\S]*video:\s*els\.exploreVideo[\s\S]*onStateChange:[\s\S]*els\.exploreRetry\.hidden/
  );
  assert.match(
    mainSource,
    /els\.exploreRetry\.addEventListener\("click",[\s\S]*state\.explorePlayer\.(?:resume|play)\(state\.selectedExploreCamera\)/
  );
});

test("single-camera Focus offers Add camera to compare while multi-camera Focus offers Compare", () => {
  const controlsSource = functionSource("renderMonitorFocusControls", "focusedPanePart");

  assert.match(controlsSource, /const hasComparisonCandidate\s*=\s*roster\.some/);
  assert.match(controlsSource, /hasComparisonCandidate\s*\?\s*"Compare"\s*:\s*"Add camera to compare"/);
  assert.match(
    mainSource,
    /monitorCompareAction\.addEventListener\("click",[\s\S]*hasComparisonCandidate[\s\S]*setRoute\("favorites"\)[\s\S]*openFavoriteAddDialog\(\)/
  );
  assert.match(mainSource, /pendingComparisonCameraId/);
  assert.match(mainSource, /function completePendingComparison\(cameraId\)[\s\S]*addComparisonCamera[\s\S]*setRoute\("monitor"\)/);
  assert.match(mainSource, /addFavoriteCamera\(cameraId\)[\s\S]*completePendingComparison\(record\.camera\.id\)/);
});

test("pagehide cleanup cancels and hides the stale Undo toast", () => {
  const pagehideSource = mainSource.match(
    /window\.addEventListener\("pagehide", \([^)]*\) => \{[\s\S]*?\n  \}\);/
  )?.[0] || "";

  assert.match(pagehideSource, /cancelFavoriteUndoOffer\(\)/);
  assert.doesNotMatch(pagehideSource, /favoriteUndo\.cleanup\(\)/);
});

test("Expand map brings the persistent map back into view after the layout changes", () => {
  const expandSource = functionSource("expandExploreMapView", "setRoute");

  assert.match(
    expandSource,
    /afterNextPaint\([\s\S]*els\.map\.scrollIntoView\(\{ block: "start", behavior: "auto" \}\)[\s\S]*els\.map\.focus\(\{ preventScroll: true \}\)/
  );
});

test("mobile navigation shows short visible route labels", () => {
  assert.match(html, /class="nav-label"[^>]*>Monitor<\/span>/);
  assert.match(html, /class="nav-label"[^>]*>Favorites<\/span>/);
  assert.match(html, /class="nav-label"[^>]*>Explore<\/span>/);
  assert.match(html, /class="nav-label"[^>]*>Settings<\/span>/);
});
