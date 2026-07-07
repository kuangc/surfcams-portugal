#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const PROMOTIONS_PATH = path.join(ROOT, "data", "surfline-promotions.json");
const PROMOTED_SPOTS_PATH = path.join(ROOT, "data", "promoted-spots.json");
const MATCHES_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, "docs", "surfline-promotion-map.html");

const FENCE = { north: 39.65, south: 38.40, westOfLon: -9.05 };

// Equirectangular projection constants shared by model assembly and the
// in-page SVG renderer.
const PROJECTION = { lon0: -9.56, latMax: 39.67, latMin: 38.38 };
const PROJECTION_K = 720 / (PROJECTION.latMax - PROJECTION.latMin);

export function parseCliArgs(argv, { knownFlags = ["--out"] } = {}) {
  const values = {};
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.match(/^(--[^=]+)=(.*)$/);
    const flag = eq ? eq[1] : arg;
    if (!flag.startsWith("--")) { errors.push(`Unexpected argument: ${arg}`); continue; }
    if (!knownFlags.includes(flag)) { errors.push(`Unknown argument: ${flag}`); continue; }
    let value = eq ? eq[2] : argv[i + 1];
    if (!eq) i += 1;
    if (value === undefined || value === "" || String(value).startsWith("--")) {
      errors.push(`Missing value for ${flag}`);
      if (!eq && String(value || "").startsWith("--")) i -= 1; // don't swallow the next flag
      continue;
    }
    values[flag] = value;
  }
  return { values, errors };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJsonForScriptTag(json) {
  return json.replaceAll("<", "\\u003c");
}

function isInFence(spot, fence) {
  return (
    Number.isFinite(spot.lat)
    && Number.isFinite(spot.lon)
    && spot.lat >= fence.south
    && spot.lat <= fence.north
    && spot.lon <= fence.westOfLon
  );
}

/**
 * Find, for a single wanted surfline spot lacking direct "spot" cam coverage,
 * the nearest stream-carrying MEO cam mentioned in the matches file, along
 * with that match row's reviewStatus. Returns null when no candidate exists
 * (e.g. the matches file has nothing for this spot, or promoted-spots.json
 * is absent so the caller never asks).
 */
function nearestReviewCandidate(surflineSpotId, { matchesDb, meoById }) {
  let best = null;
  for (const row of matchesDb?.matches || []) {
    const distanceKm = row.distancesKm?.[surflineSpotId];
    if (!Number.isFinite(distanceKm)) continue;
    const meo = meoById.get(row.meoSpotId);
    if (!meo?.hasStream) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { nearestCamId: row.meoSpotId, distanceKm, reviewStatus: row.reviewStatus || "unknown" };
    }
  }
  return best;
}

export async function buildPromotionMapModel({ surflineDb, promotions, promotedSpotsDb, matchesDb, meoDb }) {
  const wantedIds = new Set((promotions.promoted || []).map((p) => p.surflineSpotId));
  const notesById = new Map(
    (promotions.promoted || [])
      .filter((p) => p.note)
      .map((p) => [p.surflineSpotId, p.note])
  );

  const promotedById = new Map((promotedSpotsDb?.promoted || []).map((p) => [p.id, p]));
  const deferredById = new Map((promotedSpotsDb?.deferred || []).map((d) => [d.surflineSpotId, d]));
  const meoById = new Map((meoDb?.spots || []).map((m) => [m.id, m]));

  const spots = (surflineDb.spots || [])
    .filter((spot) => isInFence(spot, FENCE))
    .map((spot) => {
      const promotedRow = promotedById.get(spot.id) || null;
      const deferredRow = deferredById.get(spot.id) || null;
      return {
        id: spot.id,
        name: spot.name,
        lat: spot.lat,
        lon: spot.lon,
        camCoverage: promotedRow?.camCoverage ?? null,
        deferredReason: deferredRow?.reason ?? null,
        wanted: wantedIds.has(spot.id),
        linkedCamId: promotedRow?.linkedCamId ?? null
      };
    })
    .sort((a, b) => b.lat - a.lat || a.name.localeCompare(b.name));

  const reviewQueue = [];
  if (matchesDb) {
    for (const spot of spots) {
      if (!spot.wanted || spot.camCoverage === "spot") continue;
      const candidate = nearestReviewCandidate(spot.id, { matchesDb, meoById });
      if (!candidate) continue;
      reviewQueue.push({
        surflineSpotId: spot.id,
        spotName: spot.name,
        nearestCamId: candidate.nearestCamId,
        distanceKm: candidate.distanceKm,
        reviewStatus: candidate.reviewStatus,
        camCoverage: spot.camCoverage
      });
    }
    // Zero-coverage spots surface first so they don't get buried among
    // stretch-covered spots (which already have some coverage nearby).
    // Array.prototype.sort is stable, so within each group the existing
    // (distance-ascending) order is preserved.
    reviewQueue.sort((a, b) => a.distanceKm - b.distanceKm);
    reviewQueue.sort((a, b) => (a.camCoverage === "stretch" ? 1 : 0) - (b.camCoverage === "stretch" ? 1 : 0));
  }

  return {
    generatedAt: new Date().toISOString(),
    fence: FENCE,
    spots,
    reviewQueue,
    notesById: Object.fromEntries(notesById),
    promoteOnlyWithTrustedCam: promotions.promoteOnlyWithTrustedCam ?? true
  };
}

