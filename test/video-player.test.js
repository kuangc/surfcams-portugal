import assert from "node:assert/strict";
import test from "node:test";

import { createFeedTilePlayer, createVideoPlayer } from "../src/video-player.js";

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
    const player = createFeedTilePlayer({ video, status, hlsScriptUrl: "https://example.com/hls.js" });

    const first = player.play({ streamUrl: "https://example.com/live.m3u8" });
    scripts[0].onerror();
    assert.equal(await first, "unavailable");
    assert.equal(scripts[0].removeCalled, true);

    const HlsStub = createHlsStub();
    const second = player.play({ streamUrl: "https://example.com/live.m3u8" });
    assert.equal(scripts.length, 2, "retry injects a fresh loader");
    globalThis.window.Hls = HlsStub;
    scripts[1].onload();
    await Promise.resolve();
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
    assert.equal(await second, "playing");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("createFeedTilePlayer reports unavailable for missing streams", () => {
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  player.play({ name: "No Stream" });

  assert.equal(status.textContent, "Feed unavailable");
  assert.equal(player.state(), "unavailable");
});

test("createFeedTilePlayer uses native HLS when available", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  await player.play({ name: "Cam", streamUrl: "https://example.com/live.m3u8", image: "poster.jpg" });

  assert.equal(video.src, "https://example.com/live.m3u8");
  assert.equal(video.poster, "poster.jpg");
  assert.equal(status.textContent, "Playing");
  assert.equal(player.state(), "playing");
});

test("a later native HLS media error transitions a playing tile to unavailable", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const stateChanges = [];
  const player = createFeedTilePlayer({
    video,
    status,
    onStateChange: (state) => stateChanges.push(state)
  });

  assert.equal(
    await player.play({ streamUrl: "https://example.com/native.m3u8" }),
    "playing"
  );

  video.dispatch("error");

  assert.equal(player.state(), "unavailable");
  assert.equal(status.textContent, "Feed unavailable");
  assert.equal(stateChanges.at(-1), "unavailable");
});

test("native HLS error listeners are generation-safe and removed during cleanup", async () => {
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  await player.play({ streamUrl: "https://example.com/first.m3u8" });
  assert.equal(video.listeners("error").length, 1);
  const [staleErrorListener] = video.listeners("error");

  await player.play({ streamUrl: "https://example.com/second.m3u8" });
  assert.equal(video.listeners("error").length, 1);
  staleErrorListener();
  assert.equal(player.state(), "playing");

  player.clear();
  assert.equal(video.listeners("error").length, 0);
  assert.equal(player.state(), "idle");
});

test("createFeedTilePlayer can expire and clear a tile", () => {
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  player.expire();

  assert.equal(status.textContent, "Tap to restart");
  assert.equal(player.state(), "expired");
});

test("clear keeps late native play resolution and rejection from relabeling a tile", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const pendingPlay = deferred();
    const video = videoStub();
    video.play = () => pendingPlay.promise;
    const status = { textContent: "" };
    const player = createFeedTilePlayer({ video, status });

    const playResult = player.play({ streamUrl: "https://example.com/native.m3u8" });
    player.clear();
    pendingPlay[outcome](new Error("autoplay rejected after clear"));

    assert.equal(await playResult, "idle");
    assert.equal(player.state(), "idle");
    assert.notEqual(status.textContent, "Playing");
    assert.notEqual(status.textContent, "Press play to start");
  }
});

