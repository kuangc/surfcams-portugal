export const NAME_SCORE_THRESHOLD = 0.5;
export const NAME_MATCH_MAX_KM = 3;
export const PROXIMITY_MAX_KM = 0.2;

// Caparica/Fonte-da-Telha strip: shared regional name stems make n-gram scores unreliable.
const CAPARICA_ZONE = { latMin: 38.55, latMax: 38.69, lonMin: -9.30, lonMax: -9.15 };

export function normalizeSlugName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function slugNamesMatch(a, b) {
  const na = normalizeSlugName(a);
  const nb = normalizeSlugName(b);
  if (na.length <= 3 || nb.length <= 3) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function inCaparicaAmbiguityZone(lat, lon) {
  return lat >= CAPARICA_ZONE.latMin && lat <= CAPARICA_ZONE.latMax
    && lon >= CAPARICA_ZONE.lonMin && lon <= CAPARICA_ZONE.lonMax;
}

export function evaluateAssociation({
  nameScore = 0, distanceKm = null, curated = false,
  camLat = null, camLon = null, surflineName = "", meoName = ""
}) {
  if (curated) return { trusted: true, why: "curated" };
  const finiteDistance = Number.isFinite(distanceKm);
  const inZone = Number.isFinite(camLat) && Number.isFinite(camLon)
    && inCaparicaAmbiguityZone(camLat, camLon);
  const nameHit = !inZone
    && (nameScore >= NAME_SCORE_THRESHOLD || slugNamesMatch(surflineName, meoName))
    && finiteDistance && distanceKm <= NAME_MATCH_MAX_KM;
  if (nameHit) return { trusted: true, why: "name" };
  if (finiteDistance && distanceKm <= PROXIMITY_MAX_KM) return { trusted: true, why: "proximity" };
  return { trusted: false, why: "untrusted" };
}
