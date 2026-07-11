#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { digestDocument } from "./lib/spot-advice-build.js";
import { buildDynamicReviewSpots, isSafeExternalUrl } from "./lib/spot-advice-review.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, ".local", "spot-advice-review.html");

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function safeLink(url, label) {
  if (!isSafeExternalUrl(url)) return `<span class="unsafe-link">${escapeHtml(label)} (unsafe URL omitted)</span>`;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function buildSpotAdviceReviewModel({ document, context, baseDigest = digestDocument(document) }) {
  const surflineById = new Map((context.surflineSpots?.spots ?? []).map((spot) => [spot.id, spot]));
  const promotedById = new Map((context.promotedDb?.promoted ?? []).map((spot) => [spot.id, spot]));
  const deferredById = new Map((context.promotedDb?.deferred ?? []).map((spot) => [spot.surflineSpotId, spot]));
  const spotCatalog = context.promotions.promoted.map((promotion) => {
    const id = promotion.surflineSpotId;
    const catalog = surflineById.get(id) ?? { id, name: id };
    const cameraCoverage = promotedById.get(id)?.camCoverage ?? (deferredById.has(id) ? "deferred" : "none");
    return { id, name: catalog.name, lat: catalog.lat, lon: catalog.lon, cameraCoverage };
  });
  const previewContext = { stretches: context.stretches };
  const spots = buildDynamicReviewSpots(document, spotCatalog, previewContext);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseDigest,
    document,
    spots,
    spotCatalog,
    areas: document.areas.map(({ id, name }) => ({ id, name })),
    stretches: (context.stretches?.stretches ?? []).map(({ id, name }) => ({ id, name })),
    previewContext,
    validationContext: context,
    defaultFavoriteIds: context.defaultFavoriteIds ?? DEFAULT_FAVORITE_IDS
  };
}

function renderSpotRow(spot) {
  const area = spot.areaIds.join(", ") || "unassigned";
  const scope = spot.applicableScopeTypes.join(" ");
  return `<button class="spot-row" type="button" aria-current="false" data-spot-id="${escapeHtml(spot.id)}" data-area="${escapeHtml(spot.areaIds.join(" "))}" data-scope="${escapeHtml(scope)}" data-topic="${escapeHtml(spot.topics.join(" "))}" data-confidence="${escapeHtml(spot.confidences.join(" "))}" data-publication="${escapeHtml(spot.publications.join(" "))}" data-consensus="${escapeHtml(spot.consensuses.join(" "))}" data-expiry="${escapeHtml(spot.expiries.join(" "))}" data-missing-direct="${spot.missingDirectEvidence ? "true" : "false"}">
    <span><strong>${escapeHtml(spot.name)}</strong><small>${escapeHtml(spot.id)}</small></span>
    <span class="badges"><em>${escapeHtml(area)}</em><em>research ${escapeHtml(spot.research?.status ?? "missing")}</em><em>direct ${escapeHtml(spot.research?.directEvidenceOutcome ?? "missing")}</em><em>camera ${escapeHtml(spot.cameraCoverage)}</em><em>advice ${escapeHtml(spot.adviceCoverage.status)} (${spot.adviceCoverage.effectiveCount})</em><em>applicability ${escapeHtml(spot.applicabilitySignoff.label)}</em>${spot.conflictCount ? `<em>${spot.conflictCount} conflicts</em>` : ""}</span>
  </button>`;
}

function renderInitialSources(model) {
  const research = model.spots[0]?.research;
  if (!research) return "<p>No research row.</p>";
  return research.checkedSources.map((source) => `<article class="source-card"><strong>${safeLink(source.url, source.title)}</strong><span>${escapeHtml(source.publisher)} · ${escapeHtml(source.locationMatch)} · ${escapeHtml(source.decision)}</span><p>${escapeHtml(source.rationale)}</p></article>`).join("");
}

