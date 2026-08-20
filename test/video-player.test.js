import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createFeedTilePlayer,
  createVideoGestures
} from "../src/video-player.js";

const SIGNED_URL = "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8?wmsAuthSign=signed";
const REPLACEMENT_URL = "https://video-auth1.iol.pt/auth-beachcam/riviera/playlist.m3u8?wmsAuthSign=replacement";

function playbackClientStub({
  resolvedUrl = SIGNED_URL,
  revision = "revision-1"
} = {}) {
  const calls = [];
  return {
    calls,
    async resolve(cameraId) {
      calls.push(["resolve", cameraId]);
      return {
        cameraId,
        playlistUrl: resolvedUrl,
        revision,
        refreshAt: "2099-01-01T00:00:00.000Z"
      };
    },
    async refresh(cameraId, failedRevision) {
      calls.push(["refresh", cameraId, failedRevision]);
      return {
        cameraId,
        playlistUrl: resolvedUrl.replace("signed", "replacement"),
        revision: "revision-2",
        refreshAt: "2099-01-01T00:00:00.000Z"
      };
    }
  };
}

function camera(id = "camera-a", image = "poster.jpg") {
  return {
    id,
    name: `Camera ${id}`,
    image,
    streamUrl: `https://video-auth1.iol.pt/beachcam/${id}/playlist.m3u8`
  };
}

function playbackRecord(cameraId, {
  playlistUrl = SIGNED_URL,
  revision = "revision-1"
} = {}) {
  return {
    cameraId,
    playlistUrl,
    revision,
    refreshAt: "2099-01-01T00:00:00.000Z"
  };
}

async function waitFor(predicate, message = "condition was not reached") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

async function assertPending(promise) {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
}

function callCount(client, method) {
  return client.calls.filter(([name]) => name === method).length;
}

