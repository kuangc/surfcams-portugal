import assert from "node:assert/strict";
import test from "node:test";

import { createFeedTilePlayer } from "../src/video-player.js";

function fakeVideo() {
  const removed = [];
  return {
    paused: false,
    poster: "",
    src: "",
    removed,
    canPlayType: () => "",
    load() {
      this.loaded = true;
    },
    pause() {
      this.paused = true;
    },
    play() {
      this.played = true;
      return Promise.resolve();
    },
    removeAttribute(name) {
      removed.push(name);
      delete this[name];
    }
  };
}

test("createFeedTilePlayer reports unavailable for missing streams", () => {
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video: fakeVideo(), status });

  player.play({ name: "No Stream" });

  assert.equal(player.state(), "unavailable");
  assert.equal(status.textContent, "Feed unavailable");
});

test("createFeedTilePlayer can expire and clear a tile", () => {
  const video = fakeVideo();
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  player.expire();

  assert.equal(player.state(), "expired");
  assert.equal(status.textContent, "Expired");
  assert.equal(video.paused, true);
  assert.deepEqual(video.removed, ["src"]);
});

test("createFeedTilePlayer uses native HLS when available", () => {
  const video = fakeVideo();
  video.canPlayType = () => "probably";
  const status = { textContent: "" };
  const player = createFeedTilePlayer({ video, status });

  player.play({
    name: "Native",
    image: "poster.jpg",
    streamUrl: "https://example.com/native.m3u8"
  });

  assert.equal(player.state(), "playing");
  assert.equal(video.poster, "poster.jpg");
  assert.equal(video.src, "https://example.com/native.m3u8");
  assert.equal(status.textContent, "Playing");
});
