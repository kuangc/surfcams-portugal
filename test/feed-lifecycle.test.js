import assert from "node:assert/strict";
import test from "node:test";

import { createGalleryPreviewSession } from "../src/feed-lifecycle.js";

function createTimerHarness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const scheduledDelays = [];

  function setTimer(callback, delay) {
    const id = nextId;
    nextId += 1;
    scheduledDelays.push(delay);
    timers.set(id, { callback, dueAt: now + delay });
    return id;
  }

  function clearTimer(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const target = now + ms;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  }

  return {
    advance,
    clearTimer,
    pendingCount: () => timers.size,
    scheduledDelays,
    setTimer
  };
}

function createFakePlayer() {
  let currentState = "idle";
  const calls = [];
  return {
    calls,
    clear() {
      calls.push(["clear"]);
      currentState = "idle";
    },
    expire() {
      calls.push(["expire"]);
      currentState = "expired";
    },
    play(camera) {
      calls.push(["play", camera.id]);
      currentState = "playing";
      return Promise.resolve(currentState);
    },
    state() {
      return currentState;
    }
  };
}

function createSession(options = {}) {
  const timers = createTimerHarness();
  const player = createFakePlayer();
  const camera = { id: "fixture", streamUrl: "https://example.com/fixture.m3u8" };
  const session = createGalleryPreviewSession({
    camera,
    player,
    durationMs: 60_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...options
  });
  return { camera, player, session, timers };
}

test("a visible gallery preview plays once and expires after exactly 60 seconds", () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  timers.advance(0);

  assert.deepEqual(player.calls, [["play", "fixture"]]);
  assert.equal(session.state(), "playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);
  assert.equal(timers.pendingCount(), 1);

  timers.advance(59_999);
  assert.equal(session.state(), "playing");
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);

  timers.advance(1);
  assert.equal(session.state(), "expired");
  assert.deepEqual(player.calls.at(-1), ["expire"]);
  assert.equal(timers.pendingCount(), 0);
});

test("restart works only after expiry and grants a fresh 60-second preview", () => {
  const { player, session, timers } = createSession();

  assert.equal(session.restart(), false);
  session.setVisible(true);
  timers.advance(0);
  assert.equal(session.restart(), false);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 1);

  timers.advance(60_000);
  assert.equal(session.restart(), true);
  timers.advance(0);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
  assert.equal(session.state(), "playing");

  timers.advance(59_999);
  assert.equal(session.state(), "playing");
  timers.advance(1);
  assert.equal(session.state(), "expired");
});

test("leaving the viewport clears playback and re-entry starts a fresh preview", () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  timers.advance(0);
  timers.advance(15_000);
  session.setVisible(false);

  assert.equal(session.state(), "idle");
  assert.deepEqual(player.calls.at(-1), ["clear"]);
  assert.equal(timers.pendingCount(), 0);

  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);

  session.setVisible(true);
  timers.advance(0);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
  assert.equal(timers.scheduledDelays.at(-1), 60_000);
  assert.equal(timers.pendingCount(), 1);
});

test("clear cancels both a delayed start and an active expiry without parallel timers", () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  assert.equal(timers.pendingCount(), 1);
  session.clear();
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "play"), false);
  assert.equal(timers.pendingCount(), 0);

  session.setVisible(true);
  timers.advance(0);
  assert.equal(timers.pendingCount(), 1);
  session.clear();
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);
  assert.equal(session.state(), "idle");
});

test("a hidden document does not start until visibility is re-evaluated", () => {
  let documentVisible = false;
  const { player, session, timers } = createSession({
    isDocumentVisible: () => documentVisible
  });

  session.setVisible(true);
  timers.advance(0);
  assert.deepEqual(player.calls, []);
  assert.equal(timers.pendingCount(), 0);
  assert.equal(session.state(), "idle");

  documentVisible = true;
  session.setVisible(true);
  timers.advance(0);
  assert.deepEqual(player.calls, [["play", "fixture"]]);
  assert.equal(session.state(), "playing");
});