function project(lat, lon) {
  const x = (lon - PROJECTION.lon0) * PROJECTION_K * Math.cos((39 * Math.PI) / 180);
  const y = (PROJECTION.latMax - lat) * PROJECTION_K;
  return { x, y };
}

function dotColor(spot) {
  if (spot.camCoverage === "spot") return "#2a7";
  if (spot.camCoverage === "stretch") return "#e90";
  if (spot.wanted) return "none"; // wanted-but-deferred: gray outline only, no fill
  return "#59d";
}

function dotStroke(spot) {
  if (spot.wanted && spot.camCoverage !== "spot" && spot.camCoverage !== "stretch") return "#888";
  return "none";
}

function renderDot(spot) {
  const { x, y } = project(spot.lat, spot.lon);
  const fill = dotColor(spot);
  const stroke = dotStroke(spot);
  const strokeAttr = stroke !== "none" ? ` stroke="${stroke}" stroke-width="2"` : "";
  const fillAttr = fill === "none" ? "none" : fill;
  return `<circle class="spot-dot" data-id="${escapeHtml(spot.id)}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5" fill="${fillAttr}"${strokeAttr}><title>${escapeHtml(spot.name)} (${escapeHtml(spot.id)}) — ${escapeHtml(spot.camCoverage || "no coverage")}</title></circle>`;
}

function renderFenceLine(lat, label, viewWidth) {
  const { y } = project(lat, PROJECTION.lon0);
  return `<line x1="0" y1="${y.toFixed(2)}" x2="${viewWidth}" y2="${y.toFixed(2)}" stroke="#999" stroke-width="1" stroke-dasharray="6,5" />
    <text x="6" y="${(y - 6).toFixed(2)}" class="fence-label">${escapeHtml(label)}</text>`;
}

function renderMap(model) {
  const lats = model.spots.map((s) => s.lat);
  const lons = model.spots.map((s) => s.lon);
  const minLat = Math.min(model.fence.south, ...lats);
  const maxLat = Math.max(model.fence.north, ...lats);
  const maxLon = Math.max(...lons, PROJECTION.lon0);
  const minLon = Math.min(...lons);

  const topLeft = project(maxLat + 0.03, minLon - 0.03);
  const bottomRight = project(minLat - 0.03, maxLon + 0.03);
  const viewWidth = Math.max(200, bottomRight.x - topLeft.x);
  const viewHeight = Math.max(200, bottomRight.y - topLeft.y);

  const dots = model.spots.map(renderDot).join("\n    ");
  const fenceLines = [
    renderFenceLine(model.fence.north, `north fence ${model.fence.north}°`, viewWidth),
    renderFenceLine(model.fence.south, `south fence ${model.fence.south}°`, viewWidth)
  ].join("\n    ");

  return `<svg viewBox="${topLeft.x.toFixed(2)} ${topLeft.y.toFixed(2)} ${viewWidth.toFixed(2)} ${viewHeight.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" id="coastMap" role="img" aria-label="Coast map of in-fence Surfline spots">
    ${fenceLines}
    ${dots}
  </svg>`;
}

function latBandLabel(lat) {
  const bandStart = Math.floor(lat * 10) / 10;
  return `${bandStart.toFixed(1)}° – ${(bandStart + 0.1).toFixed(1)}°`;
}

