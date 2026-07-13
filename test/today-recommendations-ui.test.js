import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  formatLeaveCall,
  formatLisbonTime,
  formatWindowCall
} from "../src/today-recommendations-ui.js";

const indexSource = fs.readFileSync("index.html", "utf8");
const mainSource = fs.readFileSync("src/main.js", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");

test("today recommendation time calls use Lisbon time and actionable departure language", () => {
  const window = { start: "2026-07-13T09:15:00.000Z", end: "2026-07-13T10:30:00.000Z" };

  assert.equal(formatLisbonTime(window.start), "10:15am");
  assert.equal(formatWindowCall(window, Date.parse("2026-07-13T09:05:00Z")), "Go now · 10:15am–11:30am");
  assert.equal(formatWindowCall(window, Date.parse("2026-07-13T08:00:00Z")), "Best 10:15am–11:30am");
  assert.equal(formatLeaveCall(window, 30, Date.parse("2026-07-13T08:00:00Z")), "Leave by 9:45am");
  assert.equal(formatLeaveCall(window, 30, Date.parse("2026-07-13T08:50:00Z")), "Leave now");
  assert.equal(formatLeaveCall(window, null, Date.parse("2026-07-13T08:00:00Z")), null);
});

test("Might be good owns separate Best bets and collapsed Worth checking surfaces", () => {
  assert.match(indexSource, /id="todayRecommendations"/);
  assert.match(indexSource, /<h2[^>]*>Best bets<\/h2>/);
  assert.match(indexSource, /<details[^>]*id="worthChecking"/);
  assert.doesNotMatch(indexSource.match(/<details[^>]*id="worthChecking"[^>]*>/)?.[0] || "", /\sopen(?:\s|>)/);
  assert.match(indexSource, /id="bestBetsList"/);
  assert.match(indexSource, /id="worthCheckingList"/);
});

test("main renders decision records with timeline evidence instead of the legacy binary sorter", () => {
  assert.match(mainSource, /recommendTodaySpots/);
  assert.match(mainSource, /recommendationAdviceFor/);
  assert.match(mainSource, /function renderTodayRecommendations/);
  assert.match(mainSource, /function createBestBetCard/);
  assert.match(mainSource, /function createTodayTimeline/);
  assert.match(mainSource, /No trustworthy Best bets for the rest of today\./);
  assert.match(mainSource, /No fresh hourly forecast — cannot make a trustworthy call\./);
  assert.match(mainSource, /Forecast loaded, but every researched spot misses a hard gate\./);
  assert.doesNotMatch(mainSource, /mightBeGoodCameras\(/);
  assert.doesNotMatch(mainSource, /bestNearMiss\(/);
});

test("today cards expose confidence, no more than three reasons, and accessible hourly controls", () => {
  assert.match(mainSource, /recommendation\.reasons\.slice\(0, 3\)/);
  assert.match(mainSource, /recommendation\.confidence/);
  assert.match(mainSource, /button\.setAttribute\("aria-label"/);
  assert.match(mainSource, /details\.dataset\.selectedTime/);
  assert.match(mainSource, /Open Surfline report|Watch live cam/);
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
  assert.match(styleSource, /\.today-timeline\s*{[^}]*overflow-x:\s*auto/s);
});
