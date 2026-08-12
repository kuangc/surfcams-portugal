function isCameraId(cameraId) {
  return typeof cameraId === "string" && cameraId.trim().length > 0;
}

export function createMonitorViewState() {
  return {
    view: "gallery",
    focusedCameraIds: [],
    galleryScrollY: 0,
    originCameraId: null
  };
}

export function openMonitorFocus(
  state,
  cameraId,
  { scrollY = 0, originCameraId = cameraId } = {}
) {
  if (!isCameraId(cameraId)) return state;
  return {
    view: "focus-one",
    focusedCameraIds: [cameraId],
    galleryScrollY: Number.isFinite(scrollY) ? scrollY : 0,
    originCameraId: isCameraId(originCameraId) ? originCameraId : cameraId
  };
}

export function addComparisonCamera(state, cameraId) {
  if (
    state.view !== "focus-one"
    || state.focusedCameraIds.length !== 1
    || !isCameraId(cameraId)
    || state.focusedCameraIds.includes(cameraId)
  ) return state;

  return {
    ...state,
    view: "compare-two",
    focusedCameraIds: [...state.focusedCameraIds, cameraId]
  };
}

export function replaceFocusedCamera(state, paneIndex, cameraId) {
  if (
    !["focus-one", "compare-two"].includes(state.view)
    || !Number.isInteger(paneIndex)
    || paneIndex < 0
    || paneIndex >= state.focusedCameraIds.length
    || !isCameraId(cameraId)
    || state.focusedCameraIds.includes(cameraId)
  ) return state;

  const focusedCameraIds = [...state.focusedCameraIds];
  focusedCameraIds[paneIndex] = cameraId;
  return { ...state, focusedCameraIds };
}

export function removeComparisonCamera(state, paneIndex) {
  if (
    state.view !== "compare-two"
    || state.focusedCameraIds.length !== 2
    || !Number.isInteger(paneIndex)
    || paneIndex < 0
    || paneIndex > 1
  ) return state;

  return {
    ...state,
    view: "focus-one",
    focusedCameraIds: state.focusedCameraIds.filter((_cameraId, index) => index !== paneIndex)
  };
}

export function exitMonitorFocus(state) {
  if (state.view === "gallery") return state;
  return {
    ...state,
    view: "gallery",
    focusedCameraIds: []
  };
}
