export function formatRegion(region) {
  return region
    ? region.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Other";
}

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