function videoStub() {
  const listeners = new Map();
  return {
    poster: "",
    src: "",
    paused: true,
    canPlayType() {
      return "probably";
    },
    loadCalled: false,
    playCalled: false,
    pause() {
      this.paused = true;
    },
    load() {
      this.loadCalled = true;
    },
    play() {
      this.playCalled = true;
      this.paused = false;
      return Promise.resolve();
    },
    removeAttribute(name) {
      if (name === "src") this.src = "";
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      [...(listeners.get(type) || [])].forEach((listener) => listener({ type, target: this }));
    },
    listeners(type) {
      return [...(listeners.get(type) || [])];
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

function createHlsStub() {
  return class HlsStub {
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifestParsed" };
    static instances = [];

    static isSupported() {
      return true;
    }

    constructor() {
      this.handlers = new Map();
      this.attached = false;
      this.destroyed = false;
      HlsStub.instances.push(this);
    }

    loadSource(source) {
      this.source = source;
    }

    attachMedia(video) {
      this.attached = true;
      this.video = video;
    }

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    destroy() {
      this.destroyed = true;
    }

    emit(event, data = {}) {
      this.handlers.get(event)?.(null, data);
    }
  };
}

test("a failed shared HLS script load is removed and can be retried", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const scripts = [];
  globalThis.window = {};
  globalThis.document = {
    createElement() {
      return {
        removeCalled: false,
        remove() {
          this.removeCalled = true;
        }
      };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
      }
    }
  };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const status = { textContent: "" };
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({
      video,
      status,
      playbackClient,
      hlsScriptUrl: "https://example.com/hls.js"
    });

    const first = player.play(camera());
    await waitFor(() => scripts.length === 1);
    scripts[0].onerror();
    assert.equal(await first, "unavailable");
    assert.equal(scripts[0].removeCalled, true);
    assert.equal(callCount(playbackClient, "refresh"), 0);

    const HlsStub = createHlsStub();
    const second = player.play(camera());
    await waitFor(() => scripts.length === 2);
    assert.equal(scripts.length, 2, "retry injects a fresh loader");
    globalThis.window.Hls = HlsStub;
    scripts[1].onload();
    await waitFor(() => HlsStub.instances.length === 1);
    assert.equal(HlsStub.instances[0].source === SIGNED_URL, true);
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
    assert.equal(await second, "playing");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

function gestureVideoStub({ width = 800, height = 450 } = {}) {
  const video = videoStub();
  const listeners = new Map();
  const capturedPointers = [];

  video.style = {};
  video.dataset = {};
  video.controls = true;
  video.clientWidth = width;
  video.clientHeight = height;
  video.addEventListener = (type, listener) => {
    const handlers = listeners.get(type) || [];
    handlers.push(listener);
    listeners.set(type, handlers);
  };
  video.removeEventListener = (type, listener) => {
    listeners.set(type, (listeners.get(type) || []).filter((handler) => handler !== listener));
  };
  video.getBoundingClientRect = () => {
    const transform = video.style.transform || "";
    const translation = transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/);
    const scaleMatch = transform.match(/scale\(([-\d.]+)\)/);
    const x = Number(translation?.[1] || 0);
    const y = Number(translation?.[2] || 0);
    const scale = Number(scaleMatch?.[1] || 1);
    return {
      left: ((width - (width * scale)) / 2) + x,
      top: ((height - (height * scale)) / 2) + y,
      width: width * scale,
      height: height * scale
    };
  };
  video.capturedPointers = capturedPointers;
  video.setPointerCapture = (pointerId) => capturedPointers.push(pointerId);
  video.releasePointerCapture = () => {};
  video.dispatch = (type, init = {}) => {
    const event = {
      pointerId: init.pointerId,
      pointerType: init.pointerType || "touch",
      clientX: init.clientX || 0,
      clientY: init.clientY || 0,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    (listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  };

  return video;
}

function createGestures(video, options = {}) {
  return createVideoGestures({ video, ...options });
}

function pinchToDoubleSize(video) {
  video.dispatch("pointerdown", { pointerId: 1, clientX: 300, clientY: 225 });
  video.dispatch("pointerdown", { pointerId: 2, clientX: 500, clientY: 225 });
  video.dispatch("pointermove", { pointerId: 1, clientX: 200, clientY: 225 });
  return video.dispatch("pointermove", { pointerId: 2, clientX: 600, clientY: 225 });
}

test("video pinch zoom works in a landscape viewport", () => {
  const video = gestureVideoStub({ width: 800, height: 450 });
  const gestures = createGestures(video);

  const move = pinchToDoubleSize(video);

  assert.equal(move.defaultPrevented, true);
  assert.equal(gestures.state().scale, 2);
  assert.match(video.style.transform, /scale\(2\)/);
});

test("a zoomed video pans with one finger", () => {
  const video = gestureVideoStub({ width: 800, height: 450 });
  const gestures = createGestures(video);
  pinchToDoubleSize(video);
  video.dispatch("pointerup", { pointerId: 2, clientX: 600, clientY: 225 });

  const move = video.dispatch("pointermove", { pointerId: 1, clientX: 350, clientY: 225 });

  assert.equal(move.defaultPrevented, true);
  assert.equal(gestures.state().x, 150);
  assert.match(video.style.transform, /translate3d\(150px, 0px, 0\)/);
});

test("panning clamps against the untransformed video viewport", () => {
  const video = gestureVideoStub({ width: 800, height: 450 });
  const gestures = createGestures(video);
  pinchToDoubleSize(video);
  video.dispatch("pointerup", { pointerId: 2, clientX: 600, clientY: 225 });

  video.dispatch("pointermove", { pointerId: 1, clientX: 1_200, clientY: 225 });

  assert.equal(gestures.state().x, 400);
});

test("a single touch at default zoom leaves native video controls alone", () => {
  const video = gestureVideoStub();
  createGestures(video);

  const down = video.dispatch("pointerdown", { pointerId: 1, clientX: 400, clientY: 400 });

  assert.equal(down.defaultPrevented, false);
  assert.deepEqual(video.capturedPointers, []);
  assert.equal(video.controls, true);
});

test("native controls are restored after leaving the transformed zoom view", () => {
  const video = gestureVideoStub();
  const gestures = createGestures(video);

  pinchToDoubleSize(video);
  assert.equal(video.controls, false);

  gestures.reset();
  assert.equal(video.controls, true);
});

test("panning a video suppresses the monitor tile restart click", () => {
  const video = gestureVideoStub({ width: 800, height: 450 });
  createGestures(video);
  pinchToDoubleSize(video);
  video.dispatch("pointerup", { pointerId: 2, clientX: 600, clientY: 225 });
  video.dispatch("pointermove", { pointerId: 1, clientX: 350, clientY: 225 });
  video.dispatch("pointerup", { pointerId: 1, clientX: 350, clientY: 225 });

  const click = video.dispatch("click");

  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);
});

test("gesture click suppression expires before a later intentional control tap", () => {
  let now = 1_000;
  const video = gestureVideoStub({ width: 800, height: 450 });
  createGestures(video, { now: () => now });
  pinchToDoubleSize(video);
  video.dispatch("pointerup", { pointerId: 2, clientX: 600, clientY: 225 });
  video.dispatch("pointermove", { pointerId: 1, clientX: 350, clientY: 225 });
  video.dispatch("pointerup", { pointerId: 1, clientX: 350, clientY: 225 });
  now += 1_000;

  const click = video.dispatch("click");

  assert.equal(click.defaultPrevented, false);
  assert.equal(click.propagationStopped, false);
});

test("monitor frames clip a zoomed video to its viewport", () => {
  const styles = fs.readFileSync("src/styles/app.css", "utf8");

  assert.match(styles, /\.feed-frame\s*{[^}]*overflow:\s*hidden/s);
});

test("createFeedTilePlayer requires a camera ID rather than a direct stream", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const playbackClient = playbackClientStub();
  const player = createFeedTilePlayer({ video, status, playbackClient });

  const result = player.play({
    name: "No ID",
    streamUrl: "https://video-auth1.iol.pt/beachcam/unsigned/playlist.m3u8"
  });

  assert.equal(await result, "unavailable");
  assert.equal(status.textContent, "Feed unavailable");
  assert.equal(player.state(), "unavailable");
  assert.equal(callCount(playbackClient, "resolve"), 0);
  assert.equal(video.src.length === 0, true);
});

test("native HLS receives only the exact broker URL", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const playbackClient = playbackClientStub();
  const player = createFeedTilePlayer({ video, status, playbackClient });

  assert.equal(await player.play(camera()), "playing");

  assert.equal(video.src === SIGNED_URL, true);
  assert.equal(video.src === camera().streamUrl, false);
  assert.equal(video.poster, "poster.jpg");
  assert.equal(status.textContent, "Playing");
  assert.equal(player.state(), "playing");
  assert.equal(playbackClient.calls[0][0], "resolve");
  assert.equal(playbackClient.calls[0][1], "camera-a");
});

test("a camera ID is sufficient for broker playback", async () => {
  const video = videoStub();
  const playbackClient = playbackClientStub();
  const player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient
  });

  assert.equal(await player.play({ id: "camera-a", image: "poster.jpg" }), "playing");
  assert.equal(video.src === SIGNED_URL, true);
  assert.equal(callCount(playbackClient, "resolve"), 1);
});

