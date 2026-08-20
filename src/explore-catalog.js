const MEDIA_FIELDS = new Set([
  "streamUrl",
  "videoId",
  "livecamId",
  "image",
  "poster",
  "stillUrl",
  "surflineCams"
]);

function informationSubject(record) {
  const subject = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (!MEDIA_FIELDS.has(key)) subject[key] = value;
  }
  return {
    ...subject,
    hasStream: false,
    exploreInformationOnly: true
  };
}

export function buildExploreCatalog(playbackCameras, canonicalDb) {
  const playable = Array.isArray(playbackCameras) ? playbackCameras : [];
  const canonical = Array.isArray(canonicalDb?.cameras) ? canonicalDb.cameras : [];
  const seen = new Set(playable.map((camera) => camera?.id).filter(Boolean));
  const subjects = [...playable];

  for (const record of canonical) {
    if (
      !record?.id
      || seen.has(record.id)
      || (!record.promoted && !record.adviceGuideOnly)
    ) {
      continue;
    }
    seen.add(record.id);
    subjects.push(informationSubject(record));
  }

  return subjects;
}

export function createExplorePlaybackIndex(playbackCameras) {
  const cameras = Array.isArray(playbackCameras) ? playbackCameras : [];
  return {
    cameras,
    byId: new Map(cameras.map((camera) => [camera.id, camera]))
  };
}

function playbackIndex(playbackCamerasOrIndex) {
  if (playbackCamerasOrIndex?.byId instanceof Map) return playbackCamerasOrIndex;
  return createExplorePlaybackIndex(playbackCamerasOrIndex);
}

export function explorePlaybackCamera(subject, playbackCamerasOrIndex) {
  if (!subject) return null;
  const byId = playbackIndex(playbackCamerasOrIndex).byId;
  const candidateIds = [
    subject.id,
    subject.linkedCamId,
    ...(Array.isArray(subject.stretchCamIds) ? subject.stretchCamIds : [])
  ];
  return candidateIds.map((id) => byId.get(id)).find(Boolean) || null;
}

export function favoriteExploreIds(subjects, playbackCamerasOrIndex, favoriteCatalogIndex) {
  const ids = new Set();
  const allSubjects = Array.isArray(subjects) ? subjects : [];
  for (const subject of allSubjects) {
    const playbackCamera = explorePlaybackCamera(subject, playbackCamerasOrIndex);
    const record = playbackCamera?.id
      ? favoriteCatalogIndex?.recordByCameraId?.get?.(playbackCamera.id) || null
      : null;
    if (record?.saved) ids.add(subject.id);
  }
  return ids;
}
