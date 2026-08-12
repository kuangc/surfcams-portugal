export function createFullscreenController({
  target,
  document: fullscreenDocument,
  onStateChange = () => {},
  onError = () => {}
}) {
  const supported = Boolean(
    fullscreenDocument
    && fullscreenDocument.fullscreenEnabled !== false
    && typeof fullscreenDocument.exitFullscreen === "function"
    && typeof target?.requestFullscreen === "function"
  );
  let destroyed = false;

  function isFullscreen() {
    return supported && fullscreenDocument.fullscreenElement === target;
  }

  function state() {
    const active = isFullscreen();
    return {
      supported,
      active,
      label: !supported
        ? "Fullscreen unavailable"
        : active
          ? "Exit fullscreen"
          : "Enter fullscreen"
    };
  }

  function syncState() {
    if (!destroyed) onStateChange(state());
  }

  function reportFailure(error) {
    onError(error);
    return false;
  }

  function settle(operation) {
    return Promise.resolve(operation).then(
      () => true,
      (error) => reportFailure(error)
    );
  }

  function enter() {
    if (!supported || destroyed) return Promise.resolve(false);
    try {
      return settle(target.requestFullscreen());
    } catch (error) {
      return Promise.resolve(reportFailure(error));
    }
  }

  function exit() {
    if (!supported || destroyed) return Promise.resolve(false);
    try {
      return settle(fullscreenDocument.exitFullscreen());
    } catch (error) {
      return Promise.resolve(reportFailure(error));
    }
  }

  function toggle() {
    return isFullscreen() ? exit() : enter();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    fullscreenDocument?.removeEventListener?.("fullscreenchange", syncState);
  }

  fullscreenDocument?.addEventListener?.("fullscreenchange", syncState);
  syncState();

  return {
    supported,
    destroy,
    enter,
    exit,
    isFullscreen,
    state,
    toggle
  };
}