test("clear before asynchronous Hls resolution prevents construction and attachment", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const player = createFeedTilePlayer({ video, status: { textContent: "" } });

    const playResult = player.play({ streamUrl: "https://example.com/hls.m3u8" });
    player.clear();

    assert.equal(await playResult, "idle");
    assert.equal(HlsStub.instances.length, 0);
    assert.equal(player.state(), "idle");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("stale Hls events cannot relabel a newer or cleared player generation", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const status = { textContent: "" };
    const player = createFeedTilePlayer({ video, status });

    const firstPlay = player.play({ streamUrl: "https://example.com/first.m3u8" });
    await Promise.resolve();
    const firstHls = HlsStub.instances[0];

    const secondPlay = player.play({ streamUrl: "https://example.com/second.m3u8" });
    await Promise.resolve();
    const secondHls = HlsStub.instances[1];
    assert.equal(await firstPlay, "idle");

    firstHls.emit(HlsStub.Events.MANIFEST_PARSED);
    firstHls.emit(HlsStub.Events.ERROR, { fatal: true });
    await Promise.resolve();
    assert.equal(player.state(), "loading");
    assert.equal(status.textContent, "Loading");

    player.clear();
    assert.equal(await secondPlay, "idle");
    secondHls.emit(HlsStub.Events.MANIFEST_PARSED);
    secondHls.emit(HlsStub.Events.ERROR, { fatal: true });
    await Promise.resolve();
    assert.equal(player.state(), "idle");
    assert.notEqual(status.textContent, "Playing");
    assert.notEqual(status.textContent, "Feed unavailable");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("native and hls.js autoplay rejection resolve as blocked with a manual-play label", async () => {
  const nativeVideo = videoStub();
  nativeVideo.play = () => Promise.reject(new Error("autoplay blocked"));
  const nativeStatus = { textContent: "" };
  const nativePlayer = createFeedTilePlayer({ video: nativeVideo, status: nativeStatus });

  assert.equal(
    await nativePlayer.play({ streamUrl: "https://example.com/native.m3u8" }),
    "blocked"
  );
  assert.equal(nativePlayer.state(), "blocked");
  assert.equal(nativeStatus.textContent, "Press play to start");

  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };
  try {
    const hlsVideo = videoStub();
    hlsVideo.canPlayType = () => "";
    hlsVideo.play = () => Promise.reject(new Error("autoplay blocked"));
    const hlsStatus = { textContent: "" };
    const hlsPlayer = createFeedTilePlayer({ video: hlsVideo, status: hlsStatus });

    const hlsResult = hlsPlayer.play({ streamUrl: "https://example.com/hls.m3u8" });
    await Promise.resolve();
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);

    assert.equal(await hlsResult, "blocked");
    assert.equal(hlsPlayer.state(), "blocked");
    assert.equal(hlsStatus.textContent, "Press play to start");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("resume retries blocked native and attached hls.js media inside the user action", async () => {
  for (const mode of ["native", "hls"]) {
    const previousWindow = globalThis.window;
    const HlsStub = createHlsStub();
    if (mode === "hls") globalThis.window = { Hls: HlsStub };
    try {
      const video = videoStub();
      if (mode === "hls") video.canPlayType = () => "";
      let allowPlay = false;
      video.play = () => allowPlay
        ? Promise.resolve()
        : Promise.reject(new Error("autoplay blocked"));
      const player = createFeedTilePlayer({ video, status: { textContent: "" } });
      const initial = player.play({ streamUrl: `https://example.com/${mode}.m3u8` });
      if (mode === "hls") {
        await Promise.resolve();
        HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
      }
      assert.equal(await initial, "blocked");

      allowPlay = true;
      const hlsInstanceCount = HlsStub.instances.length;
      assert.equal(await player.resume(), "playing");
      assert.equal(player.state(), "playing");
      if (mode === "hls") {
        assert.equal(HlsStub.instances.length, hlsInstanceCount, "resume keeps the attached HLS instance");
      }
    } finally {
      globalThis.window = previousWindow;
    }
  }
});

test("a pending resume cannot relabel a player after it is cleared", async () => {
  const pendingResume = deferred();
  const video = videoStub();
  let playCount = 0;
  video.play = () => {
    playCount += 1;
    return playCount === 1
      ? Promise.reject(new Error("autoplay blocked"))
      : pendingResume.promise;
  };
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  assert.equal(
    await player.play({ streamUrl: "https://example.com/native.m3u8" }),
    "blocked"
  );

  const resumeResult = player.resume();
  player.clear();
  pendingResume.resolve();

  assert.equal(await resumeResult, "idle");
  assert.equal(player.state(), "idle");
  assert.equal(status.textContent, "Preview paused");
});

test("a fatal HLS error wins over a pending manual resume", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const pendingResume = deferred();
    const video = videoStub();
    video.canPlayType = () => "";
    let playCount = 0;
    video.play = () => {
      playCount += 1;
      return playCount === 1
        ? Promise.reject(new Error("autoplay blocked"))
        : pendingResume.promise;
    };
    const status = { textContent: "" };
    const player = createFeedTilePlayer({ video, status });

    const initialPlay = player.play({ streamUrl: "https://example.com/hls.m3u8" });
    await Promise.resolve();
    HlsStub.instances[0].emit(HlsStub.Events.MANIFEST_PARSED);
    assert.equal(await initialPlay, "blocked");

    const resumeResult = player.resume();
    HlsStub.instances[0].emit(HlsStub.Events.ERROR, { fatal: true });
    pendingResume.resolve();

    assert.equal(await resumeResult, "unavailable");
    assert.equal(player.state(), "unavailable");
    assert.equal(status.textContent, "Feed unavailable");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a fatal Hls error leaves a separate player untouched", async () => {
  const previousWindow = globalThis.window;
  const HlsStub = createHlsStub();
  globalThis.window = { Hls: HlsStub };

  try {
    const firstVideo = videoStub();
    firstVideo.canPlayType = () => "";
    const firstStatus = { textContent: "" };
    const firstPlayer = createFeedTilePlayer({ video: firstVideo, status: firstStatus });
    const secondVideo = videoStub();
    secondVideo.canPlayType = () => "";
    const secondStatus = { textContent: "" };
    const secondPlayer = createFeedTilePlayer({ video: secondVideo, status: secondStatus });

    const firstResult = firstPlayer.play({ streamUrl: "https://example.com/first.m3u8" });
    const secondResult = secondPlayer.play({ streamUrl: "https://example.com/second.m3u8" });
    await Promise.resolve();
    HlsStub.instances[1].emit(HlsStub.Events.MANIFEST_PARSED);
    assert.equal(await secondResult, "playing");

    HlsStub.instances[0].emit(HlsStub.Events.ERROR, { fatal: true });
    assert.equal(await firstResult, "unavailable");
    assert.equal(firstPlayer.state(), "unavailable");
    assert.equal(firstStatus.textContent, "Feed unavailable");
    assert.equal(secondPlayer.state(), "playing");
    assert.equal(secondStatus.textContent, "Playing");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("fatal HLS playback failures stay local and report the feed unavailable", async () => {
  const previousWindow = globalThis.window;

  class HlsStub {
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifestParsed" };
    static instance = null;

    static isSupported() {
      return true;
    }

    constructor() {
      this.handlers = new Map();
      HlsStub.instance = this;
    }

    loadSource() {}

    attachMedia() {}

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    destroy() {}
  }

  globalThis.window = { Hls: HlsStub };

  try {
    const video = videoStub();
    video.canPlayType = () => "";
    const status = { textContent: "" };
    const player = createVideoPlayer({ video, status });

    player.play({ streamUrl: "https://example.test/surfline.m3u8" });
    await Promise.resolve();
    HlsStub.instance.handlers.get(HlsStub.Events.ERROR)(null, { fatal: true });

    assert.equal(status.textContent, "Feed unavailable");
  } finally {
    globalThis.window = previousWindow;
  }
});
