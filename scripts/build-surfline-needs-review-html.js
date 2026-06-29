#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { haversineKm } from "../src/spot-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MAPPING_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "surfline-needs-review.html");
const NAME_STOP_WORDS = new Set(["a", "as", "cam", "da", "das", "de", "do", "dos", "e", "fixa", "live", "o", "os", "panoramica", "the", "webcam"]);
const GENERIC_NAME_TOKENS = new Set(["beach", "cam", "live", "praia", "surfline", "webcam"]);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^surfline[-\s]+/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(value) {
  return normalizeName(value)
    .split(/\s+/)
    .filter((token) => token && !NAME_STOP_WORDS.has(token));
}

function nonGenericTokens(tokens) {
  return tokens.filter((token) => !GENERIC_NAME_TOKENS.has(token));
}

function tokenOverlap(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap;
}

function longestCommonRun(aTokens, bTokens) {
  let longest = 0;
  for (let aIndex = 0; aIndex < aTokens.length; aIndex += 1) {
    for (let bIndex = 0; bIndex < bTokens.length; bIndex += 1) {
      let run = 0;
      while (
        aTokens[aIndex + run]
        && aTokens[aIndex + run] === bTokens[bIndex + run]
      ) {
        run += 1;
      }
      if (run > longest) longest = run;
    }
  }
  return longest;
}

function strongPhraseMatch(meoSpot, surflineSpot) {
  const meoText = normalizeName(`${meoSpot.id} ${meoSpot.name || ""}`);
  const surflinePhrases = [
    normalizeName(surflineSpot.id),
    normalizeName(surflineSpot.name)
  ].filter(Boolean);

  return surflinePhrases.some((phrase) => {
    const tokens = nameTokens(phrase);
    return nonGenericTokens(tokens).length > 0 && meoText.includes(phrase);
  });
}

function namePoints(meoSpot, surflineSpot) {
  const meoTokens = nameTokens(`${meoSpot.id} ${meoSpot.name || ""}`);
  const surflineTokens = nameTokens(`${surflineSpot.id} ${surflineSpot.name || ""}`);
  const shared = tokenOverlap(nonGenericTokens(meoTokens), nonGenericTokens(surflineTokens));
  const overlapRatio = surflineTokens.length ? shared / Math.max(1, nonGenericTokens(surflineTokens).length) : 0;

  if (strongPhraseMatch(meoSpot, surflineSpot) || overlapRatio >= 0.75) {
    return { points: 3, reason: "strong name match" };
  }

  if (shared >= 2 || longestCommonRun(nonGenericTokens(meoTokens), nonGenericTokens(surflineTokens)) >= 2) {
    return { points: 2, reason: "long name match" };
  }

  return { points: 0, reason: "no useful name match" };
}

function distanceMeters(meoSpot, surflineSpot, fallbackDistanceKm = null) {
  if (
    Number.isFinite(meoSpot?.lat)
    && Number.isFinite(meoSpot?.lon)
    && Number.isFinite(surflineSpot?.lat)
    && Number.isFinite(surflineSpot?.lon)
  ) {
    return Math.round(haversineKm(meoSpot, surflineSpot) * 1000);
  }
  return Number.isFinite(fallbackDistanceKm) ? Math.round(fallbackDistanceKm * 1000) : null;
}

function distancePoints(meters) {
  if (!Number.isFinite(meters)) return { points: 0, reason: "unknown distance" };
  if (meters <= 100) return { points: 3, reason: "within 100m" };
  if (meters <= 300) return { points: 2, reason: "within 300m" };
  if (meters <= 500) return { points: 1, reason: "within 500m" };
  return { points: 0, reason: "more than 500m" };
}

function weightedMatchScore(meoSpot, surflineSpot, mapping, evidence) {
  const meters = distanceMeters(meoSpot, surflineSpot, mapping.distancesKm?.[surflineSpot.id]);
  const name = namePoints(meoSpot, surflineSpot);
  const distance = distancePoints(meters);

  return {
    score: name.points + distance.points,
    namePoints: name.points,
    nameReason: name.reason,
    distancePoints: distance.points,
    distanceReason: distance.reason,
    distanceMeters: meters,
    roundedDistanceKm: evidence?.distanceKm ?? mapping.distancesKm?.[surflineSpot.id] ?? null
  };
}

function compactSpot(spot) {
  const metadata = spot?.staticMetadata || {};
  return spot ? {
    id: spot.id,
    name: spot.name,
    url: spot.url,
    lat: spot.lat,
    lon: spot.lon,
    coastExposure: metadata.coastExposure?.bearing ?? null,
    guideSummary: metadata.guideSummary || "",
    breakType: metadata.breakType || [],
    bottom: metadata.travelDetails?.bottom?.value || [],
    abilityLevels: metadata.abilityLevels || []
  } : null;
}

