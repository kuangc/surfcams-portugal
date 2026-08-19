/**
 * Provider-native MEO camera identity migrations.
 *
 * Keep these separate from Surfline spot IDs: the same text can still be a
 * valid Surfline intelligence subject even after a legacy MEO camera identity
 * is renamed or retired.
 */
export const MEO_CAMERA_ID_RENAMES = Object.freeze({
  "espinho-silvade": "espinho-silvalde",
  espinhosilvadeestatica: "espinhosilvaldeestatica"
});

export const RETIRED_MEO_CAMERA_IDS = Object.freeze([
  "surfline-castelo"
]);

export const MEO_FAVORITE_ID_REPLACEMENTS = Object.freeze({
  ...MEO_CAMERA_ID_RENAMES,
  "surfline-castelo": "costa-da-caparica-riviera"
});

const RETIRED_MEO_CAMERA_ID_SET = new Set(RETIRED_MEO_CAMERA_IDS);

/**
 * Resolve a provider-native camera ID through the current one-hop migration.
 * Surfline spot IDs intentionally use a different identity namespace.
 */
export function canonicalMeoCameraId(id) {
  if (typeof id !== "string") return null;
  const normalizedId = id.trim();
  if (!normalizedId || RETIRED_MEO_CAMERA_ID_SET.has(normalizedId)) return null;
  return MEO_CAMERA_ID_RENAMES[normalizedId] || normalizedId;
}

/** Return only the direct former camera IDs for a current MEO camera ID. */
export function predecessorMeoCameraIds(currentId) {
  if (typeof currentId !== "string") return [];
  const normalizedId = currentId.trim();
  if (!normalizedId) return [];

  return Object.entries(MEO_CAMERA_ID_RENAMES)
    .filter(([, replacementId]) => replacementId === normalizedId)
    .map(([formerId]) => formerId);
}
