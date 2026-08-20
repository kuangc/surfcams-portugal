export const DEFAULT_FAVORITE_IDS = [
  "sao-pedro-do-estoril",
  "costa-da-caparica-riviera",
  "lagide-e-baia",
  "praia-sesimbra",
  "sao-juliao",
  "fonte-da-telha"
];

export const INITIAL_BOUNDS_IDS = [
  "peniche-baleal-panoramica",
  "praia-sesimbra"
];

export const FAVORITE_STORAGE_KEY = "surfcamFavoriteIds:v3";
export const SURF_PREFERENCES_STORAGE_KEY = "surfcamSurfPreferences:v3";
export const CAMERA_DB_URL = "./data/beachcam-cameras.json";
export const SURFLINE_SPOTS_URL = "./data/surfline-spots.json";
export const MEO_SPOTS_URL = "./data/meo-spots.json";
export const MEO_SURFLINE_MATCHES_URL = "./data/meo-surfline-matches.json";
export const LISBON_DRIVE_ESTIMATES_URL = "./data/lisbon-drive-estimates.json";
export const COAST_EXPOSURES_URL = "./data/coast-exposures.json";
export const SPOT_METADATA_ENRICHMENT_URL = "./data/spot-metadata-enrichment.json";
export const PORTUGAL_TIDES_URL = "./data/portugal-tides.json";
export const MAX_CAMERA_LIST_ROWS = 90;
export const HLS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.6.4/dist/hls.min.js";
export const PROMOTED_SPOTS_URL = "./data/promoted-spots.json";
export const SURFLINE_CONDITIONS_URL = "./data/surfline-conditions.json";
export const STRETCHES_URL = "./data/stretches.json";
export const SPOT_ADVICE_URL = "./data/spot-advice-resolved.json";
export const SUGGESTION_FENCE = { north: 39.65, south: 38.40, westOfLon: -9.05 };
export const SURFLINE_FRESH_MAX_AGE_HOURS = 6;
export const LIVE_MODEL_MAX_AGE_HOURS = 2;
export const CONDITIONS_STALE_BANNER_HOURS = SURFLINE_FRESH_MAX_AGE_HOURS;
