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
    script.onerror = () => {
      sharedHlsLoader = null;
      script.remove();
      reject(new Error("Unable to load HLS player."));
    };
    document.head.appendChild(script);
  });

  return sharedHlsLoader;
}

export function createFeedTilePlayer({
  video,
  status,
  playbackClient,
  hlsScriptUrl = DEFAULT_HLS_SCRIPT_URL,
  onStateChange = () => {}
}) {
  let currentState = "idle";
  let generation = 0;
  let sourceAttempt = 0;
  let forcedRefreshUsed = false;
  let activeAttempt = null;
  let pendingResume = null;
  const pendingWaiters = new Set();
  const gestures = createVideoGestures({ video });

  function setState(nextState, label) {
    currentState = nextState;
    status.textContent = label;
    onStateChange(nextState);
  }

  function waiterSnapshot(token) {
    return [...pendingWaiters].filter((waiter) => waiter.generation === token);
  }

  function settleWaiterSnapshot(waiters, resumeAttempt, nextState) {
    for (const waiter of waiters) {
      if (!pendingWaiters.delete(waiter)) continue;
      waiter.resolve(nextState);
    }
    if (resumeAttempt && pendingResume === resumeAttempt) pendingResume = null;
  }

  function settleWaiters(token, nextState) {
    const resumeAttempt = pendingResume?.generation === token ? pendingResume : null;
    settleWaiterSnapshot(waiterSnapshot(token), resumeAttempt, nextState);
  }

  function createWaiter(token) {
    return new Promise((resolve) => {
      pendingWaiters.add({ generation: token, resolve });
    });
  }

  function isCurrentAttempt(attempt) {
    return Boolean(
      attempt
      && attempt.active
      && activeAttempt === attempt
      && attempt.generation === generation
      && attempt.sourceAttempt === sourceAttempt
    );
  }

  function destroyAttemptHls(attempt) {
    const instance = attempt?.hls;
    if (!instance) return;
    attempt.hls = null;
    try {
      instance.destroy();
    } catch {
      // Player teardown details must never escape into UI diagnostics.
    }
  }

  function deactivateAttempt(attempt) {
    if (!attempt) return false;
    const wasCurrent = activeAttempt === attempt;
    attempt.active = false;
    if (wasCurrent) activeAttempt = null;
    if (attempt.nativeErrorHandler) {
      video.removeEventListener("error", attempt.nativeErrorHandler);
      attempt.nativeErrorHandler = null;
    }
    destroyAttemptHls(attempt);
    return wasCurrent;
  }

  function detachMedia(attempt = activeAttempt) {
    deactivateAttempt(attempt);
    gestures.reset();
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function advanceGeneration(finalState) {
    settleWaiters(generation, finalState);
    generation += 1;
    sourceAttempt = 0;
    forcedRefreshUsed = false;
    pendingResume = null;
    return generation;
  }

  function finishGeneration(token, nextState, label) {
    if (token !== generation) return;
    const expectedGeneration = generation;
    const expectedSourceAttempt = sourceAttempt;
    const expectedActiveAttempt = activeAttempt;
    const expectedWaiters = waiterSnapshot(token);
    const expectedResume = pendingResume?.generation === token ? pendingResume : null;
    setState(nextState, label);
    if (
      generation !== expectedGeneration
      || sourceAttempt !== expectedSourceAttempt
      || activeAttempt !== expectedActiveAttempt
      || currentState !== nextState
    ) return;
    settleWaiterSnapshot(expectedWaiters, expectedResume, nextState);
  }

  function failAttempt(attempt) {
    if (!isCurrentAttempt(attempt)) return;
    const token = attempt.generation;
    detachMedia(attempt);
    finishGeneration(token, "unavailable", "Feed unavailable");
  }

  function startAutoplay(attempt) {
    if (!isCurrentAttempt(attempt) || attempt.autoplayStarted) return;
    attempt.autoplayStarted = true;
    let autoplay;
    try {
      autoplay = video.play();
    } catch (error) {
      autoplay = Promise.reject(error);
    }
    Promise.resolve(autoplay).then(
      () => {
        if (!isCurrentAttempt(attempt)) return;
        finishGeneration(attempt.generation, "playing", "Playing");
      },
      () => {
        if (!isCurrentAttempt(attempt)) return;
        finishGeneration(attempt.generation, "blocked", "Press play to start");
      }
    );
  }

  function resolvePlayback(camera) {
    return playbackClient.resolve(camera.id);
  }

  function refreshPlayback(camera, failedRevision) {
    return playbackClient.refresh(camera.id, failedRevision);
  }

  function attachResolvedSource(token, camera, record) {
    if (token !== generation) return;
    sourceAttempt += 1;
    const attempt = {
      active: true,
      autoplayStarted: false,
      generation: token,
      hls: null,
      nativeErrorHandler: null,
      revision: record.revision,
      sourceAttempt
    };
    activeAttempt = attempt;

    const handleFatal = () => {
      if (!isCurrentAttempt(attempt)) return;
      const failedRevision = attempt.revision;

      if (forcedRefreshUsed) {
        detachMedia(attempt);
        finishGeneration(token, "unavailable", "Feed unavailable");
        return;
      }

      forcedRefreshUsed = true;
      detachMedia(attempt);
      setState("loading", "Refreshing feed");
      if (
        token !== generation
        || sourceAttempt !== attempt.sourceAttempt
        || activeAttempt !== null
      ) return;

      let refreshResult;
      try {
        refreshResult = refreshPlayback(camera, failedRevision);
      } catch (error) {
        refreshResult = Promise.reject(error);
      }
      Promise.resolve(refreshResult).then(
        (replacement) => {
          if (
            token !== generation
            || sourceAttempt !== attempt.sourceAttempt
            || activeAttempt !== null
          ) return;
          attachResolvedSource(token, camera, replacement);
        },
        () => {
          if (
            token !== generation
            || sourceAttempt !== attempt.sourceAttempt
            || activeAttempt !== null
          ) return;
          finishGeneration(token, "unavailable", "Feed unavailable");
        }
      );
    };

    let nativeHls = false;
    try {
      nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    } catch {
      failAttempt(attempt);
      return;
    }

    if (nativeHls) {
      const handleNativeError = () => handleFatal();
      attempt.nativeErrorHandler = handleNativeError;
      video.addEventListener("error", handleNativeError);
      try {
        video.src = record.playlistUrl;
        if (!isCurrentAttempt(attempt)) return;
        video.load();
        if (!isCurrentAttempt(attempt)) return;
        startAutoplay(attempt);
      } catch {
        failAttempt(attempt);
      }
      return;
    }

    ensureHls(hlsScriptUrl).then((HlsPlayer) => {
      if (!isCurrentAttempt(attempt)) return;
      let instance = null;
      try {
        if (!HlsPlayer || !HlsPlayer.isSupported()) {
          failAttempt(attempt);
          return;
        }

        instance = new HlsPlayer({ backBufferLength: 30, maxBufferLength: 20 });
        attempt.hls = instance;
        instance.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (!isCurrentAttempt(attempt) || attempt.hls !== instance) return;
          startAutoplay(attempt);
        });
        instance.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data?.fatal || !isCurrentAttempt(attempt) || attempt.hls !== instance) return;
          handleFatal();
        });
        instance.loadSource(record.playlistUrl);
        if (!isCurrentAttempt(attempt) || attempt.hls !== instance) return;
        instance.attachMedia(video);
        if (!isCurrentAttempt(attempt) || attempt.hls !== instance) return;
      } catch {
        if (isCurrentAttempt(attempt)) failAttempt(attempt);
        else if (instance && attempt.hls === instance) destroyAttemptHls(attempt);
      }
    }, () => failAttempt(attempt));
  }

  function clear() {
    advanceGeneration("idle");
    detachMedia();
    setState("idle", "Preview paused");
  }

  function play(camera) {
    const token = advanceGeneration("idle");
    detachMedia();
    video.poster = camera?.image || "";

    if (typeof camera?.id !== "string" || !camera.id.trim()) {
      setState("unavailable", "Feed unavailable");
      return Promise.resolve("unavailable");
    }

    const requestedCamera = Object.freeze({ id: camera.id });
    const operation = createWaiter(token);
    setState("loading", "Loading");
    if (token !== generation) return operation;
    let resolveResult;
    try {
      resolveResult = resolvePlayback(requestedCamera);
    } catch (error) {
      resolveResult = Promise.reject(error);
    }
    Promise.resolve(resolveResult).then(
      (record) => {
        if (token !== generation) return;
        attachResolvedSource(token, requestedCamera, record);
      },
      () => {
        if (token !== generation) return;
        finishGeneration(token, "unavailable", "Feed unavailable");
      }
    );
    return operation;
  }

  function resume() {
    if (currentState !== "blocked") return Promise.resolve(currentState);
    const attempt = activeAttempt;
    if (!isCurrentAttempt(attempt)) return Promise.resolve(currentState);
    if (
      pendingResume
      && pendingResume.generation === generation
      && pendingResume.sourceAttempt === sourceAttempt
    ) return pendingResume.promise;

    const operation = createWaiter(generation);
    pendingResume = {
      generation,
      promise: operation,
      sourceAttempt
    };
    let resumed;
    try {
      resumed = video.play();
    } catch (error) {
      resumed = Promise.reject(error);
    }
    Promise.resolve(resumed).then(
      () => {
        if (!isCurrentAttempt(attempt) || currentState !== "blocked") return;
        finishGeneration(attempt.generation, "playing", "Playing");
      },
      () => {
        if (!isCurrentAttempt(attempt) || currentState !== "blocked") return;
        finishGeneration(attempt.generation, "blocked", "Press play to start");
      }
    );
    return operation;
  }

  function expire() {
    advanceGeneration("expired");
    detachMedia();
    setState("expired", "Tap to restart");
  }

  function state() {
    return currentState;
  }

  return { clear, expire, play, resume, state };
}
