import assert from "node:assert/strict";
import test from "node:test";

import { createFeedTilePlayer, createVideoPlayer } from "../src/video-player.js";

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