function reviewRows({ mappingDb, meoById, surflineById }) {
  return (mappingDb.matches || [])
    .filter((mapping) => mapping.reviewStatus === "needs-review")
    .map((mapping) => {
      const meo = meoById.get(mapping.meoSpotId) || { id: mapping.meoSpotId, name: mapping.meoSpotId };
      const candidates = (mapping.surflineSpotIds || [])
        .map((surflineSpotId) => {
          const sourceSpot = surflineById.get(surflineSpotId);
          const spot = compactSpot(sourceSpot);
          const evidence = mapping.matchEvidence?.find((item) => item.surflineSpotId === surflineSpotId) || null;
          return spot ? {
            spot,
            evidence,
            match: weightedMatchScore(meo, sourceSpot, mapping, evidence)
          } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (
          b.match.score - a.match.score
          || (a.match.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.match.distanceMeters ?? Number.POSITIVE_INFINITY)
          || a.spot.name.localeCompare(b.spot.name)
        ));

      return {
        meo,
        mapping,
        bestScore: candidates[0]?.match.score ?? 0,
        candidates
      };
    })
    .sort((a, b) => (
      b.bestScore - a.bestScore
      || String(a.meo.name || a.meo.id).localeCompare(String(b.meo.name || b.meo.id))
    ));
}

function renderCandidate(candidate, row, index) {
  const distance = candidate.match.roundedDistanceKm ?? "?";
  const meters = Number.isFinite(candidate.match.distanceMeters) ? `${candidate.match.distanceMeters}m` : "distance unknown";
  const checked = index === 0 ? " checked" : "";
  const matchSummary = [
    `Match score ${candidate.match.score}/6`,
    `${candidate.match.nameReason} +${candidate.match.namePoints}`,
    `${candidate.match.distanceReason} +${candidate.match.distancePoints}`,
    meters
  ].join(" | ");
  const metadata = [
    candidate.spot.coastExposure !== null ? `coast ${candidate.spot.coastExposure}` : "",
    candidate.spot.breakType.length ? candidate.spot.breakType.join(", ") : "",
    candidate.spot.bottom.length ? `bottom ${candidate.spot.bottom.join(", ")}` : ""
  ].filter(Boolean).join(" | ");

  return `
          <label class="candidate" data-match-score="${escapeHtml(candidate.match.score)}" data-surfline-name="${escapeHtml(candidate.spot.name)}">
            <input type="radio" name="candidate-${escapeHtml(row.meo.id)}" value="${escapeHtml(candidate.spot.id)}"${checked}>
            <span>
              <strong>${escapeHtml(candidate.spot.name)}</strong>
              <small>${escapeHtml(matchSummary)}</small>
              <small>${escapeHtml(candidate.spot.id)} | ${escapeHtml(distance)}km</small>
              ${metadata ? `<small>${escapeHtml(metadata)}</small>` : ""}
              ${candidate.spot.guideSummary ? `<p>${escapeHtml(candidate.spot.guideSummary)}</p>` : ""}
            </span>
          </label>`;
}

function renderRow(row) {
  return `
      <article class="review-card" data-review-id="${escapeHtml(row.meo.id)}">
        <header>
          <div>
            <h2>${escapeHtml(row.meo.name || row.meo.id)}</h2>
            <p>${escapeHtml(row.meo.id)} | ${escapeHtml(row.meo.region || "unknown")} | ${escapeHtml(row.meo.municipality || "")}</p>
          </div>
          <a href="${escapeHtml(row.meo.url || "#")}" target="_blank" rel="noopener noreferrer">MEO page</a>
        </header>

        <fieldset>
          <legend>Choose the Surfline mapping</legend>
          ${row.candidates.map((candidate, index) => renderCandidate(candidate, row, index)).join("\n")}
        </fieldset>

        <label>
          Decision
          <select data-field="decision">
            <option value="">Unreviewed</option>
            <option value="accept">Accept selected</option>
            <option value="reject">Reject mapping</option>
          </select>
        </label>

        <label>
          Notes
          <textarea data-field="notes" rows="3" placeholder="What should this map to, or why reject it?"></textarea>
        </label>
      </article>`;
}

function renderHtml(rows) {
  const dataJson = JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length }, null, 2)
    .replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Surfline Needs Review</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1c2522;
      background: #f4f7f5;
    }
    body { margin: 0; }
    header.page-header {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #d8e0db;
      background: #ffffff;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 20px auto 48px;
    }
    h1, h2 { margin: 0; line-height: 1.2; }
    .page-header p, .review-card p { margin: 4px 0 0; color: #53635d; }
    button, select, input, textarea {
      font: inherit;
      border: 1px solid #b9c7c0;
      border-radius: 6px;
      background: #fff;
      color: #1c2522;
    }
    button {
      padding: 9px 12px;
      cursor: pointer;
      background: #1f6f58;
      color: #fff;
      border-color: #1f6f58;
    }
    .review-card {
      margin: 0 0 16px;
      padding: 18px;
      border: 1px solid #d7e0dc;
      border-radius: 8px;
      background: #fff;
    }
    .review-card > header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    fieldset {
      display: grid;
      gap: 10px;
      margin: 0 0 14px;
      padding: 0;
      border: 0;
    }
    legend {
      margin-bottom: 8px;
      font-weight: 700;
    }
    .candidate {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      padding: 12px;
      border: 1px solid #e0e7e3;
      border-radius: 6px;
      background: #fbfcfb;
    }
    .candidate small {
      display: block;
      margin-top: 3px;
      color: #5d6c66;
    }
    label { display: grid; gap: 6px; font-weight: 650; }
    label > input, label > select, label > textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      font-weight: 400;
    }
    textarea { resize: vertical; }
    .export-panel {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto 48px;
      padding: 18px;
      border: 1px solid #d7e0dc;
      border-radius: 8px;
      background: #fff;
    }
    .export-panel[hidden] { display: none; }
    .export-panel header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .export-panel textarea {
      min-height: 280px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .export-status {
      margin: 8px 0 0;
      color: #53635d;
    }
    a { color: #1b6954; }
    @media (max-width: 720px) {
      header.page-header, .review-card > header, .export-panel header { grid-template-columns: 1fr; display: grid; }
    }
  </style>
</head>
<body>
  <header class="page-header">
    <div>
      <h1>Surfline Needs Review</h1>
      <p>${rows.length} coordinate-nearby mappings are excluded from runtime until curated.</p>
    </div>
    <button id="exportFeedback" type="button">Export feedback</button>
  </header>
  <main id="needsReviewApp">
    ${rows.length ? rows.map(renderRow).join("\n") : "<p>No Surfline mappings need review.</p>"}
  </main>
  <section class="export-panel" id="exportPanel" hidden>
    <header>
      <h2>Feedback JSON</h2>
      <button id="copyFeedback" type="button">Copy JSON</button>
    </header>
    <textarea id="exportJson" readonly spellcheck="false" aria-label="Exported feedback JSON"></textarea>
    <p class="export-status" id="exportStatus">Export JSON generated below.</p>
  </section>
  <script id="reviewMeta" type="application/json">${dataJson}</script>
  <script>
    const storageKey = "surfcams:surfline-needs-review-feedback:v1";
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const exportPanel = document.querySelector("#exportPanel");
    const exportJson = document.querySelector("#exportJson");
    const exportStatus = document.querySelector("#exportStatus");

    function rowState(card) {
      const selected = card.querySelector("input[type=radio]:checked");
      const selectedCandidate = selected?.closest("[data-match-score]");
      return {
        meoSpotId: card.dataset.reviewId,
        selectedSurflineSpotId: selected?.value || "",
        selectedSurflineSpotName: selectedCandidate?.dataset.surflineName || "",
        matchScore: Number(selectedCandidate?.dataset.matchScore || 0),
        decision: card.querySelector("[data-field=decision]").value,
        notes: card.querySelector("[data-field=notes]").value.trim()
      };
    }

    function save() {
      const state = {};
      document.querySelectorAll("[data-review-id]").forEach((card) => {
        state[card.dataset.reviewId] = rowState(card);
      });
      localStorage.setItem(storageKey, JSON.stringify(state, null, 2));
    }

    function restore() {
      document.querySelectorAll("[data-review-id]").forEach((card) => {
        const state = saved[card.dataset.reviewId];
        if (!state) return;
        const radio = Array.from(card.querySelectorAll("input[type=radio]"))
          .find((input) => input.value === (state.selectedSurflineSpotId || ""));
        if (radio) radio.checked = true;
        card.querySelector("[data-field=decision]").value = state.decision || "";
        card.querySelector("[data-field=notes]").value = state.notes || "";
      });
    }

    function feedbackPayload() {
      save();
      const feedback = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return {
        exportedAt: new Date().toISOString(),
        feedback: Object.values(feedback)
      };
    }

    function exportFeedback() {
      exportJson.value = JSON.stringify(feedbackPayload(), null, 2) + "\\n";
      exportPanel.hidden = false;
      exportStatus.textContent = "Export JSON generated below.";
      exportJson.focus();
      exportJson.select();
    }

    async function copyFeedback() {
      if (!exportJson.value) exportFeedback();
      try {
        await navigator.clipboard.writeText(exportJson.value);
        exportStatus.textContent = "Copied feedback JSON.";
      } catch {
        exportJson.focus();
        exportJson.select();
        exportStatus.textContent = "Copy the selected feedback JSON.";
      }
    }

    restore();
    document.addEventListener("input", save);
    document.addEventListener("change", save);
    document.querySelector("#exportFeedback").addEventListener("click", exportFeedback);
    document.querySelector("#copyFeedback").addEventListener("click", copyFeedback);
  </script>
</body>
</html>
`;
}

async function main() {
  const [meoDb, surflineDb, mappingDb] = await Promise.all([
    readJson(MEO_DB_PATH),
    readJson(SURFLINE_DB_PATH),
    readJson(MAPPING_DB_PATH)
  ]);
  const meoById = new Map((meoDb.spots || []).map((spot) => [spot.id, spot]));
  const surflineById = new Map((surflineDb.spots || []).map((spot) => [spot.id, spot]));
  const rows = reviewRows({ mappingDb, meoById, surflineById });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, renderHtml(rows), "utf8");
  console.log(`Wrote ${rows.length} needs-review mappings to docs/surfline-needs-review.html.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
