import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createFeedTilePlayer,
  createVideoGestures,
  createVideoPlayer
} from "../src/video-player.js";

function videoStub() {
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
    }
  };
}

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

test("createFeedTilePlayer can expire and clear a tile", () => {
  const video = videoStub();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  player.expire();

  assert.equal(status.textContent, "Tap to restart");
  assert.equal(player.state(), "expired");
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
