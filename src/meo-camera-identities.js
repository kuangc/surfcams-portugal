/** Provider-native camera IDs corrected by MEO without changing camera identity. */
export const MEO_CAMERA_ID_RENAMES = Object.freeze({
  "espinho-silvade": "espinho-silvalde",
  espinhosilvadeestatica: "espinhosilvaldeestatica"
});

export function canonicalMeoCameraId(id) {
  if (typeof id !== "string") return id;
  return Object.hasOwn(MEO_CAMERA_ID_RENAMES, id)
    ? MEO_CAMERA_ID_RENAMES[id]
    : id;
}