function renderCheckboxRow(spot) {
  const checkedAttr = spot.wanted ? " checked" : "";
  const coverageLabel = spot.camCoverage
    ? spot.camCoverage
    : (spot.wanted ? "deferred" : "no coverage");
  const badgeClass = spot.camCoverage === "spot"
    ? "badge badge-spot"
    : spot.camCoverage === "stretch"
      ? "badge badge-stretch"
      : (spot.wanted ? "badge badge-deferred" : "badge badge-none");
  const deferredNote = spot.deferredReason ? `<small class="deferred-reason">${escapeHtml(spot.deferredReason)}</small>` : "";
  const linkedCam = spot.linkedCamId ? `<small class="linked-cam">cam: ${escapeHtml(spot.linkedCamId)}</small>` : "";

  return `
        <label class="spot-row" data-id="${escapeHtml(spot.id)}">
          <input type="checkbox" class="spot-checkbox" data-id="${escapeHtml(spot.id)}"${checkedAttr}>
          <span class="spot-row-main">
            <strong>${escapeHtml(spot.name)}</strong>
            <span class="${badgeClass}">${escapeHtml(coverageLabel)}</span>
          </span>
          <small class="spot-id">${escapeHtml(spot.id)}</small>
          ${linkedCam}
          ${deferredNote}
        </label>`;
}

function renderCheckboxList(spots) {
  const bands = new Map();
  for (const spot of spots) {
    const label = latBandLabel(spot.lat);
    if (!bands.has(label)) bands.set(label, []);
    bands.get(label).push(spot);
  }
  const bandLabels = Array.from(bands.keys()).sort((a, b) => b.localeCompare(a));

  return bandLabels.map((label) => `
      <section class="lat-band">
        <h3>${escapeHtml(label)}</h3>
        ${bands.get(label).map(renderCheckboxRow).join("\n")}
      </section>`).join("\n");
}

function reviewCoverageBadge(camCoverage) {
  return camCoverage === "stretch"
    ? `<span class="badge badge-stretch">stretch cam nearby — confirm exact cam</span>`
    : `<span class="badge badge-none">no coverage yet</span>`;
}

function renderReviewCard(item) {
  const groupName = `review-${item.surflineSpotId}`;
  return `
      <article class="review-card" data-surfline-id="${escapeHtml(item.surflineSpotId)}" data-review-id="${escapeHtml(item.surflineSpotId)}">
        <header>
          <h3>${escapeHtml(item.spotName)}</h3>
          <p>${escapeHtml(item.surflineSpotId)}</p>
        </header>
        <p>${reviewCoverageBadge(item.camCoverage)}</p>
        <p>Nearest cam: <strong>${escapeHtml(item.nearestCamId)}</strong> · ${escapeHtml(item.distanceKm)}km · status: ${escapeHtml(item.reviewStatus)}</p>
        <fieldset>
          <label><input type="radio" name="${escapeHtml(groupName)}" data-field="decision" value="accept"> Accept</label>
          <label><input type="radio" name="${escapeHtml(groupName)}" data-field="decision" value="reject"> Reject</label>
        </fieldset>
        <label>
          Notes
          <input type="text" data-field="notes" placeholder="Optional notes">
        </label>
      </article>`;
}

function renderReviewQueue(reviewQueue) {
  if (!reviewQueue.length) {
    return `<p>No review-queue items — every wanted spot with non-"spot" coverage has no nearby stream cam candidate, or promoted-spots.json has not been generated yet.</p>`;
  }
  // Defensive sort: the CLI model assembly already orders zero-coverage
  // spots first, but the renderer re-sorts (stably) so callers that pass
  // an unsorted reviewQueue still get zero-coverage spots surfaced first.
  const sorted = reviewQueue
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aStretch = a.item.camCoverage === "stretch" ? 1 : 0;
      const bStretch = b.item.camCoverage === "stretch" ? 1 : 0;
      return aStretch - bStretch || a.index - b.index;
    })
    .map(({ item }) => item);
  return sorted.map(renderReviewCard).join("\n");
}