export function renderSpotAdviceReviewHtml(model) {
  const rows = model.spots.map(renderSpotRow).join("\n");
  const initialSources = renderInitialSources(model);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local spot advice review cockpit</title>
<style>
:root{color-scheme:light dark;--bg:#eef3f0;--panel:#fff;--ink:#16211b;--muted:#627069;--line:#c9d5ce;--accent:#166b50;--warn:#a85e08;--danger:#a33131}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,sans-serif}header{position:sticky;top:0;z-index:4;display:flex;gap:16px;align-items:center;padding:12px 18px;background:#123b2f;color:#fff}header h1{font-size:18px;margin:0}header span{margin-left:auto}.layout{display:grid;grid-template-columns:310px minmax(440px,1fr) 330px;gap:12px;padding:12px;min-height:calc(100vh - 54px)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:auto}.filters{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;border-bottom:1px solid var(--line)}label{display:grid;gap:3px;color:var(--muted);font-size:12px}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:7px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)}textarea{min-height:72px;resize:vertical}.spot-list{display:grid}.spot-row{display:flex;justify-content:space-between;text-align:left;gap:8px;border:0;border-bottom:1px solid var(--line);padding:10px;background:none;color:inherit;cursor:pointer}.spot-row:hover,.spot-row.active{background:#dcece5}.spot-row span{display:grid}.spot-row small{color:var(--muted)}.badges{justify-items:end}.badges em{font-size:11px;font-style:normal;color:var(--muted)}.workspace{padding:14px}.workspace h2,.workspace h3{margin:4px 0 10px}.summary-grid,.editor-grid,.lens-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.summary-card{padding:9px;border:1px solid var(--line);border-radius:7px}.toolbar{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.toolbar button,.file-button{padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);cursor:pointer}.toolbar .danger{color:var(--danger)}.claims{display:grid;gap:8px;margin:10px 0}.claim-card{border:1px solid var(--line);border-radius:8px;padding:9px;cursor:pointer}.claim-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.claim-card small{display:block;color:var(--muted)}.editor-grid .wide{grid-column:1/-1}.side{padding:12px}.source-card{border-bottom:1px solid var(--line);padding:9px 0}.source-card span{display:block;color:var(--muted);font-size:12px}.source-card p{margin:5px 0}.unsafe-link{color:var(--danger)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:8px;border-radius:6px}.status-good{color:#c6f6df}.status-warn{color:#ffd89a}@media(max-width:1050px){.layout{grid-template-columns:270px 1fr}.side{grid-column:1/-1}}@media(max-width:700px){.layout{display:block}.panel{margin-bottom:10px}.summary-grid,.editor-grid,.lens-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Local spot advice review cockpit</h1><span id="pending-count" role="status" aria-live="polite">0 pending</span><span id="autosave-status" role="status" aria-live="polite" class="status-good">Autosave ready</span></header>
<main class="layout">
<aside class="panel">
  <section class="filters" aria-label="Review filters">
    <label>Area<select id="filter-area"><option value="">All areas</option>${model.areas.map((area) => `<option value="${escapeHtml(area.id)}">${escapeHtml(area.name)}</option>`).join("")}</select></label>
    <label>Scope<select id="filter-scope"><option value="">All scopes</option><option value="spot">spot</option><option value="stretch">stretch</option><option value="area">area</option></select></label>
    <label>Topic<input id="filter-topic" placeholder="wind, tide…"></label>
    <label>Confidence<select id="filter-confidence"><option value="">All</option><option>high</option><option>medium</option><option>low</option></select></label>
    <label>Publication<select id="filter-publication"><option value="">All</option><option>published</option><option>draft</option><option>rejected</option></select></label>
    <label>Consensus<select id="filter-consensus"><option value="">All</option><option>settled</option><option>unresolved</option></select></label>
    <label>Expiry<select id="filter-expiry"><option value="">Any</option><option value="set">Has expiry</option><option value="missing">No expiry</option></select></label>
    <label><input id="filter-missing-direct" type="checkbox"> Missing direct evidence</label>
  </section>
  <nav id="spot-list" class="spot-list" aria-label="Spot review list">${rows}</nav>
</aside>
<section class="panel workspace">
  <h2 id="spot-heading">Select a spot</h2>
  <div class="summary-grid">
    <div class="summary-card"><strong>Research outcome</strong><div id="research-outcome"></div></div>
    <div class="summary-card"><strong>Direct evidence</strong><div id="direct-outcome"></div></div>
    <div class="summary-card"><strong>Coverage</strong><div id="coverage"></div></div>
    <div class="summary-card"><strong>Conflicts</strong><div id="conflicts"></div></div>
  </div>
  <div class="toolbar"><button id="add-claim">Add claim</button><button id="split-claim">Split claim</button><button id="merge-claim">Merge claim</button><button id="rescope-claim">Re-scope</button><button id="delete-claim" class="danger">Delete claim</button></div>
  <div id="claims" class="claims"></div>
  <section id="claim-editor">
    <h3>Claim editor</h3>
    <div class="editor-grid">
      <label>ID<input id="claim-id" readonly></label><label>Topic<input id="claim-topic"></label>
      <label>Scope type<select id="claim-scope-type"><option>spot</option><option>stretch</option><option>area</option></select></label><label>Scope id<input id="claim-scope-id"></label>
      <label>Override key<input id="claim-override-key"></label><label>Confidence<select id="claim-confidence"><option>high</option><option>medium</option><option>low</option></select></label>
      <label class="wide">Summary<textarea id="claim-summary"></textarea></label><label class="wide">Rule JSON<textarea id="claim-rule"></textarea></label>
      <label>Publication<select id="claim-publication"><option>published</option><option>draft</option><option>rejected</option></select></label><label>Reviewed at<input id="claim-reviewed" placeholder="ISO timestamp"></label>
      <label>Expiry<input id="claim-expiry" type="date"></label><label>Consensus<select id="claim-consensus"><option>settled</option><option>unresolved</option></select></label>
      <label>Conflict group<input id="claim-conflict-group"></label><label>Conflict position<input id="claim-position"></label>
    </div>
    <div class="toolbar"><button id="save-claim">Save claim</button><button id="signoff-claim">Review / Sign off</button></div>
  </section>
  <section id="evidence-editor"><h3>Evidence editor</h3><div id="evidence-list"></div><div class="toolbar"><button id="add-evidence">Add evidence</button></div></section>
  <section><h3>Research row edits</h3><textarea id="research-json"></textarea><div class="toolbar"><button id="save-research">Save research row</button></div></section>
  <section id="inheritance-preview"><h3>Inheritance preview</h3><div id="inheritance"></div></section>
  <section id="local-lens"><h3>Local lens fixture preview</h3><div class="lens-grid"><label>Swell height m<input id="lens-height" type="number" value="1.5" step="0.1"></label><label>Tide stage<select id="lens-tide"><option>low</option><option selected>mid</option><option>high</option></select></label><label>Swell direction °<input id="lens-swell" type="number" value="290"></label><label>Wind direction °<input id="lens-wind" type="number" value="45"></label></div><div class="toolbar"><button id="run-lens">Run Local lens</button></div><pre id="lens-output"></pre></section>
  <div class="toolbar"><label class="file-button">Import feedback<input id="import-feedback" type="file" accept="application/json" hidden></label><button id="export-feedback">Export feedback</button><button id="reset-review" class="danger">Reset</button></div>
</section>
<aside class="panel side" id="source-pane"><h2>Source pane</h2><div id="sources">${initialSources}</div></aside>
</main>
<script id="review-data" type="application/json">${scriptJson(model)}</script>
<script type="module">
import { MAX_REVIEW_PAYLOAD_BYTES, addClaim, addEvidence, applyClaimEditorPatch, buildDynamicReviewSpots, clearEditorDraft, createReviewRuntime, deleteClaim, deleteEvidence, filterReviewSpots, isSafeExternalUrl, mergeClaims, rescopeClaim, resolveSpotAdvicePreview, signOffClaim, splitClaim, updateEvidence, updateResearchRow } from "../scripts/lib/spot-advice-review.js";

const bootstrap = JSON.parse(document.getElementById("review-data").textContent);
const runtime = createReviewRuntime({ canonicalDocument: bootstrap.document, baseDigest: bootstrap.baseDigest, storage: localStorage, validationContext: bootstrap.validationContext });
let working = runtime.state().document;
let reviewSpots = buildDynamicReviewSpots(working, bootstrap.spotCatalog, bootstrap.previewContext);
let selectedSpotId = bootstrap.spots[0]?.id || null;
let selectedClaimId = null;
let saveTimer = null;
const byId = (id) => document.getElementById(id);
const spotMeta = () => reviewSpots.find((spot) => spot.id === selectedSpotId);
const research = () => working.spotResearch.find((row) => row.spotId === selectedSpotId);
const claim = () => working.advice.find((item) => item.id === selectedClaimId);
const applicable = (item, spot) => item.scope.type === "spot" ? item.scope.id === spot.id : item.scope.type === "area" ? spot.areaIds.includes(item.scope.id) : spot.stretchIds.includes(item.scope.id);
function syncWorking() { working = runtime.state().document; }
function setText(id, value) { byId(id).textContent = value ?? ""; }
function updateStatus() {
  setText("pending-count", runtime.pendingCount() + " pending");
  setText("autosave-status", runtime.autosaveStatus());
  byId("autosave-status").className = runtime.beforeUnloadShouldWarn() ? "status-warn" : "status-good";
}
function queueAutosave() {
  updateStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { runtime.saveNow(); syncWorking(); updateStatus(); }, 120);
}
function commit(next, { rerender = true } = {}) {
  runtime.replaceState(next); syncWorking(); queueAutosave(); if (rerender) render();
}
function typeDraft(key, value) { runtime.typeDraft(key, value); syncWorking(); queueAutosave(); }
window.addEventListener("beforeunload", (event) => { if (runtime.beforeUnloadShouldWarn()) { event.preventDefault(); event.returnValue = ""; } });
function renderLink(container, source) {
  const card = document.createElement("article"); card.className = "source-card";
  const heading = document.createElement("strong");
  if (isSafeExternalUrl(source.url)) { const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = source.title; heading.append(link); }
  else { heading.textContent = source.title + " (unsafe URL omitted)"; }
  const meta = document.createElement("span"); meta.textContent = [source.publisher,source.locationMatch,source.decision || source.status].filter(Boolean).join(" · ");
  const note = document.createElement("p"); note.textContent = source.rationale || source.supportedClaim || "";
  card.append(heading,meta,note); container.append(card);
}
function refreshSpotRows() {
  reviewSpots = buildDynamicReviewSpots(working, bootstrap.spotCatalog, bootstrap.previewContext);
  for (const spot of reviewSpots) {
    const row = [...document.querySelectorAll(".spot-row")].find((node) => node.dataset.spotId === spot.id);
    if (!row) continue;
    row.dataset.area = spot.areaIds.join(" "); row.dataset.scope = spot.applicableScopeTypes.join(" "); row.dataset.topic = spot.topics.join(" "); row.dataset.confidence = spot.confidences.join(" "); row.dataset.publication = spot.publications.join(" "); row.dataset.consensus = spot.consensuses.join(" "); row.dataset.expiry = spot.expiries.join(" "); row.dataset.missingDirect = String(spot.missingDirectEvidence);
    const badges = row.querySelector(".badges"); badges.replaceChildren();
    const values = [spot.areaIds.join(", ")||"unassigned","research "+(spot.research?.status||"missing"),"direct "+(spot.research?.directEvidenceOutcome||"missing"),"camera "+spot.cameraCoverage,"advice "+spot.adviceCoverage.status+" ("+spot.adviceCoverage.effectiveCount+")","applicability "+spot.applicabilitySignoff.label,...(spot.conflictCount?[spot.conflictCount+" conflicts"]:[])];
    for (const value of values) { const badge=document.createElement("em"); badge.textContent=value; badges.append(badge); }
  }
}
function renderFilters() {
  const filters = { area: byId("filter-area").value, scope: byId("filter-scope").value, topic: byId("filter-topic").value, confidence: byId("filter-confidence").value, publication: byId("filter-publication").value, consensus: byId("filter-consensus").value, expiry: byId("filter-expiry").value, missingDirect: byId("filter-missing-direct").checked };
  const visible = new Set(filterReviewSpots(reviewSpots, filters).map((spot) => spot.id));
  document.querySelectorAll(".spot-row").forEach((row) => { row.hidden = !visible.has(row.dataset.spotId); });
}
function readClaimForm() {
  const patch={topic:byId("claim-topic").value,scope:{type:byId("claim-scope-type").value,id:byId("claim-scope-id").value},overrideKey:byId("claim-override-key").value,summary:byId("claim-summary").value,rule:JSON.parse(byId("claim-rule").value),confidence:byId("claim-confidence").value,publicationStatus:byId("claim-publication").value,reviewedAt:byId("claim-reviewed").value||null,revalidateAfter:byId("claim-expiry").value||null,consensus:byId("claim-consensus").value};
  const group=byId("claim-conflict-group").value.trim(),position=byId("claim-position").value.trim(); if(group){patch.conflictGroupId=group;patch.position=position;} else {patch.conflictGroupId=undefined;patch.position=undefined;} return patch;
}
function renderClaimEditor() {
  const item = claim(); const fields = ["claim-id","claim-topic","claim-scope-id","claim-override-key","claim-summary","claim-rule","claim-reviewed","claim-expiry","claim-conflict-group","claim-position"];
  if (!item) { fields.forEach((id) => { byId(id).value = ""; }); byId("evidence-list").replaceChildren(); return; }
  const draft = runtime.state().editorDrafts["claim:"+item.id] || {};
  const value = {...item,...draft,scope:draft.scope||item.scope};
  byId("claim-id").value=item.id; byId("claim-topic").value=value.topic; byId("claim-scope-type").value=value.scope.type; byId("claim-scope-id").value=value.scope.id; byId("claim-override-key").value=value.overrideKey; byId("claim-summary").value=value.summary; byId("claim-rule").value=typeof value.rule==="string"?value.rule:JSON.stringify(value.rule,null,2); byId("claim-confidence").value=value.confidence; byId("claim-publication").value=value.publicationStatus; byId("claim-reviewed").value=value.reviewedAt||""; byId("claim-expiry").value=value.revalidateAfter||""; byId("claim-consensus").value=value.consensus; byId("claim-conflict-group").value=value.conflictGroupId||""; byId("claim-position").value=value.position||"";
  const evidenceList=byId("evidence-list"); evidenceList.replaceChildren();
  item.evidence.forEach((evidence,index)=>{const key="evidence:"+item.id+":"+index;const wrap=document.createElement("div");wrap.className="claim-card";const area=document.createElement("textarea");area.value=Object.hasOwn(runtime.state().editorDrafts,key)?runtime.state().editorDrafts[key]:JSON.stringify(evidence,null,2);area.addEventListener("input",()=>typeDraft(key,area.value));const save=document.createElement("button");save.textContent="Save evidence";save.onclick=()=>{try{let next=clearEditorDraft(runtime.state(),key);next=updateEvidence(next,item.id,index,JSON.parse(area.value));commit(next);}catch(error){alert(error.message);}};const remove=document.createElement("button");remove.textContent="Delete evidence";remove.onclick=()=>{try{commit(deleteEvidence(runtime.state(),item.id,index));}catch(error){alert("Delete blocked: "+error.message);}};wrap.append(area,save,remove);evidenceList.append(wrap);});
}
function render() {
  refreshSpotRows(); renderFilters(); const spot=spotMeta();if(!spot)return;const row=research();const preview=resolveSpotAdvicePreview(working,bootstrap.previewContext,spot.id);const relevant=working.advice.filter((item)=>applicable(item,spot));
  document.querySelectorAll(".spot-row").forEach((node)=>{const active=node.dataset.spotId===spot.id;node.classList.toggle("active",active);node.setAttribute("aria-current",active?"true":"false");});setText("spot-heading",spot.name+" · "+spot.id);setText("research-outcome",row?.status||"missing");setText("direct-outcome",row?.directEvidenceOutcome||"missing");setText("coverage","camera "+spot.cameraCoverage+" · published advice "+preview.effectiveClaims.length);const conflicts=relevant.filter((item)=>item.consensus==="unresolved");setText("conflicts",conflicts.length?conflicts.map((item)=>item.id).join(", "):"none");
  if(!selectedClaimId||!relevant.some((item)=>item.id===selectedClaimId))selectedClaimId=relevant[0]?.id||null;const claims=byId("claims");claims.replaceChildren();relevant.forEach((item)=>{const card=document.createElement("button");card.type="button";card.className="claim-card"+(item.id===selectedClaimId?" selected":"");card.ariaPressed=String(item.id===selectedClaimId);card.onclick=()=>{selectedClaimId=item.id;render();};const title=document.createElement("strong");title.textContent=item.summary;const meta=document.createElement("small");meta.textContent=[item.id,item.scope.type+":"+item.scope.id,item.topic,item.confidence,item.publicationStatus,item.consensus].join(" · ");card.append(title,meta);claims.append(card);});
  const researchKey="research:"+spot.id;byId("research-json").value=Object.hasOwn(runtime.state().editorDrafts,researchKey)?runtime.state().editorDrafts[researchKey]:JSON.stringify(row,null,2);const effective=preview.effectiveClaims.map((item)=>"effective "+item.scope.type+":"+item.scope.id+" · "+item.id);const overridden=preview.overriddenClaims.map((item)=>"overridden "+item.scope.type+":"+item.scope.id+" · "+item.id);setText("inheritance",[...effective,...overridden].join("\\n")||"No signed-off effective advice.");
  const sources=byId("sources");sources.replaceChildren();(row?.checkedSources||[]).forEach((source)=>renderLink(sources,source));relevant.flatMap((item)=>item.evidence||[]).forEach((source)=>renderLink(sources,source));updateStatus();renderClaimEditor();
}
function applyClaimPatch(patch){let next=clearEditorDraft(runtime.state(),"claim:"+selectedClaimId);next=applyClaimEditorPatch(next,selectedClaimId,patch);commit(next);}
document.querySelectorAll(".spot-row").forEach((row)=>row.addEventListener("click",()=>{selectedSpotId=row.dataset.spotId;selectedClaimId=null;render();}));
["filter-area","filter-scope","filter-topic","filter-confidence","filter-publication","filter-consensus","filter-expiry","filter-missing-direct"].forEach((id)=>byId(id).addEventListener("input",renderFilters));
["claim-topic","claim-scope-type","claim-scope-id","claim-override-key","claim-summary","claim-rule","claim-confidence","claim-publication","claim-reviewed","claim-expiry","claim-consensus","claim-conflict-group","claim-position"].forEach((id)=>byId(id).addEventListener("input",()=>{if(selectedClaimId){try{typeDraft("claim:"+selectedClaimId,readClaimForm());}catch{typeDraft("claim:"+selectedClaimId,{rule:byId("claim-rule").value});}}}));
byId("research-json").addEventListener("input",()=>typeDraft("research:"+selectedSpotId,byId("research-json").value));
byId("save-claim").onclick=()=>{try{applyClaimPatch(readClaimForm());}catch(error){alert(error.message);}};
byId("signoff-claim").onclick=()=>{try{commit(signOffClaim(runtime.state(),selectedClaimId,new Date().toISOString()));}catch(error){alert("Sign off blocked: "+error.message);}};
byId("add-claim").onclick=()=>{const id=prompt("New claim id");if(!id)return;const today=new Date().toISOString().slice(0,10);const item={id,scope:{type:"spot",id:selectedSpotId},topic:"wind",overrideKey:"wind."+id,summary:"New local claim",rule:{type:"qualitative"},evidence:[{kind:"user-observed",title:"Local observation",publisher:"Local knowledge",url:null,accessedAt:today,supportedClaim:"New local claim",quality:"first-hand",status:"accepted"}],confidence:"low",publicationStatus:"draft",consensus:"settled",calculationCandidate:false,reviewedAt:null,revalidateAfter:null};try{selectedClaimId=id;commit(addClaim(runtime.state(),item,{directSpotId:selectedSpotId}));}catch(error){alert(error.message);}};
byId("delete-claim").onclick=()=>{if(!claim()||!confirm("Delete selected claim?"))return;try{commit(deleteClaim(runtime.state(),selectedClaimId));selectedClaimId=null;render();}catch(error){alert("Delete blocked: "+error.message);}};
byId("split-claim").onclick=()=>{if(!claim())return;const id=prompt("New claim id for split");if(!id)return;try{commit(splitClaim(runtime.state(),selectedClaimId,{newId:id,newClaimPatch:{summary:claim().summary+" (split)",overrideKey:claim().overrideKey+".split"}}));selectedClaimId=id;render();}catch(error){alert(error.message);}};
byId("merge-claim").onclick=()=>{if(!claim())return;const sourceId=prompt("Claim id to merge into selected claim");const source=working.advice.find((item)=>item.id===sourceId);if(!source)return;try{commit(mergeClaims(runtime.state(),selectedClaimId,sourceId,{summary:claim().summary+" "+source.summary}));}catch(error){alert(error.message);}};
byId("rescope-claim").onclick=()=>{if(!claim())return;const type=prompt("Scope type: spot, stretch, or area",claim().scope.type);const id=prompt("Scope id",claim().scope.id);if(!type||!id)return;try{commit(rescopeClaim(runtime.state(),selectedClaimId,{type,id}));}catch(error){alert(error.message);}};
byId("add-evidence").onclick=()=>{if(!claim())return;const today=new Date().toISOString().slice(0,10);commit(addEvidence(runtime.state(),selectedClaimId,{kind:"user-observed",title:"New evidence",publisher:"Local knowledge",url:null,accessedAt:today,supportedClaim:claim().summary,quality:"first-hand",status:"accepted"}));};
byId("save-research").onclick=()=>{try{const value=JSON.parse(byId("research-json").value);let next=clearEditorDraft(runtime.state(),"research:"+selectedSpotId);next=updateResearchRow(next,selectedSpotId,value);commit(next);}catch(error){alert(error.message);}};
byId("run-lens").onclick=()=>{const preview=resolveSpotAdvicePreview(working,bootstrap.previewContext,selectedSpotId);const height=Number(byId("lens-height").value),tide=byId("lens-tide").value,swell=Number(byId("lens-swell").value),wind=Number(byId("lens-wind").value);const results=preview.effectiveClaims.map((item)=>{const rule=item.rule||{};let outcome="qualitative";if(rule.type==="minimum")outcome=height>=rule.value?(rule.effectAtOrAbove||"at or above"):rule.effectBelow;if(rule.type==="tide-preference")outcome=tide===rule.stage?"preferred tide":"outside preferred tide";if(rule.type==="direction-preference"){const value=rule.input.startsWith("wind")?wind:swell;outcome=rule.arcs.some((arc)=>arc.start<=arc.end?value>=arc.start&&value<=arc.end:value>=arc.start||value<=arc.end)?"preferred direction":"outside preferred direction";}return item.id+": "+outcome;});setText("lens-output",results.join("\\n")||"No published effective claims.");};
byId("export-feedback").onclick=()=>{try{const payload=JSON.stringify(runtime.feedback(),null,2)+"\\n";const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([payload],{type:"application/json"}));link.download="spot-advice-feedback.json";link.click();URL.revokeObjectURL(link.href);}catch(error){alert("Export blocked: "+error.message);}};
byId("import-feedback").onchange=async(event)=>{try{const file=event.target.files[0];if(!file)return;if(file.size>MAX_REVIEW_PAYLOAD_BYTES)throw new Error("feedback payload is too large; maximum size is "+MAX_REVIEW_PAYLOAD_BYTES+" bytes");runtime.importPayload(await file.text());syncWorking();queueAutosave();selectedClaimId=null;render();}catch(error){alert("Import blocked: "+error.message);}};
byId("reset-review").onclick=()=>{if(!confirm("Reset all local review edits?"))return;clearTimeout(saveTimer);runtime.reset();syncWorking();selectedClaimId=null;render();};
byId("autosave-status").textContent=runtime.autosaveStatus();renderFilters();render();
</script>
</body>
</html>\n`;
}

const readJson = (filePath, fileSystem = fs) => JSON.parse(fileSystem.readFileSync(filePath, "utf8"));

export function buildSpotAdviceReviewFiles({ root = ROOT, outputPath = root === ROOT ? DEFAULT_OUTPUT_PATH : path.join(root, ".local", "spot-advice-review.html"), fileSystem = fs } = {}) {
  const dataPath = (name) => path.join(root, "data", name);
  const document = readJson(dataPath("spot-advice.json"), fileSystem);
  const context = {
    promotions: readJson(dataPath("surfline-promotions.json"), fileSystem),
    surflineSpots: readJson(dataPath("surfline-spots.json"), fileSystem),
    stretches: readJson(dataPath("stretches.json"), fileSystem),
    promotedDb: readJson(dataPath("promoted-spots.json"), fileSystem),
    enrichmentDb: readJson(dataPath("spot-metadata-enrichment.json"), fileSystem),
    defaultFavoriteIds: DEFAULT_FAVORITE_IDS
  };
  const model = buildSpotAdviceReviewModel({ document, context });
  const html = renderSpotAdviceReviewHtml(model);
  fileSystem.mkdirSync(path.dirname(outputPath), { recursive: true });
  fileSystem.writeFileSync(outputPath, html, "utf8");
  return { outputPath, bytes: Buffer.byteLength(html), spots: model.spots.length };
}

function main() {
  const result = buildSpotAdviceReviewFiles();
  console.log(`Wrote ${path.relative(ROOT, result.outputPath)} (${result.spots} spots, ${result.bytes} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
