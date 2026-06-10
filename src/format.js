export function formatRegion(region) {
  return region
    ? region.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Other";
}

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function formatTideState(value) {
  const key = normalizeText(value);
  const labels = {
    "baixa-mar": "Low",
    "baixa mar": "Low",
    "preia-mar": "High",
    "preia mar": "High",
    "praia-mar": "High",
    enchente: "Rising",
    vazante: "Falling"
  };

  return labels[key] || value || "";
}
