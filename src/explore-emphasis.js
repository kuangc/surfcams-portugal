function validCameraId(cameraId) {
  return typeof cameraId === "string" && cameraId.trim().length > 0;
}

export function createExploreViewState() {
  return {
    emphasis: "map",
    selectedCameraId: null
  };
}

export function initializeExploreSelection(state, cameraId) {
  if (!validCameraId(cameraId) || state.selectedCameraId === cameraId) return state;
  return { ...state, selectedCameraId: cameraId };
}

export function selectExploreSpot(state, cameraId, { explicit = true } = {}) {
  if (!validCameraId(cameraId)) return state;
  const emphasis = explicit ? "detail" : state.emphasis;
  if (state.selectedCameraId === cameraId && state.emphasis === emphasis) return state;
  return { ...state, emphasis, selectedCameraId: cameraId };
}

export function openSelectedExploreSpot(state) {
  if (!validCameraId(state.selectedCameraId) || state.emphasis === "detail") return state;
  return { ...state, emphasis: "detail" };
}

export function expandExploreMap(state) {
  if (state.emphasis === "map") return state;
  return { ...state, emphasis: "map" };
}
