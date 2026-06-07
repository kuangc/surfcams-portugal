const DEFAULT_HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.6.4/dist/hls.min.js";

export function createVideoPlayer({ video, status, hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL }) {
  let hls = null;
  let hlsLoader = null;

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

  function ensureHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoader) return hlsLoader;

    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = hlsScriptUrl;
      script.async = true;
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("Unable to load HLS player."));
      document.head.appendChild(script);
    });

    return hlsLoader;
  }

  function play(camera) {
    if (!camera || !camera.streamUrl) {
      clear();
      status.textContent = "No feed URL found for this camera.";
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

    ensureHls().then((HlsPlayer) => {
      if (!HlsPlayer || !HlsPlayer.isSupported()) {
        status.textContent = "This browser cannot play HLS.";
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
        if (data.fatal) status.textContent = "Feed error. Try another camera.";
      });
    }).catch((error) => {
      status.textContent = error.message;
    });
  }

  return { clear, play };
}
