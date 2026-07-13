import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  formatLeaveCall,
  formatLisbonTime,
  formatWindowCall,
  selectRecommendationCameras,
  shortlistBestBets
} from "../src/today-recommendations-ui.js";

const indexSource = fs.readFileSync("index.html", "utf8");
const mainSource = fs.readFileSync("src/main.js", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");

test("today recommendation time calls use Lisbon time and actionable departure language", () => {
  const window = { start: "2026-07-13T09:15:00.000Z", end: "2026-07-13T10:30:00.000Z" };

  assert.equal(formatLisbonTime(window.start), "10:15am");
  assert.equal(formatWindowCall(window, Date.parse("2026-07-13T09:05:00Z")), "Go now · 10:15am–11:30am");
  assert.equal(formatWindowCall(window, Date.parse("2026-07-13T08:00:00Z")), "Surf 10:15am–11:30am");
  assert.equal(formatLeaveCall(window, 30, Date.parse("2026-07-13T08:00:00Z")), "Leave by 9:45am");
  assert.equal(formatLeaveCall(window, 30, Date.parse("2026-07-13T08:50:00Z")), "Leave now");
  assert.equal(formatLeaveCall(window, null, Date.parse("2026-07-13T08:00:00Z")), null);
  assert.equal(formatLeaveCall({ ...window, leaveAt: "2026-07-13T08:15:00.000Z" }, 30, Date.parse("2026-07-13T08:00:00Z")), "Leave by 9:15am");
});

test("recommendation roster keeps one live representative per researched break and excludes favorite breaks", () => {
  const cameras = [
    { id: "meo-ribeira", name: "Ribeira cam", streamUrl: "https://example.test/live.m3u8" },
    { id: "surfline-ribeira", name: "Ribeira report", surfline: { pageUrl: "https://example.test/report" } },
    { id: "meo-lagide", name: "Lagide cam", streamUrl: "https://example.test/lagide.m3u8" },
    { id: "surfline-unresearched", name: "Unresearched" },
    { id: "guide", name: "Guide", adviceGuideOnly: true }
  ];
  const subjects = new Map([
    ["meo-ribeira", "surfline-ribeira"],
    ["surfline-ribeira", "surfline-ribeira"],
    ["meo-lagide", "surfline-lagide"]
  ]);

  const result = selectRecommendationCameras(cameras, {
    subjectIdFor: (camera) => subjects.get(camera.id) || null,
    inFence: () => true,
    isFavorite: (camera) => camera.id === "surfline-ribeira"
  });

  assert.deepEqual(result.map((camera) => camera.id), ["meo-lagide"]);
});

test("recommendation roster prefers a live camera over a duplicate report", () => {
  const cameras = [
    { id: "surfline-ribeira", name: "Ribeira report", surfline: { pageUrl: "https://example.test/report" } },
    { id: "meo-ribeira", name: "Ribeira cam", streamUrl: "https://example.test/live.m3u8" }
  ];

  const result = selectRecommendationCameras(cameras, {
    subjectIdFor: () => "surfline-ribeira",
    inFence: () => true,
    isFavorite: () => false
  });

  assert.deepEqual(result.map((camera) => camera.id), ["meo-ribeira"]);
});

test("Best bets is a decisive top-three shortlist", () => {
  const recommendations = [1, 2, 3, 4, 5].map((rank) => ({ rank }));
  assert.deepEqual(shortlistBestBets(recommendations).map(({ rank }) => rank), [1, 2, 3]);
  assert.deepEqual(shortlistBestBets(recommendations, 2).map(({ rank }) => rank), [1, 2]);
});

test("Might be good owns separate Best bets and collapsed Worth checking surfaces", () => {
  assert.match(indexSource, /id="todayRecommendations"/);
  assert.match(indexSource, /<h2[^>]*>Best bets<\/h2>/);
  assert.match(indexSource, /<details[^>]*id="worthChecking"/);
  assert.doesNotMatch(indexSource.match(/<details[^>]*id="worthChecking"[^>]*>/)?.[0] || "", /\sopen(?:\s|>)/);
  assert.match(indexSource, /id="bestBetsList"/);
  assert.match(indexSource, /id="worthCheckingList"/);
  assert.match(indexSource, /name="setupMinutes"/);
});

test("main renders decision records with timeline evidence instead of the legacy binary sorter", () => {
  assert.match(mainSource, /recommendTodaySpots/);
  assert.match(mainSource, /recommendationAdviceFor/);
  assert.match(mainSource, /findNearestTideSnapshot/);
  assert.match(mainSource, /function renderTodayRecommendations/);
  assert.match(mainSource, /function createBestBetCard/);
  assert.match(mainSource, /function createTodayTimeline/);
  assert.match(mainSource, /No trustworthy Best bets for the rest of today\./);
  assert.match(mainSource, /No fresh hourly forecast — cannot make a trustworthy call\./);
  assert.match(mainSource, /Forecast loaded, but every researched spot misses a hard gate\./);
  assert.doesNotMatch(mainSource, /mightBeGoodCameras\(/);
  assert.doesNotMatch(mainSource, /bestNearMiss\(/);
  assert.match(mainSource, /Best bets require fresh Surfline conditions/);
  assert.match(mainSource, /state\.monitorMode === "might-be-good"\s*\? els\.todayRecommendations\s*:\s*els\.monitorGrid/);
});

test("today cards expose confidence, no more than three reasons, and accessible hourly controls", () => {
  assert.match(mainSource, /recommendation\.reasons\.slice\(0, 3\)/);
  assert.match(mainSource, /recommendation\.confidence/);
  assert.match(mainSource, /recommendation\.bestWindow\.representativeHour/);
  assert.match(mainSource, /button\.setAttribute\("aria-label"/);
  assert.match(mainSource, /details\.dataset\.selectedTime/);
  assert.match(mainSource, /Open Surfline report|Watch live cam/);
  assert.match(mainSource, /summary\.textContent = "Hourly forecast & evidence"/);
  assert.doesNotMatch(mainSource, /const shell = document\.createElement\("section"\);\s*shell\.className = "recommendation-timeline"/);
});

test("today recommendation styles are focused, keyboard-visible, and mobile-scrollable", () => {
  for (const selector of [
    ".today-recommendations",
    ".best-bet-card",
    ".today-timeline",
    ".today-timeline__hour",
    ".worth-checking",
    ".recommendation-confidence"
  ]) {
    assert.match(styleSource, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styleSource, /\.today-timeline__hour\s*{[^}]*min-height:\s*44px/s);
  assert.match(styleSource, /\.today-timeline__hour:focus-visible/);
  assert.match(styleSource, /\.recommendation-timeline\s*>\s*summary:focus-visible/);
  assert.match(styleSource, /\.today-timeline\s*{[^}]*overflow-x:\s*auto/s);
});

test("recommendation cards and Configure expose private session feedback controls", () => {
  assert.match(mainSource, /createSessionFeedbackDisclosure/);
  assert.match(mainSource, /How was it\?/);
  assert.match(mainSource, /addSessionFeedback/);
  assert.match(indexSource, /id="exportSessionFeedback"/);
  assert.match(indexSource, /id="importSessionFeedback"/);
  assert.match(indexSource, /Stored only in this browser/);
  assert.match(styleSource, /\.session-feedback/);
  assert.match(styleSource, /\.feedback-tools/);
});