test("hls.js receives only the exact broker URL", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({
      video,
      status: { textContent: "" },
      playbackClient
    });

    const result = player.play(camera());
    await waitFor(() => HlsStub.instances.length === 1);
    assert.equal(HlsStub.instances[0].source === SIGNED_URL, true);
    assert.equal(HlsStub.instances[0].source === camera().streamUrl, false);
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);

    assert.equal(await result, "playing");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("camera replacement synchronously detaches old media before resolving the new source", async () => {
  const pendingSecond = deferred();
  const playbackClient = playbackClientStub();
  playbackClient.resolve = async (cameraId) => {
    playbackClient.calls.push(["resolve", cameraId]);
    if (cameraId === "camera-b") return pendingSecond.promise;
    return playbackRecord(cameraId);
  };
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status, playbackClient });
  await player.play(camera("camera-a", "a.jpg"));

  video.loadCalled = false;
  const second = player.play(camera("camera-b", "b.jpg"));

  assert.equal(video.paused, true);
  assert.equal(video.src.length === 0, true);
  assert.equal(video.poster, "b.jpg");
  assert.equal(video.loadCalled, true);
  assert.equal(status.textContent, "Loading");
  assert.equal(player.state(), "loading");
  pendingSecond.resolve(playbackRecord("camera-b", { playlistUrl: REPLACEMENT_URL }));
  assert.equal(await second, "playing");
  assert.equal(video.src === REPLACEMENT_URL, true);
});

test("a synchronous state callback replacement cannot settle the new generation", async () => {
  const pendingSecond = deferred();
  const playbackClient = playbackClientStub();
  playbackClient.resolve = async (cameraId) => {
    playbackClient.calls.push(["resolve", cameraId]);
    if (cameraId === "camera-b") return pendingSecond.promise;
    return playbackRecord(cameraId);
  };
  let player;
  let secondResult;
  let replaced = false;
  player = createFeedTilePlayer({
    video: videoStub(),
    status: { textContent: "" },
    playbackClient,
    onStateChange(state) {
      if (state !== "playing" || replaced) return;
      replaced = true;
      secondResult = player.play(camera("camera-b"));
    }
  });

  const firstResult = player.play(camera());
  await waitFor(() => Boolean(secondResult));

  assert.equal(await firstResult, "idle");
  await assertPending(secondResult);
  assert.equal(player.state(), "loading");
  pendingSecond.resolve(playbackRecord("camera-b", { playlistUrl: REPLACEMENT_URL }));
  assert.equal(await secondResult, "playing");
});

test("a fatal event started by the playing callback owns the pending play settlement", async () => {
  const pendingRefresh = deferred();
  const playbackClient = playbackClientStub();
  playbackClient.refresh = async (cameraId, failedRevision) => {
    playbackClient.calls.push(["refresh", cameraId, failedRevision]);
    return pendingRefresh.promise;
  };
  const video = videoStub();
  const status = { textContent: "" };
  let player;
  let startedRecovery = false;
  player = createFeedTilePlayer({
    video,
    status,
    playbackClient,
    onStateChange(state) {
      if (state !== "playing" || startedRecovery) return;
      startedRecovery = true;
      video.dispatch("error");
    }
  });

  const result = player.play(camera());
  await waitFor(() => callCount(playbackClient, "refresh") === 1);

  assert.equal(player.state(), "loading");
  assert.equal(status.textContent, "Refreshing feed");
  await assertPending(result);
  pendingRefresh.resolve(playbackRecord("camera-a", { playlistUrl: REPLACEMENT_URL }));

  assert.equal(await result, "playing");
  assert.equal(player.state(), "playing");
});

