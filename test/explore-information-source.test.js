import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/main.js", "utf8");
const styles = fs.readFileSync("src/styles/app.css", "utf8");

test("Explore renders the retained Surfline intelligence catalog without adding it to playback", () => {
  assert.match(source, /buildExploreCatalog/);
  assert.match(source, /state\.exploreSubjects\s*=\s*sortCamerasByLatitudeDescending\(\s*buildExploreCatalog\(state\.cameras,\s*state\.db\)/s);
  assert.match(source, /function exploreCameras\(\)[\s\S]*?filterCameras\(state\.exploreSubjects,/);
  assert.match(source, /renderRegionOptions\(els\.regionSelect,\s*state\.exploreSubjects\)/);
});

test("Explore labels and plays only a resolved MEO camera for informational subjects", () => {
  assert.match(source, /function exploreCameraForSubject\(subject\)[\s\S]*?explorePlaybackCamera\(subject,\s*state\.explorePlaybackIndex\)/);
  assert.match(source, /function playExploreCamera\(camera\)[\s\S]*?const playbackCamera = exploreCameraForSubject\(camera\)/);
  assert.match(source, /state\.explorePlayer\.play\(playbackCamera\)/);
  assert.match(source, /state\.explorePlayer\s*=\s*createAppFeedPlayer\(\{/);
  assert.match(source, /Wave information only/);
  assert.match(source, /Watching MEO camera/);
  assert.match(source, /els\.exploreRetry[\s\S]*?exploreCameraForSubject\(state\.selectedExploreCamera\)/);
});

test("Explore favorites an informational subject's linked MEO camera, never the Surfline identity", () => {
  assert.match(source, /function toggleFavorite\(camera, checked\)[\s\S]*?const favoriteCamera = exploreCameraForSubject\(camera\)/);
  assert.match(source, /addFavoriteCamera\(favoriteCamera\.id\)/);
  assert.match(source, /removeFavoriteCamera\(favoriteCamera\)/);
});

test("Explore distinguishes wave-information markers from unavailable cameras", () => {
  assert.match(source, /data-kind="\$\{camera\.exploreInformationOnly \? "info" : "camera"\}"/);
  assert.match(source, /Refining \$\{count\} surf spots in a closer map view/);
  assert.match(styles, /\.cam-marker\[data-kind="info"\]/);
});
