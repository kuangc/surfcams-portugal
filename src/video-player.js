const DEFAULT_HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.6.4/dist/hls.min.js";

let sharedHlsLoader = null;

const MIN_VIDEO_SCALE = 1;
const MAX_VIDEO_SCALE = 4;
const GESTURE_CLICK_SUPPRESSION_MS = 400;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

export function createVideoGestures({
  video,
  maxScale = MAX_VIDEO_SCALE,
  now = () => Date.now()
}) {
  const pointers = new Map();
  const view = { scale: MIN_VIDEO_SCALE, x: 0, y: 0 };
  const hadNativeControls = Boolean(video.controls);
  let panStart = null;
  let pinchStart = null;
  let gestureMoved = false;
  let suppressClickUntil = 0;

  function layoutRect() {
    const transformed = video.getBoundingClientRect?.() || {
      left: 0,
      top: 0,
      width: 0,
      height: 0
    };
    const width = video.clientWidth || (transformed.width / view.scale);
    const height = video.clientHeight || (transformed.height / view.scale);
    const centerX = transformed.left + (transformed.width / 2) - view.x;
    const centerY = transformed.top + (transformed.height / 2) - view.y;

    return {
      left: centerX - (width / 2),
      top: centerY - (height / 2),
      width,
      height
    };
  }

  function bounds() {
    const rect = layoutRect();
    return {
      x: Math.max(0, rect.width * (view.scale - MIN_VIDEO_SCALE) / 2),
      y: Math.max(0, rect.height * (view.scale - MIN_VIDEO_SCALE) / 2),
      rect
    };
  }

  function render() {
    if (view.scale <= MIN_VIDEO_SCALE) {
      view.scale = MIN_VIDEO_SCALE;
      view.x = 0;
      view.y = 0;
    } else {
      const limit = bounds();
      view.x = clamp(view.x, -limit.x, limit.x);
      view.y = clamp(view.y, -limit.y, limit.y);
    }

    if (!video.style) return;
    video.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
    video.style.transformOrigin = "center center";
    video.style.touchAction = "none";
    if ("controls" in video) {
      video.controls = hadNativeControls && view.scale === MIN_VIDEO_SCALE;
    }
  }

  function startPinch() {
    const [first, second] = [...pointers.values()];
    if (!first || !second) return;

    const { rect } = bounds();
    const center = midpoint(first, second);
    pinchStart = {
      distance: Math.max(1, distanceBetween(first, second)),
      scale: view.scale,
      x: view.x,
      y: view.y,
      center: {
        x: center.x - rect.left - (rect.width / 2),
        y: center.y - rect.top - (rect.height / 2)
      }
    };
    panStart = null;
  }

  function startPan(pointer) {
    panStart = pointer ? {
      pointerId: pointer.id,
      pointerX: pointer.x,
      pointerY: pointer.y,
      x: view.x,
      y: view.y
    } : null;
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse") return;

    if (pointers.size === 0) gestureMoved = false;
    const pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, pointer);

    if (pointers.size >= 2) {
      pointers.forEach((_point, pointerId) => {
        try {
          video.setPointerCapture?.(pointerId);
        } catch {}
      });
      startPinch();
      event.preventDefault();
    } else if (view.scale > MIN_VIDEO_SCALE) {
      try {
        video.setPointerCapture?.(event.pointerId);
      } catch {}
      startPan(pointer);
      event.preventDefault();
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;

    const pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, pointer);

    if (pointers.size >= 2) {
      if (!pinchStart) startPinch();
      const [first, second] = [...pointers.values()];
      const center = midpoint(first, second);
      const { rect } = bounds();
      const currentCenter = {
        x: center.x - rect.left - (rect.width / 2),
        y: center.y - rect.top - (rect.height / 2)
      };
      const nextScale = clamp(
        pinchStart.scale * distanceBetween(first, second) / pinchStart.distance,
        MIN_VIDEO_SCALE,
        maxScale
      );
      const scaleChange = nextScale / pinchStart.scale;

      view.scale = nextScale;
      view.x = currentCenter.x - ((pinchStart.center.x - pinchStart.x) * scaleChange);
      view.y = currentCenter.y - ((pinchStart.center.y - pinchStart.y) * scaleChange);
      gestureMoved = true;
      render();
      event.preventDefault();
      return;
    }

    if (view.scale <= MIN_VIDEO_SCALE) return;
    if (!panStart || panStart.pointerId !== event.pointerId) startPan(pointer);

    view.x = panStart.x + (pointer.x - panStart.pointerX);
    view.y = panStart.y + (pointer.y - panStart.pointerY);
    gestureMoved = true;
    render();
    event.preventDefault();
  }

  function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try {
      video.releasePointerCapture?.(event.pointerId);
    } catch {}

    pinchStart = null;
    if (pointers.size === 1 && view.scale > MIN_VIDEO_SCALE) {
      startPan([...pointers.values()][0]);
    } else {
      panStart = null;
    }
    if (pointers.size === 0 && gestureMoved) {
      suppressClickUntil = now() + GESTURE_CLICK_SUPPRESSION_MS;
      gestureMoved = false;
    }
  }

  function onClick(event) {
    const shouldSuppress = suppressClickUntil > 0 && now() <= suppressClickUntil;
    suppressClickUntil = 0;
    if (!shouldSuppress) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function reset() {
    pointers.clear();
    panStart = null;
    pinchStart = null;
    gestureMoved = false;
    suppressClickUntil = 0;
    view.scale = MIN_VIDEO_SCALE;
    view.x = 0;
    view.y = 0;
    render();
  }

  function state() {
    return { ...view };
  }

  if (typeof video.addEventListener === "function") {
    video.addEventListener("pointerdown", onPointerDown);
    video.addEventListener("pointermove", onPointerMove);
    video.addEventListener("pointerup", onPointerEnd);
    video.addEventListener("pointercancel", onPointerEnd);
    video.addEventListener("lostpointercapture", onPointerEnd);
    video.addEventListener("click", onClick);
  }
  render();

  return { reset, state };
}

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
  const gestures = createVideoGestures({ video });

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function clear() {
    gestures.reset();
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

    gestures.reset();
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

export function createFeedTilePlayer({ video, status, hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL }) {
  let hls = null;
  let currentState = "idle";
  const gestures = createVideoGestures({ video });

  function setState(nextState, label) {
    currentState = nextState;
    status.textContent = label;
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function clear() {
    gestures.reset();
    destroyHls();
    video.pause();
    video.removeAttribute("src");
    video.load();
    currentState = "idle";
  }

  async function play(camera) {
    if (!camera?.streamUrl) {
      clear();
      setState("unavailable", "Feed unavailable");
      return;
    }

    gestures.reset();
    destroyHls();
    video.pause();
    video.removeAttribute("src");
    video.poster = camera.image || "";
    setState("loading", "Loading");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = camera.streamUrl;
      video.load();
      await video.play().catch(() => {});
      setState("playing", "Playing");
      return;
    }

    return ensureHls(hlsScriptUrl).then((HlsPlayer) => {
      if (!HlsPlayer || !HlsPlayer.isSupported()) {
        setState("unavailable", "Feed unavailable");
        return;
      }

      hls = new HlsPlayer({ backBufferLength: 30, maxBufferLength: 20 });
      hls.loadSource(camera.streamUrl);
      hls.attachMedia(video);
      hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        setState("playing", "Playing");
      });
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (data.fatal) setState("unavailable", "Feed unavailable");
      });
    }).catch(() => {
      setState("unavailable", "Feed unavailable");
    });
  }

  function expire() {
    clear();
    setState("expired", "Tap to restart");
  }

  function state() {
    return currentState;
  }

  return { clear, expire, play, state };
}
