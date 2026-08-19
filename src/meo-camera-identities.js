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
