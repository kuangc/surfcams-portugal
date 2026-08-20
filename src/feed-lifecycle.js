export function createGalleryPreviewSession({
  camera,
  player,
  durationMs = 60_000,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  isDocumentVisible = () => typeof document === "undefined" || !document.hidden
}) {
  let visible = false;
  let currentState = "idle";
  let startTimerId = null;
  let expiryTimerId = null;
  let previewWindowStarted = false;
  let generation = 0;

  function cancelStartTimer() {
    if (startTimerId === null) return;
    clearTimer(startTimerId);
    startTimerId = null;
  }

  function cancelExpiryTimer() {
    if (expiryTimerId === null) return;
    clearTimer(expiryTimerId);
    expiryTimerId = null;
  }

  function cancelTimers() {
    cancelStartTimer();
    cancelExpiryTimer();
  }

  function startPreviewWindow(token) {
    if (previewWindowStarted || expiryTimerId !== null) return;
    previewWindowStarted = true;
    expiryTimerId = setTimer(() => expire(token), durationMs);
  }

  function expire(token) {
    expiryTimerId = null;
    if (token !== generation || !visible || !previewWindowStarted) return;
    previewWindowStarted = false;
    generation += 1;
    player.expire();
    currentState = "expired";
  }

  function settlePlay(token, result) {
    if (token !== generation) return;
    const finalState = typeof result === "string" ? result : player.state?.();
    if (finalState === "playing") {
      currentState = "playing";
      startPreviewWindow(token);
      return;
    }
    currentState = finalState === "blocked" || finalState === "unavailable"
      ? finalState
      : "unavailable";
  }

  function start(scheduleToken) {
    startTimerId = null;
    if (
      scheduleToken !== generation
      || !visible
      || !isDocumentVisible()
      || currentState !== "idle"
    ) return;
    const token = generation + 1;
    generation = token;
    previewWindowStarted = false;
    currentState = "loading";
    let operation;
    try {
      operation = player.play(camera);
    } catch {
      settlePlay(token, "unavailable");
      return;
    }
    Promise.resolve(operation)
      .then((result) => settlePlay(token, result))
      .catch(() => settlePlay(token, player.state?.()));
  }

  function scheduleStart() {
    if (startTimerId !== null || currentState !== "idle" || !isDocumentVisible()) return;
    const scheduleToken = generation;
    startTimerId = setTimer(() => start(scheduleToken), 0);
  }

  function clear() {
    visible = false;
    generation += 1;
    previewWindowStarted = false;
    cancelTimers();
    player.clear();
    currentState = "idle";
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (!visible) {
      generation += 1;
      previewWindowStarted = false;
      cancelTimers();
      player.clear();
      currentState = "idle";
      return;
    }
    if (!isDocumentVisible()) {
      generation += 1;
      previewWindowStarted = false;
      cancelTimers();
      if (currentState !== "idle") player.clear();
      currentState = "idle";
      return;
    }
    scheduleStart();
  }

  function retry() {
    if (
      previewWindowStarted
      || !["blocked", "expired", "unavailable"].includes(currentState)
      || !visible
      || !isDocumentVisible()
    ) return false;
    generation += 1;
    previewWindowStarted = false;
    cancelTimers();
    currentState = "idle";
    scheduleStart();
    return true;
  }

  function settleResume(token, result) {
    if (token !== generation) return;
    const finalState = typeof result === "string" ? result : player.state?.();
    if (finalState === "playing") {
      currentState = "playing";
      startPreviewWindow(token);
      return;
    }
    if (finalState === "unavailable") {
      previewWindowStarted = false;
      cancelExpiryTimer();
      generation += 1;
      currentState = "unavailable";
      return;
    }
    currentState = "blocked";
  }

  function resume() {
    if (
      currentState !== "blocked"
      || !visible
      || !isDocumentVisible()
      || typeof player.resume !== "function"
    ) return false;
    const token = previewWindowStarted ? generation : generation + 1;
    if (!previewWindowStarted) {
      generation = token;
      cancelTimers();
    }
    currentState = "resuming";
    let operation;
    try {
      operation = player.resume();
    } catch {
      settleResume(token, player.state?.());
      return true;
    }
    Promise.resolve(operation)
      .then((result) => settleResume(token, result))
      .catch(() => settleResume(token, player.state?.()));
    return true;
  }

  function reconcilePlayerState(nextState) {
    if (!previewWindowStarted) return false;
    if (
      !["playing", "loading", "blocked", "resuming"].includes(currentState)
      || !["playing", "loading", "blocked", "unavailable"].includes(nextState)
    ) return false;

    if (nextState === "unavailable") {
      previewWindowStarted = false;
      cancelExpiryTimer();
      generation += 1;
    }
    currentState = nextState;
    return true;
  }

  function restart() {
    if (currentState !== "expired") return false;
    return retry();
  }

  function state() {
    return currentState;
  }

  return { clear, reconcilePlayerState, restart, resume, retry, setVisible, state };
}
