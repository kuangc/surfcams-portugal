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

export function explorePlaybackCamera(subject, playbackCameras) {
  if (!subject || !Array.isArray(playbackCameras)) return null;
  const playbackById = new Map(playbackCameras.map((camera) => [camera.id, camera]));
  const candidateIds = [
    subject.id,
    subject.linkedCamId,
    ...(Array.isArray(subject.stretchCamIds) ? subject.stretchCamIds : [])
  ];
  return candidateIds.map((id) => playbackById.get(id)).find(Boolean) || null;
}
