export function formatRegion(region) {
  return region
    ? region.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Other";
}

export function formatTideState(tideState) {
  const normalized = normalizeText(tideState)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const labels = {
    "baixa-mar": "Low tide",
    "preia-mar": "High tide",
    preamar: "High tide"
  };

  return labels[normalized] || String(tideState || "");
}

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}