export function renderPromotionMapHtml(model) {
  const bootstrapJson = escapeJsonForScriptTag(JSON.stringify({
    spots: model.spots,
    reviewQueue: model.reviewQueue,
    notesById: model.notesById || {},
    promoteOnlyWithTrustedCam: model.promoteOnlyWithTrustedCam ?? true,
    generatedAt: model.generatedAt,
    fence: model.fence
  }, null, 2));

  const wantedCount = model.spots.filter((s) => s.wanted).length;
  const totalCount = model.spots.length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Surfline Promotion Map</title>
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
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #d8e0db;
      background: #ffffff;
    }
    header.page-header .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 20px auto 48px;
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(280px, 420px);
      gap: 20px;
    }
    h1, h2, h3 { margin: 0; line-height: 1.2; }
    .page-header p { margin: 4px 0 0; color: #53635d; }
    button, input, textarea {
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
    button.secondary {
      background: #fff;
      color: #1f6f58;
    }
    .map-panel, .list-panel, .export-panel, .review-panel {
      padding: 18px;
      border: 1px solid #d7e0dc;
      border-radius: 8px;
      background: #fff;
    }
    .map-panel svg { width: 100%; height: auto; display: block; }
    .fence-label { font-size: 11px; fill: #777; }
    .spot-dot { cursor: pointer; transition: r 0.1s ease; }
    .spot-dot:hover { r: 7; }
    .spot-dot.selected { stroke: #16302a; stroke-width: 3; }
    .list-panel { max-height: 640px; overflow-y: auto; }
    .lat-band h3 { margin: 14px 0 6px; color: #53635d; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
    .lat-band:first-child h3 { margin-top: 0; }
    .spot-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 10px;
      align-items: center;
      padding: 6px 4px;
      border-radius: 6px;
      cursor: pointer;
    }
    .spot-row:hover { background: #f2f6f4; }
    .spot-row.selected { background: #e6f2ee; }
    .spot-row-main { display: flex; align-items: center; gap: 8px; }
    .spot-id, .deferred-reason, .linked-cam { grid-column: 2; color: #5d6c66; }
    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      font-weight: 650;
    }
    .badge-spot { background: #e3f6ec; color: #1f6f58; }
    .badge-stretch { background: #fdf0da; color: #92600a; }
    .badge-deferred { background: #ececec; color: #666; }
    .badge-none { background: #e6eefb; color: #2a5db0; }
    fieldset { display: flex; gap: 14px; margin: 10px 0; padding: 0; border: 0; }
    fieldset label { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    label { display: grid; gap: 6px; font-weight: 650; }
    label > input, label > textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      font-weight: 400;
    }
    textarea { resize: vertical; min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
    .review-card {
      margin: 0 0 14px;
      padding: 14px;
      border: 1px solid #e0e7e3;
      border-radius: 6px;
      background: #fbfcfb;
    }
    .review-card header { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .review-card p { margin: 4px 0; color: #444; }
    .export-panel[hidden], .review-panel[hidden] { display: none; }
    .export-panel { grid-column: 1 / -1; }
    .review-panel { grid-column: 1 / -1; }
    .export-status { margin: 8px 0 0; color: #53635d; }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="page-header">
    <div>
      <h1>Surfline Promotion Map</h1>
      <p id="selectionCount">${wantedCount} of ${totalCount} selected</p>
    </div>
    <div class="actions">
      <button id="selectAll" type="button" class="secondary">Select all</button>
      <button id="clearAll" type="button" class="secondary">Clear</button>
      <button id="resetManifest" type="button" class="secondary">Reset spot selection</button>
      <button id="exportManifest" type="button">Export manifest</button>
    </div>
  </header>
  <main>
    <section class="map-panel">
      ${renderMap(model)}
    </section>
    <section class="list-panel" id="spotList">
      ${renderCheckboxList(model.spots)}
    </section>
    <section class="export-panel" id="exportPanel" hidden>
      <header>
        <h2>Manifest JSON</h2>
      </header>
      <textarea id="manifestJson" readonly spellcheck="false" aria-label="Exported surfline-promotions.json"></textarea>
      <p class="export-status" id="exportStatus">Export JSON generated below.</p>
    </section>
    <section class="review-panel">
      <h2>Review queue</h2>
      <p>Wanted spots whose cam coverage is not a direct "spot" match, alongside the nearest stream-carrying MEO cam.</p>
      <p>Accepting a candidate marks it curated — the spot graduates to at-spot coverage on the next data rebuild.</p>
      ${renderReviewQueue(model.reviewQueue)}
      <button id="exportFeedback" type="button">Export feedback</button>
      <section class="export-panel" id="feedbackPanel" hidden>
        <textarea id="feedbackJson" readonly spellcheck="false" aria-label="Exported apply-mapping-feedback JSON"></textarea>
      </section>
    </section>
  </main>
  <script id="promotionMapData" type="application/json">${bootstrapJson}</script>
  <script>
    const bootstrap = JSON.parse(document.querySelector("#promotionMapData").textContent);
    const wantedManifest = new Set(bootstrap.spots.filter((s) => s.wanted).map((s) => s.id));
    const selected = new Set(wantedManifest);

    function isSelected(id) { return selected.has(id); }

    function syncDot(id) {
      const dot = document.querySelector('.spot-dot[data-id="' + CSS.escape(id) + '"]');
      if (dot) dot.classList.toggle("selected", isSelected(id));
    }

    function syncRow(id) {
      const row = document.querySelector('.spot-row[data-id="' + CSS.escape(id) + '"]');
      if (row) row.classList.toggle("selected", isSelected(id));
      const checkbox = document.querySelector('.spot-checkbox[data-id="' + CSS.escape(id) + '"]');
      if (checkbox) checkbox.checked = isSelected(id);
    }

    function syncAll() {
      for (const spot of bootstrap.spots) {
        syncDot(spot.id);
        syncRow(spot.id);
      }
      updateCount();
    }

    function updateCount() {
      document.querySelector("#selectionCount").textContent = selected.size + " of " + bootstrap.spots.length + " selected";
    }

    function toggle(id) {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      syncDot(id);
      syncRow(id);
      updateCount();
    }

    document.querySelectorAll(".spot-dot").forEach((dot) => {
      dot.addEventListener("click", () => toggle(dot.dataset.id));
    });
    document.querySelectorAll(".spot-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", () => toggle(checkbox.dataset.id));
    });

    document.querySelector("#selectAll").addEventListener("click", () => {
      for (const spot of bootstrap.spots) selected.add(spot.id);
      syncAll();
    });
    document.querySelector("#clearAll").addEventListener("click", () => {
      selected.clear();
      syncAll();
    });
    document.querySelector("#resetManifest").addEventListener("click", () => {
      selected.clear();
      for (const id of wantedManifest) selected.add(id);
      syncAll();
    });

    const exportPanel = document.querySelector("#exportPanel");
    const manifestJson = document.querySelector("#manifestJson");
    const exportStatus = document.querySelector("#exportStatus");

    function exportManifest() {
      const promoted = bootstrap.spots
        .filter((spot) => selected.has(spot.id))
        .map((spot) => {
          const note = bootstrap.notesById[spot.id];
          return note ? { surflineSpotId: spot.id, note } : { surflineSpotId: spot.id };
        });
      const payload = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString().slice(0, 10),
        promoteOnlyWithTrustedCam: bootstrap.promoteOnlyWithTrustedCam,
        promoted
      };
      manifestJson.value = JSON.stringify(payload, null, 2) + "\\n";
      exportPanel.hidden = false;
      exportStatus.textContent = "Export JSON generated below.";
      manifestJson.focus();
      manifestJson.select();
    }

    document.querySelector("#exportManifest").addEventListener("click", exportManifest);

    const feedbackPanel = document.querySelector("#feedbackPanel");
    const feedbackJson = document.querySelector("#feedbackJson");

    function exportFeedback() {
      const feedback = [];
      document.querySelectorAll(".review-card").forEach((card) => {
        const surflineSpotId = card.dataset.surflineId;
        const item = bootstrap.reviewQueue.find((entry) => entry.surflineSpotId === surflineSpotId);
        const decisionInput = card.querySelector('input[data-field="decision"]:checked');
        if (!decisionInput) return;
        const decision = decisionInput.value;
        const notes = card.querySelector('[data-field="notes"]').value.trim();
        feedback.push({
          meoSpotId: item ? item.nearestCamId : null,
          decision,
          selectedSurflineSpotId: surflineSpotId,
          notes
        });
      });
      feedbackJson.value = JSON.stringify(feedback, null, 2) + "\\n";
      feedbackPanel.hidden = false;
      feedbackJson.focus();
      feedbackJson.select();
    }

    document.querySelector("#exportFeedback").addEventListener("click", exportFeedback);

    syncAll();
  </script>
</body>
</html>
`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const { values, errors } = parseCliArgs(process.argv.slice(2));
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exitCode = 1;
    return;
  }
  const OUT_FILE = values["--out"] ? path.resolve(values["--out"]) : DEFAULT_OUTPUT_PATH;

  const [surflineDb, promotions, promotedSpotsDb, matchesDb, meoDb] = await Promise.all([
    readJson(SURFLINE_DB_PATH),
    readJson(PROMOTIONS_PATH),
    readJsonIfExists(PROMOTED_SPOTS_PATH),
    readJsonIfExists(MATCHES_DB_PATH),
    readJsonIfExists(MEO_DB_PATH)
  ]);

  const model = await buildPromotionMapModel({ surflineDb, promotions, promotedSpotsDb, matchesDb, meoDb });

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, renderPromotionMapHtml(model), "utf8");
  console.log(`Wrote ${model.spots.length} in-fence spots (${model.spots.filter((s) => s.wanted).length} wanted, ${model.reviewQueue.length} review-queue items) to ${path.relative(ROOT, OUT_FILE)}.`);
  if (!promotedSpotsDb) {
    console.log("Note: data/promoted-spots.json not found — camCoverage/linkedCamId are null for all spots until that pipeline step runs.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
