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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createControllablePlayer() {
  let currentState = "idle";
  const calls = [];
  const pendingPlays = [];
  const pendingResumes = [];
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
      const pending = deferred();
      pendingPlays.push(pending);
      return pending.promise;
    },
    resume() {
      calls.push(["resume"]);
      const pending = deferred();
      pendingResumes.push(pending);
      return pending.promise;
    },
    resolveNext(nextState) {
      currentState = nextState;
      pendingPlays.shift()?.resolve(nextState);
    },
    rejectNextResume() {
      pendingResumes.shift()?.reject(new Error("manual play stayed blocked"));
    },
    resolveNextResume(nextState) {
      currentState = nextState;
      pendingResumes.shift()?.resolve(nextState);
    },
    state() {
      return currentState;
    }
  };
}

function createSession({ player = createFakePlayer(), ...options } = {}) {
  const timers = createTimerHarness();
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

test("a visible gallery preview plays once and expires after exactly 60 seconds", async () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  timers.advance(0);
  await Promise.resolve();

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

test("restart works only after expiry and grants a fresh 60-second preview", async () => {
  const { player, session, timers } = createSession();

  assert.equal(session.restart(), false);
  session.setVisible(true);
  timers.advance(0);
  await Promise.resolve();
  assert.equal(session.restart(), false);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 1);

  timers.advance(60_000);
  assert.equal(session.restart(), true);
  timers.advance(0);
  await Promise.resolve();
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
  assert.equal(session.state(), "playing");

  timers.advance(59_999);
  assert.equal(session.state(), "playing");
  timers.advance(1);
  assert.equal(session.state(), "expired");
});

test("leaving the viewport clears playback and re-entry starts a fresh preview", async () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  timers.advance(0);
  await Promise.resolve();
  timers.advance(15_000);
  session.setVisible(false);

  assert.equal(session.state(), "idle");
  assert.deepEqual(player.calls.at(-1), ["clear"]);
  assert.equal(timers.pendingCount(), 0);

  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);

  session.setVisible(true);
  timers.advance(0);
  await Promise.resolve();
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
  assert.equal(timers.scheduledDelays.at(-1), 60_000);
  assert.equal(timers.pendingCount(), 1);
});

test("clear cancels both a delayed start and an active expiry without parallel timers", async () => {
  const { player, session, timers } = createSession();

  session.setVisible(true);
  assert.equal(timers.pendingCount(), 1);
  session.clear();
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "play"), false);
  assert.equal(timers.pendingCount(), 0);

  session.setVisible(true);
  timers.advance(0);
  await Promise.resolve();
  assert.equal(timers.pendingCount(), 1);
  session.clear();
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);
  assert.equal(session.state(), "idle");
});

test("a hidden document does not start until visibility is re-evaluated", async () => {
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
  await Promise.resolve();
  assert.deepEqual(player.calls, [["play", "fixture"]]);
  assert.equal(session.state(), "playing");
});

test("a blocked play result cancels preview expiry and becomes retryable", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  assert.equal(session.state(), "loading");
  assert.equal(timers.pendingCount(), 0);

  player.resolveNext("blocked");
  await Promise.resolve();

  assert.equal(session.state(), "blocked");
  assert.equal(timers.pendingCount(), 0);
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);
});

test("an unavailable play result cancels preview expiry", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("unavailable");
  await Promise.resolve();

  assert.equal(session.state(), "unavailable");
  assert.equal(timers.pendingCount(), 0);
  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);
});

test("retry from blocked or unavailable owns a fresh full successful preview", async () => {
  for (const failedState of ["blocked", "unavailable"]) {
    const player = createControllablePlayer();
    const { session, timers } = createSession({ player });

    session.setVisible(true);
    timers.advance(0);
    player.resolveNext(failedState);
    await Promise.resolve();

    assert.equal(typeof session.retry, "function");
    assert.equal(session.retry(), true);
    timers.advance(0);
    assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
    assert.equal(timers.scheduledDelays.at(-1), 0);
    assert.equal(timers.pendingCount(), 0);

    player.resolveNext("playing");
    await Promise.resolve();
    assert.equal(session.state(), "playing");
    assert.equal(timers.pendingCount(), 1);

    timers.advance(59_999);
    assert.equal(session.state(), "playing");
    timers.advance(1);
    assert.equal(session.state(), "expired");
  }
});

test("manual resume calls the player synchronously and grants a fresh exact 60-second preview", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("blocked");
  await Promise.resolve();

  assert.equal(session.resume(), true);
  assert.deepEqual(player.calls.at(-1), ["resume"]);
  assert.equal(timers.pendingCount(), 0);

  player.resolveNextResume("playing");
  await Promise.resolve();
  assert.equal(session.state(), "playing");
  assert.equal(timers.scheduledDelays.at(-1), 60_000);
  assert.equal(timers.pendingCount(), 1);

  timers.advance(59_999);
  assert.equal(session.state(), "playing");
  timers.advance(1);
  assert.equal(session.state(), "expired");
});

test("a failed manual resume remains blocked and can be resumed again", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("blocked");
  await Promise.resolve();

  assert.equal(session.resume(), true);
  player.rejectNextResume();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(session.state(), "blocked");
  assert.equal(timers.pendingCount(), 0);
  assert.equal(session.resume(), true);
  assert.equal(player.calls.filter(([operation]) => operation === "resume").length, 2);
});

