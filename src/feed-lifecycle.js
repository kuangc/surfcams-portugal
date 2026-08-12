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

  function cancelTimer() {
    if (timerId === null) return;
    clearTimer(timerId);
    timerId = null;
  }

  function expire() {
    timerId = null;
    if (!visible || currentState !== "playing") return;
    player.expire();
    currentState = "expired";
  }

  function start() {
    timerId = null;
    if (!visible || !isDocumentVisible() || currentState !== "idle") return;
    currentState = "playing";
    Promise.resolve(player.play(camera)).catch(() => {});
    timerId = setTimer(expire, durationMs);
  }

  function scheduleStart() {
    if (timerId !== null || currentState !== "idle" || !isDocumentVisible()) return;
    timerId = setTimer(start, 0);
  }

  function clear() {
    visible = false;
    cancelTimer();
    player.clear();
    currentState = "idle";
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (!visible) {
      cancelTimer();
      player.clear();
      currentState = "idle";
      return;
    }
    if (!isDocumentVisible()) {
      cancelTimer();
      if (currentState !== "idle") player.clear();
      currentState = "idle";
      return;
    }
    scheduleStart();
  }

  function restart() {
    if (currentState !== "expired" || !visible || !isDocumentVisible()) return false;
    currentState = "idle";
    scheduleStart();
    return true;
  }

  function state() {
    return currentState;
  }

  return { clear, restart, setVisible, state };
}
