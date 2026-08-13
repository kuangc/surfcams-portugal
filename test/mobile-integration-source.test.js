import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const mainSource = fs.readFileSync("src/main.js", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");

test("primary route transitions announce the destination heading", () => {
  for (const headingId of ["monitorTitle", "favoritesTitle", "exploreTitle", "configureTitle"]) {
    assert.match(html, new RegExp(`<h1[^>]*id="${headingId}"[^>]*tabindex="-1"`));
  }
  const routeSource = mainSource.match(/function setRoute\(route\)[\s\S]*?\n}\n\nfunction favoriteOrder/)?.[0] || "";
  assert.match(routeSource, /destinationHeading/);
  assert.match(routeSource, /route === "monitor" && state\.monitorView\.view !== "gallery"[\s\S]*els\.monitorFocusTitle/);
  assert.match(routeSource, /destinationHeading\?\.focus\(\{ preventScroll: true }\)/);
});

test("Focus panes expose their labeled media before replacement controls", () => {
  const paneSource = mainSource.match(/function createFocusedPane[\s\S]*?\n}\n\nfunction renderMonitorFocus/)?.[0] || "";
  assert.match(paneSource, /video\.setAttribute\("aria-label", `\$\{camera\.name} live camera`\)/);
  assert.match(paneSource, /details\.append\(header, conditionStrip\)/);
  assert.match(paneSource, /return \{ frame, details }/);
});

test("Compare presents both labeled feeds before either pane's editing controls", () => {
  assert.match(mainSource, /function renderMonitorFocus[\s\S]*monitorFocusMedia[\s\S]*monitorFocusDetails/);
  assert.match(mainSource, /monitorFocusMedia\.appendChild\(pane\.frame\)[\s\S]*monitorFocusDetails\.appendChild\(pane\.details\)/);
  assert.match(mainSource, /function focusedPanePart[\s\S]*\.\.\.container\.children[\s\S]*Number\(element\.dataset\.paneIndex\) === paneIndex/);
});

test("mobile clusters refresh as the map zoom and breakpoint change", () => {
  const mapSource = mainSource.match(/function ensureMap\(\)[\s\S]*?\n}\n\nfunction refreshExploreMap/)?.[0] || "";
  assert.match(mapSource, /state\.map\.on\("moveend zoomend"[\s\S]*renderMarkers\(\)/);
  assert.match(mainSource, /mobileMapMediaQuery\.addEventListener\("change"/);
  assert.match(mainSource, /exploreFiltersDisclosure\.open = true/);
  assert.match(mainSource, /renderMarkers\(\)/);
  assert.match(mainSource, /if \(state\.activeRoute === "explore"\) applyExploreEmphasis\(\)/);
});

test("cluster drill-down restores map focus and announces the refined result", () => {
  const clusterSource = mainSource.match(/function createAggregateMarker[\s\S]*?\n}\n\nfunction fitCameraBounds/)?.[0] || "";
  assert.match(clusterSource, /exploreStatus\.textContent\s*=\s*`Refining/);
  assert.match(clusterSource, /els\.map\.focus\(\{ preventScroll: true }\)[\s\S]*fitCameraBounds\(cameras, \[52, 52\]\)/);
});

test("Focus and Compare transitions restore focus after replacing controls", () => {
  const replaceSource = mainSource.match(/function replaceFocusedPaneElement[\s\S]*?\n}\n\nfunction createFocusedPane/)?.[0] || "";
  assert.match(replaceSource, /afterNextPaint\([\s\S]*replacementSelect\?\.focus\(\{ preventScroll: true }\)/);
  assert.match(mainSource, /monitorComparePicker\.addEventListener\("change"[\s\S]*renderMonitor\(\)[\s\S]*monitorFocusTitle\.focus\(\{ preventScroll: true }\)/);
  assert.match(mainSource, /removeComparisonCamera[\s\S]*renderMonitor\(\)[\s\S]*monitorFocusTitle\.focus\(\{ preventScroll: true }\)/);
});

test("the mobile breakpoint follows the bottom-navigation breakpoint in landscape", () => {
  assert.match(mainSource, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.doesNotMatch(mainSource, /matchMedia\("\(max-width: 640px\)"\)/);
  const navCss = styleSource.match(/@media \(max-width: 900px\)[\s\S]*?\n}\n\n@media \(max-width: 900px\)/)?.[0] || "";
  assert.match(navCss, /safe-area-inset-top/);
  assert.match(navCss, /safe-area-inset-left/);
  assert.match(navCss, /safe-area-inset-right/);
  assert.match(navCss, /\.favorite-undo-toast button[\s\S]*min-height:\s*44px[\s\S]*\.favorite-undo-toast button[\s\S]*min-width:\s*44px/);
  assert.match(navCss, /\.map \.leaflet-control-zoom a[\s\S]*width:\s*44px\s*!important[\s\S]*height:\s*44px\s*!important/);
});

test("map summaries describe only visible mobile groups", () => {
  const listSource = mainSource.match(/function renderExploreList\(\)[\s\S]*?\n}\n\nasync function handleSessionFeedbackImport/)?.[0] || "";
  assert.match(listSource, /groupMobileMapMarkers\(cameras,/);
  assert.doesNotMatch(listSource, /groupMobileMapMarkers\(allCameras,/);
});

test("mobile layout protects notches and common controls meet touch target guidance", () => {
  const mobileCss = styleSource.match(/@media \(max-width: 900px\)[\s\S]*?\n}\n\n@media \(min-width: 980px\)/)?.[0] || "";
  assert.match(mobileCss, /safe-area-inset-top/);
  assert.match(mobileCss, /safe-area-inset-left/);
  assert.match(mobileCss, /safe-area-inset-right/);
  assert.match(mobileCss, /\.favorite-toggle[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
  assert.match(mobileCss, /\.toggle-row[\s\S]*min-height:\s*44px/);
  assert.match(styleSource, /\.cam-marker-hitbox[\s\S]*width:\s*44px[\s\S]*height:\s*44px/);
});

test("mobile overlays avoid the notch and prominent actions remain 44px", () => {
  const mobileCss = styleSource.match(/@media \(max-width: 900px\)[\s\S]*?\n}\n\n@media \(min-width: 980px\)/)?.[0] || "";

  assert.match(styleSource, /\.monitor-focus__composition:fullscreen[\s\S]*safe-area-inset-top[\s\S]*safe-area-inset-right[\s\S]*safe-area-inset-bottom[\s\S]*safe-area-inset-left/);
  assert.match(mobileCss, /\.favorite-add-dialog[\s\S]*safe-area-inset-right[\s\S]*safe-area-inset-left/);
  assert.match(mobileCss, /\.favorite-undo-toast[\s\S]*right:\s*max\([^;]*safe-area-inset-right[\s\S]*left:\s*max\([^;]*safe-area-inset-left/);
  assert.match(mobileCss, /\.segmented-control button,[\s\S]*\.staleness-banner__dismiss,[\s\S]*\.stretch-chip,[\s\S]*\.spot-playbook-toggle,[\s\S]*\.feed-retry-button[\s\S]*min-height:\s*44px/);
  assert.match(mobileCss, /\.staleness-banner__dismiss[\s\S]*min-width:\s*44px/);
  assert.match(mobileCss, /\.feed-retry-button[\s\S]*min-height:\s*44px/);
});