test("a resume created by the blocked callback is not settled by the autoplay transition", async () => {
  const pendingResume = deferred();
  let playCount = 0;
  const video = videoStub();
  video.play = () => {
    playCount += 1;
    return playCount === 1
      ? Promise.reject(new Error("autoplay blocked"))
      : pendingResume.promise;
  };
  let player;
  let resumeResult;
  player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient: playbackClientStub(),
    onStateChange(state) {
      if (state === "blocked" && !resumeResult) resumeResult = player.resume();
    }
  });

  const initialResult = player.play(camera());
  assert.equal(await initialResult, "blocked");
  assert.equal(playCount, 2);
  await assertPending(resumeResult);
  pendingResume.resolve();

  assert.equal(await resumeResult, "playing");
  assert.equal(player.state(), "playing");
});

test("broker resolve failure becomes unavailable without forcing a refresh", async () => {
  const playbackClient = playbackClientStub();
  playbackClient.resolve = async (cameraId) => {
    playbackClient.calls.push(["resolve", cameraId]);
    throw new Error("broker unavailable");
  };
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status, playbackClient });

  assert.equal(await player.play(camera()), "unavailable");
  assert.equal(player.state(), "unavailable");
  assert.equal(status.textContent, "Feed unavailable");
  assert.equal(callCount(playbackClient, "refresh"), 0);
  assert.equal(video.src.length === 0, true);
});

test("native and hls.js autoplay rejection are blocked without a refresh", async () => {
  for (const mode of ["native", "hls"]) {
    const previousWindow = globalThis.window;
    const HlsStub = createHlsStub();
    if (mode === "hls") globalThis.window = { Hls: HlsStub };
    try {
      const video = videoStub();
      if (mode === "hls") video.canPlayType = () => "";
      video.play = () => Promise.reject(new Error("autoplay blocked"));
      const status = { textContent: "" };
      const playbackClient = playbackClientStub();
      const player = createFeedTilePlayer({ video, status, playbackClient });

      const result = player.play(camera());
      if (mode === "hls") {
        await waitFor(() => HlsStub.instances.length === 1);
        HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
      }

      assert.equal(await result, "blocked");
      assert.equal(player.state(), "blocked");
      assert.equal(status.textContent, "Press play to start");
      assert.equal(callCount(playbackClient, "refresh"), 0);
    } finally {
      globalThis.window = previousWindow;
    }
  }
});

test("a later native media error refreshes once and attaches the replacement", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const states = [];
  const playbackClient = playbackClientStub();
  const player = createFeedTilePlayer({
    video,
    status,
    playbackClient,
    onStateChange: (state) => states.push(state)
  });
  await player.play(camera());

  video.dispatch("error");
  await waitFor(() => callCount(playbackClient, "refresh") === 1);
  await waitFor(() => player.state() === "playing");

  assert.equal(playbackClient.calls[1][0], "refresh");
  assert.equal(playbackClient.calls[1][1], "camera-a");
  assert.equal(playbackClient.calls[1][2] === "revision-1", true);
  assert.equal(video.src === REPLACEMENT_URL, true);
  assert.equal(states.includes("loading"), true);
  assert.equal(states.at(-1), "playing");
});

test("later caller mutation cannot redirect a fatal refresh to another camera", async () => {
  const selectedCamera = camera("camera-a");
  const playbackClient = playbackClientStub();
  const video = videoStub();
  const player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient
  });
  await player.play(selectedCamera);

  selectedCamera.id = "camera-b";
  video.dispatch("error");
  await waitFor(() => callCount(playbackClient, "refresh") === 1);
  await waitFor(() => player.state() === "playing");

  assert.equal(playbackClient.calls[1][1], "camera-a");
  assert.equal(video.src === REPLACEMENT_URL, true);
});

test("a synchronous lifecycle clear during the refreshing label cancels stale broker work", async () => {
  const playbackClient = playbackClientStub();
  const video = videoStub();
  const status = { textContent: "" };
  let player;
  player = createFeedTilePlayer({
    video,
    status,
    playbackClient,
    onStateChange() {
      if (status.textContent === "Refreshing feed") player.clear();
    }
  });
  await player.play(camera());

  video.dispatch("error");
  await Promise.resolve();

  assert.equal(player.state(), "idle");
  assert.equal(status.textContent, "Preview paused");
  assert.equal(callCount(playbackClient, "refresh"), 0);
});

