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
  let timerId = null;
  let generation = 0;

  function cancelTimer() {
    if (timerId === null) return;
    clearTimer(timerId);
    timerId = null;
  }

  function expire(token) {
    timerId = null;
    if (token !== generation || !visible || currentState !== "playing") return;
    generation += 1;
    player.expire();
    currentState = "expired";
  }

  function settlePlay(token, result) {
    if (token !== generation) return;
    const finalState = typeof result === "string" ? result : player.state?.();
    if (finalState === "playing") {
      currentState = "playing";
      return;
    }
    cancelTimer();
    currentState = finalState === "blocked" || finalState === "unavailable"
      ? finalState
      : "unavailable";
  }

  function start(scheduleToken) {
    timerId = null;
    if (
      scheduleToken !== generation
      || !visible
      || !isDocumentVisible()
      || currentState !== "idle"
    ) return;
    const token = generation + 1;
    generation = token;
    currentState = "playing";
    timerId = setTimer(() => expire(token), durationMs);
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
    if (timerId !== null || currentState !== "idle" || !isDocumentVisible()) return;
    const scheduleToken = generation;
    timerId = setTimer(() => start(scheduleToken), 0);
  }

  function clear() {
    visible = false;
    generation += 1;
    cancelTimer();
    player.clear();
    currentState = "idle";
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (!visible) {
      generation += 1;
      cancelTimer();
      player.clear();
      currentState = "idle";
      return;
    }
    if (!isDocumentVisible()) {
      generation += 1;
      cancelTimer();
      if (currentState !== "idle") player.clear();
      currentState = "idle";
      return;
    }
    scheduleStart();
  }

  function retry() {
    if (
      !["blocked", "expired", "unavailable"].includes(currentState)
      || !visible
      || !isDocumentVisible()
    ) return false;
    generation += 1;
    cancelTimer();
    currentState = "idle";
    scheduleStart();
    return true;
  }

  function restart() {
    if (currentState !== "expired") return false;
    return retry();
  }

  function state() {
    return currentState;
  }

  return { clear, restart, retry, setVisible, state };
}