test("clearing or hiding a preview makes late manual-resume settlement inert", async () => {
  for (const stop of [
    (session) => session.clear(),
    (session) => session.setVisible(false)
  ]) {
    const player = createControllablePlayer();
    const { session, timers } = createSession({ player });

    session.setVisible(true);
    timers.advance(0);
    player.resolveNext("blocked");
    await Promise.resolve();
    assert.equal(session.resume(), true);

    stop(session);
    player.resolveNextResume("playing");
    await Promise.resolve();

    assert.equal(session.state(), "idle");
    assert.equal(timers.pendingCount(), 0);
  }
});

test("a late player failure reconciles the session and retry owns a fresh preview", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();
  assert.equal(session.state(), "playing");
  assert.equal(timers.pendingCount(), 1);

  assert.equal(typeof session.reconcilePlayerState, "function");
  session.reconcilePlayerState("unavailable");
  assert.equal(session.state(), "unavailable");
  assert.equal(timers.pendingCount(), 0);

  assert.equal(session.retry(), true);
  timers.advance(0);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 2);
  assert.equal(timers.scheduledDelays.at(-1), 0);

  player.resolveNext("playing");
  await Promise.resolve();
  assert.equal(session.state(), "playing");
  assert.equal(timers.pendingCount(), 1);
});

test("leaving or clearing during pending play ignores its late result", async () => {
  for (const stop of [
    (session) => session.setVisible(false),
    (session) => session.clear()
  ]) {
    const player = createControllablePlayer();
    const { session, timers } = createSession({ player });

    session.setVisible(true);
    timers.advance(0);
    assert.equal(session.state(), "loading");
    assert.equal(timers.pendingCount(), 0);

    stop(session);
    assert.equal(session.state(), "idle");
    assert.equal(timers.pendingCount(), 0);

    player.resolveNext("playing");
    await Promise.resolve();
    assert.equal(session.state(), "idle");
    assert.equal(timers.pendingCount(), 0);
  }
});

test("gallery starts its exact minute only after playback reaches playing", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);

  assert.equal(session.state(), "loading");
  assert.deepEqual(timers.scheduledDelays, [0]);
  assert.equal(timers.pendingCount(), 0);

  player.resolveNext("playing");
  await Promise.resolve();

  assert.equal(session.state(), "playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);
  assert.equal(timers.pendingCount(), 1);
});

test("midstream loading and successful replacement keep the original deadline", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(20_000);
  assert.equal(session.reconcilePlayerState("loading"), true);
  assert.equal(session.state(), "loading");
  assert.equal(timers.pendingCount(), 1);

  timers.advance(15_000);
  assert.equal(session.reconcilePlayerState("playing"), true);
  assert.equal(session.state(), "playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);

  timers.advance(24_999);
  assert.equal(session.state(), "playing");
  timers.advance(1);
  assert.equal(session.state(), "expired");
  assert.deepEqual(player.calls.at(-1), ["expire"]);
});

test("midstream autoplay blocking and manual resume use only the original remaining time", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(20_000);
  assert.equal(session.reconcilePlayerState("loading"), true);
  timers.advance(10_000);
  assert.equal(session.reconcilePlayerState("blocked"), true);
  assert.equal(session.resume(), true);
  assert.equal(session.state(), "resuming");
  assert.equal(timers.pendingCount(), 1);

  timers.advance(10_000);
  player.resolveNextResume("playing");
  await Promise.resolve();
  assert.equal(session.state(), "playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);

  timers.advance(19_999);
  assert.equal(session.state(), "playing");
  timers.advance(1);
  assert.equal(session.state(), "expired");
});

test("retry cannot mint a fresh minute for an active blocked window", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(30_000);
  session.reconcilePlayerState("blocked");
  assert.equal(session.retry(), false);
  assert.equal(timers.pendingCount(), 1);
  assert.equal(player.calls.filter(([operation]) => operation === "play").length, 1);

  timers.advance(30_000);
  assert.equal(session.state(), "expired");
});

test("synchronous player notifications cannot schedule a second preview timer", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  assert.equal(session.reconcilePlayerState("playing"), false);
  player.resolveNext("playing");
  await Promise.resolve();

  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);
  session.reconcilePlayerState("loading");
  session.reconcilePlayerState("playing");
  assert.deepEqual(timers.scheduledDelays, [0, 60_000]);
});

test("expiry while loading makes a later replacement notification inert", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(50_000);
  session.reconcilePlayerState("loading");
  timers.advance(10_000);
  assert.equal(session.state(), "expired");
  assert.equal(session.reconcilePlayerState("playing"), false);
  assert.equal(session.state(), "expired");
  assert.equal(timers.pendingCount(), 0);
});

test("terminal unavailable during recovery cancels the active deadline", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(25_000);
  session.reconcilePlayerState("loading");
  assert.equal(session.reconcilePlayerState("unavailable"), true);
  assert.equal(session.state(), "unavailable");
  assert.equal(timers.pendingCount(), 0);

  timers.advance(60_000);
  assert.equal(player.calls.some(([operation]) => operation === "expire"), false);
  assert.equal(session.retry(), true);
});

test("expiry during pending recovery stops the player and makes its late settlement inert", async () => {
  const player = createControllablePlayer();
  const { session, timers } = createSession({ player });

  session.setVisible(true);
  timers.advance(0);
  player.resolveNext("playing");
  await Promise.resolve();

  timers.advance(45_000);
  session.reconcilePlayerState("loading");
  session.reconcilePlayerState("blocked");
  assert.equal(session.resume(), true);

  timers.advance(15_000);
  assert.equal(session.state(), "expired");
  assert.deepEqual(player.calls.at(-1), ["expire"]);

  player.resolveNextResume("playing");
  await Promise.resolve();
  assert.equal(session.state(), "expired");
  assert.equal(timers.pendingCount(), 0);
});
