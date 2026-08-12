const DEFAULT_HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.6.4/dist/hls.min.js";

let sharedHlsLoader = null;

function ensureHls(hlsScriptUrl) {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (sharedHlsLoader) return sharedHlsLoader;

  sharedHlsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = hlsScriptUrl;
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = () => reject(new Error("Unable to load HLS player."));
    document.head.appendChild(script);
  });

  return sharedHlsLoader;
}

export function createVideoPlayer({ video, status, hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL }) {
  let hls = null;

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function clear() {
    destroyHls();
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function play(camera) {
    if (!camera || !camera.streamUrl) {
      clear();
      status.textContent = "Feed unavailable";
      return;
    }

    destroyHls();
    video.pause();
    video.removeAttribute("src");
    video.poster = camera.image || "";

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = camera.streamUrl;
      video.load();
      video.play().catch(() => {
        status.textContent = "Feed loaded. Press play to start.";
      });
      status.textContent = "Feed loaded with native HLS.";
      return;
    }

    ensureHls(hlsScriptUrl).then((HlsPlayer) => {
      if (!HlsPlayer || !HlsPlayer.isSupported()) {
        status.textContent = "Feed unavailable";
        return;
      }

      hls = new HlsPlayer({
        backBufferLength: 60,
        maxBufferLength: 30
      });
      hls.loadSource(camera.streamUrl);
      hls.attachMedia(video);
      hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          status.textContent = "Feed loaded. Press play to start.";
        });
        status.textContent = "Feed loaded with hls.js.";
      });
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (data.fatal) status.textContent = "Feed unavailable";
      });
    }).catch(() => {
      status.textContent = "Feed unavailable";
    });
  }

  return { clear, play };
}

export function createFeedTilePlayer({
  video,
  status,
  hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL,
  onStateChange = () => {}
}) {
  let hls = null;
  let currentState = "idle";
  let generation = 0;
  let pendingOperation = null;

  function setState(nextState, label) {
    currentState = nextState;
    status.textContent = label;
    onStateChange(nextState);
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function resetMedia() {
    destroyHls();
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function advanceGeneration(finalState) {
    generation += 1;
    if (pendingOperation) {
      pendingOperation.resolve(finalState);
      pendingOperation = null;
    }
    return generation;
  }

  function finishOperation(token, nextState, label) {
    if (token !== generation) return false;
    setState(nextState, label);
    if (pendingOperation?.token === token) {
      pendingOperation.resolve(nextState);
      pendingOperation = null;
    }
    return true;
  }

  function clear() {
    advanceGeneration("idle");
    resetMedia();
    setState("idle", "Preview paused");
  }

  function play(camera) {
    const token = advanceGeneration("idle");

    if (!camera?.streamUrl) {
      resetMedia();
      setState("unavailable", "Feed unavailable");
      return Promise.resolve("unavailable");
    }

    resetMedia();
    video.poster = camera.image || "";
    setState("loading", "Loading");

    return new Promise((resolve) => {
      pendingOperation = { resolve, token };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = camera.streamUrl;
        video.load();
        let autoplay;
        try {
          autoplay = video.play();
        } catch (error) {
          autoplay = Promise.reject(error);
        }
        Promise.resolve(autoplay)
          .then(() => finishOperation(token, "playing", "Playing"))
          .catch(() => finishOperation(token, "blocked", "Press play to start"));
        return;
      }

      ensureHls(hlsScriptUrl).then((HlsPlayer) => {
        if (token !== generation) return;
        if (!HlsPlayer || !HlsPlayer.isSupported()) {
          finishOperation(token, "unavailable", "Feed unavailable");
          return;
        }

        const instance = new HlsPlayer({ backBufferLength: 30, maxBufferLength: 20 });
        hls = instance;
        instance.loadSource(camera.streamUrl);
        instance.attachMedia(video);
        instance.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (token !== generation || hls !== instance || currentState !== "loading") return;
          Promise.resolve()
            .then(() => video.play())
            .then(() => finishOperation(token, "playing", "Playing"))
            .catch(() => finishOperation(token, "blocked", "Press play to start"));
        });
        instance.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal || token !== generation || hls !== instance) return;
          destroyHls();
          finishOperation(token, "unavailable", "Feed unavailable");
        });
      }).catch(() => {
        finishOperation(token, "unavailable", "Feed unavailable");
      });
    });
  }

  function expire() {
    advanceGeneration("expired");
    resetMedia();
    setState("expired", "Tap to restart");
  }

  function state() {
    return currentState;
  }

  return { clear, expire, play, state };
}