test("a later fatal hls.js error refreshes once and attaches the replacement", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const status = { textContent: "" };
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({ video, status, playbackClient });
    const initial = player.play(camera());
    await waitFor(() => HlsStub.instances.length === 1);
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
    assert.equal(await initial, "playing");

    HlsStub.instances[0].emit(HlsStub.Events.ERROR, { fatal: true });
    await waitFor(() => HlsStub.instances.length === 2);

    assert.equal(HlsStub.instances[0].destroyed, true);
    assert.equal(HlsStub.instances[1].source === REPLACEMENT_URL, true);
    assert.equal(callCount(playbackClient, "refresh"), 1);
    HlsStub.instances[1].emit(HlsStub.Events.MANIFEST_PARSED);
    await waitFor(() => player.state() === "playing");
    assert.equal(status.textContent, "Playing");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("native initial-load recovery ignores the old autoplay settlement and follows the replacement", async () => {
  const scenarios = [
    { old: "resolve", final: "playing" },
    { old: "reject", final: "blocked" },
    { old: "resolve", final: "unavailable" }
  ];

  for (const scenario of scenarios) {
    const attempts = [deferred(), deferred()];
    let playCount = 0;
    const video = videoStub();
    video.play = () => attempts[playCount++].promise;
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({
      video,
      status: { textContent: "" },
      playbackClient
    });

    const result = player.play(camera());
    await waitFor(() => playCount === 1);
    video.dispatch("error");
    await waitFor(() => playCount === 2);
    attempts[0][scenario.old](new Error("stale autoplay"));
    await assertPending(result);

    if (scenario.final === "playing") attempts[1].resolve();
    if (scenario.final === "blocked") attempts[1].reject(new Error("replacement blocked"));
    if (scenario.final === "unavailable") video.dispatch("error");

    assert.equal(await result, scenario.final);
    if (scenario.final === "unavailable") attempts[1].resolve();
    await Promise.resolve();
    assert.equal(player.state(), scenario.final);
    assert.equal(callCount(playbackClient, "refresh"), 1);
  }
});

test("hls.js initial-load recovery ignores the old autoplay settlement and follows the replacement", async () => {
  const previousWindow = globalThis.window;

  try {
    for (const scenario of [
      { old: "reject", final: "playing" },
      { old: "resolve", final: "blocked" },
      { old: "reject", final: "unavailable" }
    ]) {
      const HlsStub = createHlsStub();
      globalThis.window = { Hls: HlsStub };
      const attempts = [deferred(), deferred()];
      let playCount = 0;
      const video = videoStub();
      video.canPlayType = () => "";
      video.play = () => attempts[playCount++].promise;
      const playbackClient = playbackClientStub();
      const player = createFeedTilePlayer({
        video,
        status: { textContent: "" },
        playbackClient
      });

      const result = player.play(camera());
      await waitFor(() => HlsStub.instances.length === 1);
      const original = HlsStub.instances[0];
      original.emit(HlsStub.Events.MANIFEST_PARSED);
      await waitFor(() => playCount === 1);
      original.emit(HlsStub.Events.ERROR, { fatal: true });
      await waitFor(() => HlsStub.instances.length === 2);
      const replacement = HlsStub.instances[1];
      replacement.emit(HlsStub.Events.MANIFEST_PARSED);
      await waitFor(() => playCount === 2);
      attempts[0][scenario.old](new Error("stale autoplay"));
      original.emit(HlsStub.Events.ERROR, { fatal: true });
      await assertPending(result);

      if (scenario.final === "playing") attempts[1].resolve();
      if (scenario.final === "blocked") attempts[1].reject(new Error("replacement blocked"));
      if (scenario.final === "unavailable") {
        replacement.emit(HlsStub.Events.ERROR, { fatal: true });
      }

      assert.equal(await result, scenario.final);
      if (scenario.final === "unavailable") attempts[1].resolve();
      await Promise.resolve();
      assert.equal(player.state(), scenario.final);
      assert.equal(callCount(playbackClient, "refresh"), 1);
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a failed refresh is unavailable and explicit Retry gets a fresh refresh budget", async () => {
  const playbackClient = playbackClientStub();
  let refreshCount = 0;
  playbackClient.refresh = async (cameraId, failedRevision) => {
    playbackClient.calls.push(["refresh", cameraId, failedRevision]);
    refreshCount += 1;
    if (refreshCount === 1) throw new Error("refresh unavailable");
    return playbackRecord(cameraId, {
      playlistUrl: REPLACEMENT_URL,
      revision: "revision-2"
    });
  };
  const video = videoStub();
  const player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient
  });

  await player.play(camera());
  video.dispatch("error");
  await waitFor(() => player.state() === "unavailable");
  assert.equal(callCount(playbackClient, "refresh"), 1);

  assert.equal(await player.play(camera()), "playing");
  video.dispatch("error");
  await waitFor(() => player.state() === "playing" && callCount(playbackClient, "refresh") === 2);

  assert.equal(video.src === REPLACEMENT_URL, true);
  assert.equal(callCount(playbackClient, "refresh"), 2);
});

test("clear and expire make late broker resolves inert", async () => {
  for (const action of ["clear", "expire"]) {
    const pendingResolve = deferred();
    const playbackClient = playbackClientStub();
    playbackClient.resolve = async (cameraId) => {
      playbackClient.calls.push(["resolve", cameraId]);
      return pendingResolve.promise;
    };
    const video = videoStub();
    const status = { textContent: "" };
    const player = createFeedTilePlayer({ video, status, playbackClient });

    const result = player.play(camera());
    player[action]();
    pendingResolve.resolve(playbackRecord("camera-a"));

    assert.equal(await result, action === "clear" ? "idle" : "expired");
    await Promise.resolve();
    assert.equal(player.state(), action === "clear" ? "idle" : "expired");
    assert.equal(video.src.length === 0, true);
    assert.equal(video.listeners("error").length, 0);
  }
});

test("clear, expire, and replacement make late native autoplay settlement inert", async () => {
  for (const outcome of ["resolve", "reject"]) {
    for (const action of ["clear", "expire", "replace"]) {
      const pendingAutoplay = deferred();
      let playCount = 0;
      const video = videoStub();
      video.play = () => {
        playCount += 1;
        return playCount === 1 ? pendingAutoplay.promise : Promise.resolve();
      };
      const playbackClient = playbackClientStub();
      const status = { textContent: "" };
      const player = createFeedTilePlayer({ video, status, playbackClient });
      const firstResult = player.play(camera());
      await waitFor(() => playCount === 1);

      let replacementResult;
      if (action === "replace") replacementResult = player.play(camera("camera-b"));
      else player[action]();
      pendingAutoplay[outcome](new Error("stale autoplay"));

      assert.equal(await firstResult, action === "expire" ? "expired" : "idle");
      if (replacementResult) assert.equal(await replacementResult, "playing");
      await Promise.resolve();
      assert.equal(player.state(), action === "clear" ? "idle" : action === "expire" ? "expired" : "playing");
      assert.equal(status.textContent, action === "clear"
        ? "Preview paused"
        : action === "expire"
          ? "Tap to restart"
          : "Playing");
    }
  }
});

test("clear, expire, and replacement make late refreshes and old native handlers inert", async () => {
  for (const action of ["clear", "expire", "replace"]) {
    const pendingRefresh = deferred();
    const playbackClient = playbackClientStub();
    playbackClient.resolve = async (cameraId) => {
      playbackClient.calls.push(["resolve", cameraId]);
      return playbackRecord(cameraId, {
        playlistUrl: cameraId === "camera-b" ? REPLACEMENT_URL : SIGNED_URL
      });
    };
    playbackClient.refresh = async (cameraId, failedRevision) => {
      playbackClient.calls.push(["refresh", cameraId, failedRevision]);
      return pendingRefresh.promise;
    };
    const video = videoStub();
    const status = { textContent: "" };
    const player = createFeedTilePlayer({ video, status, playbackClient });
    await player.play(camera());
    const [oldHandler] = video.listeners("error");
    oldHandler();
    await waitFor(() => callCount(playbackClient, "refresh") === 1);

    if (action === "replace") {
      assert.equal(await player.play(camera("camera-b", "b.jpg")), "playing");
    } else {
      player[action]();
    }
    oldHandler();
    pendingRefresh.resolve(playbackRecord("camera-a", { playlistUrl: REPLACEMENT_URL }));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(callCount(playbackClient, "refresh"), 1);
    assert.equal(player.state(), action === "clear" ? "idle" : action === "expire" ? "expired" : "playing");
    assert.equal(video.src === (action === "replace" ? REPLACEMENT_URL : ""), true);
  }
});

test("stale hls.js events cannot refresh or relabel a replacement or cleared generation", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({
      video,
      status: { textContent: "" },
      playbackClient
    });
    const first = player.play(camera());
    await waitFor(() => HlsStub.instances.length === 1);
    const oldInstance = HlsStub.instances[0];

    const second = player.play(camera("camera-b"));
    await waitFor(() => HlsStub.instances.length === 2);
    const currentInstance = HlsStub.instances[1];
    assert.equal(await first, "idle");
    oldInstance.emit(HlsStub.Events.MANIFEST_PARSED);
    oldInstance.emit(HlsStub.Events.ERROR, { fatal: true });
    assert.equal(callCount(playbackClient, "refresh"), 0);

    player.clear();
    assert.equal(await second, "idle");
    currentInstance.emit(HlsStub.Events.MANIFEST_PARSED);
    currentInstance.emit(HlsStub.Events.ERROR, { fatal: true });
    await Promise.resolve();
    assert.equal(player.state(), "idle");
    assert.equal(callCount(playbackClient, "refresh"), 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("hls.js setup failures destroy partial instances and never force a refresh", async () => {
  const previousWindow = globalThis.window;

  try {
    for (const failurePoint of ["constructor", "loadSource", "attachMedia"]) {
      class FailingHls {
        static Events = { ERROR: "error", MANIFEST_PARSED: "manifestParsed" };
        static instances = [];

        static isSupported() {
          return true;
        }

        constructor() {
          if (failurePoint === "constructor") throw new Error("setup failed");
          this.handlers = new Map();
          this.destroyed = false;
          FailingHls.instances.push(this);
        }

        on(event, handler) {
          this.handlers.set(event, handler);
        }

        loadSource() {
          if (failurePoint === "loadSource") throw new Error("setup failed");
        }

        attachMedia() {
          if (failurePoint === "attachMedia") throw new Error("setup failed");
        }

        destroy() {
          this.destroyed = true;
        }
      }

      globalThis.window = { Hls: FailingHls };
      const video = videoStub();
      video.canPlayType = () => "";
      const playbackClient = playbackClientStub();
      const player = createFeedTilePlayer({
        video,
        status: { textContent: "" },
        playbackClient
      });

      assert.equal(await player.play(camera()), "unavailable");
      assert.equal(callCount(playbackClient, "refresh"), 0);
      assert.equal(player.state(), "unavailable");
      if (FailingHls.instances[0]) {
        assert.equal(FailingHls.instances[0].destroyed, true);
      }
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a synchronous fatal hls.js load event starts recovery before a following setup throw", async () => {
  const previousWindow = globalThis.window;

  class SynchronousFatalHls {
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifestParsed" };
    static instances = [];

    static isSupported() {
      return true;
    }

    constructor() {
      this.handlers = new Map();
      this.destroyed = false;
      SynchronousFatalHls.instances.push(this);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    loadSource() {
      if (SynchronousFatalHls.instances.length === 1) {
        this.handlers.get(SynchronousFatalHls.Events.ERROR)?.(null, { fatal: true });
        throw new Error("old setup failed after fatal");
      }
    }

    attachMedia() {}

    destroy() {
      this.destroyed = true;
    }

    emit(event, data = {}) {
      this.handlers.get(event)?.(null, data);
    }
  }

  globalThis.window = { Hls: SynchronousFatalHls };
  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const playbackClient = playbackClientStub();
    const player = createFeedTilePlayer({
      video,
      status: { textContent: "" },
      playbackClient
    });

    const result = player.play(camera());
    await waitFor(() => SynchronousFatalHls.instances.length === 2);
    assert.equal(callCount(playbackClient, "refresh"), 1);
    SynchronousFatalHls.instances[1].emit(SynchronousFatalHls.Events.MANIFEST_PARSED);

    assert.equal(await result, "playing");
    assert.equal(player.state(), "playing");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a synchronous native load error recovers without starting stale autoplay", async () => {
  const video = videoStub();
  let loadCount = 0;
  let playCount = 0;
  const originalLoad = video.load;
  video.load = function load() {
    originalLoad.call(this);
    loadCount += 1;
    if (loadCount === 2) this.dispatch("error");
  };
  video.play = () => {
    playCount += 1;
    return Promise.resolve();
  };
  const playbackClient = playbackClientStub();
  const player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient
  });

  assert.equal(await player.play(camera()), "playing");
  assert.equal(callCount(playbackClient, "refresh"), 1);
  assert.equal(playCount, 1);
  assert.equal(video.src === REPLACEMENT_URL, true);
});

test("duplicate hls.js manifest events start autoplay only once per source attempt", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    let playCount = 0;
    const video = videoStub();
    video.canPlayType = () => "";
    video.play = () => {
      playCount += 1;
      return Promise.resolve();
    };
    const player = createFeedTilePlayer({
      video,
      status: { textContent: "" },
      playbackClient: playbackClientStub()
    });

    const result = player.play(camera());
    await waitFor(() => HlsStub.instances.length === 1);
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);

    assert.equal(await result, "playing");
    assert.equal(playCount, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("resume stays in the click stack and follows native or hls.js recovery", async () => {
  for (const mode of ["native", "hls"]) {
    const previousWindow = globalThis.window;
    const HlsStub = createHlsStub();
    if (mode === "hls") globalThis.window = { Hls: HlsStub };
    try {
      const pendingResume = deferred();
      const pendingReplacement = deferred();
      let playCount = 0;
      const video = videoStub();
      if (mode === "hls") video.canPlayType = () => "";
      video.play = () => {
        playCount += 1;
        if (playCount === 1) return Promise.reject(new Error("autoplay blocked"));
        if (playCount === 2) return pendingResume.promise;
        return pendingReplacement.promise;
      };
      const playbackClient = playbackClientStub();
      const player = createFeedTilePlayer({
        video,
        status: { textContent: "" },
        playbackClient
      });
      const initial = player.play(camera());
      if (mode === "hls") {
        await waitFor(() => HlsStub.instances.length === 1);
        HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
      }
      assert.equal(await initial, "blocked");

      const resumeResult = player.resume();
      assert.equal(playCount, 2, "resume invokes video.play synchronously");
      if (mode === "hls") {
        HlsStub.instances[0].emit(HlsStub.Events.ERROR, { fatal: true });
        await waitFor(() => HlsStub.instances.length === 2);
        HlsStub.instances[1].emit(HlsStub.Events.MANIFEST_PARSED);
      } else {
        video.dispatch("error");
      }
      await waitFor(() => playCount === 3);
      pendingResume.resolve();
      await assertPending(resumeResult);
      pendingReplacement.resolve();

      assert.equal(await resumeResult, "playing");
      assert.equal(player.state(), "playing");
      assert.equal(callCount(playbackClient, "refresh"), 1);
    } finally {
      globalThis.window = previousWindow;
    }
  }
});

test("a pending resume settles to clear instead of relabeling the player", async () => {
  const pendingResume = deferred();
  let playCount = 0;
  const video = videoStub();
  video.play = () => {
    playCount += 1;
    return playCount === 1
      ? Promise.reject(new Error("autoplay blocked"))
      : pendingResume.promise;
  };
  const playbackClient = playbackClientStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status, playbackClient });
  assert.equal(await player.play(camera()), "blocked");

  const result = player.resume();
  player.clear();
  pendingResume.resolve();

  assert.equal(await result, "idle");
  assert.equal(player.state(), "idle");
  assert.equal(status.textContent, "Preview paused");
});

test("repeated resume calls share one pending user-action attempt", async () => {
  const pendingResume = deferred();
  let playCount = 0;
  const video = videoStub();
  video.play = () => {
    playCount += 1;
    return playCount === 1
      ? Promise.reject(new Error("autoplay blocked"))
      : pendingResume.promise;
  };
  const player = createFeedTilePlayer({
    video,
    status: { textContent: "" },
    playbackClient: playbackClientStub()
  });
  assert.equal(await player.play(camera()), "blocked");

  const first = player.resume();
  const second = player.resume();
  assert.equal(first === second, true);
  assert.equal(playCount, 2);
  pendingResume.resolve();

  assert.equal(await first, "playing");
  assert.equal(await second, "playing");
});

test("provider URL, revision, and client error text never reach player diagnostics", async () => {
  const hiddenUrl = "https://video-auth1.iol.pt/auth-beachcam/private/playlist.m3u8?wmsAuthSign=private-fixture";
  const hiddenRevision = "private-revision";
  const stateLabels = [];
  const playbackClient = playbackClientStub({
    resolvedUrl: hiddenUrl,
    revision: hiddenRevision
  });
  playbackClient.refresh = async (cameraId, failedRevision) => {
    playbackClient.calls.push(["refresh", cameraId, failedRevision]);
    throw new Error(`private failure ${hiddenUrl} ${hiddenRevision}`);
  };
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({
    video,
    status,
    playbackClient,
    onStateChange: (state) => stateLabels.push(`${state}:${status.textContent}`)
  });
  await player.play(camera());
  video.dispatch("error");
  await waitFor(() => player.state() === "unavailable");

  const publicText = `${status.textContent} ${stateLabels.join(" ")}`;
  assert.equal(publicText.includes(hiddenUrl), false);
  assert.equal(publicText.includes(hiddenRevision), false);
  assert.equal(publicText.includes("private failure"), false);
});

test("a fatal error in one player leaves an independent pane untouched", async () => {
  const failedRefresh = deferred();
  const firstClient = playbackClientStub();
  firstClient.refresh = async (cameraId, failedRevision) => {
    firstClient.calls.push(["refresh", cameraId, failedRevision]);
    return failedRefresh.promise;
  };
  const secondClient = playbackClientStub();
  const firstVideo = videoStub();
  const secondVideo = videoStub();
  const firstPlayer = createFeedTilePlayer({
    video: firstVideo,
    status: { textContent: "" },
    playbackClient: firstClient
  });
  const secondStatus = { textContent: "" };
  const secondPlayer = createFeedTilePlayer({
    video: secondVideo,
    status: secondStatus,
    playbackClient: secondClient
  });
  await Promise.all([
    firstPlayer.play(camera("camera-a")),
    secondPlayer.play(camera("camera-b"))
  ]);

  firstVideo.dispatch("error");
  await waitFor(() => firstPlayer.state() === "loading");

  assert.equal(secondPlayer.state(), "playing");
  assert.equal(secondStatus.textContent, "Playing");
  assert.equal(callCount(secondClient, "refresh"), 0);
  failedRefresh.reject(new Error("pane-local failure"));
  await waitFor(() => firstPlayer.state() === "unavailable");
  assert.equal(secondPlayer.state(), "playing");
});
