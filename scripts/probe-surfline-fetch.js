// scripts/probe-surfline-fetch.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNextDataState } from "./lib/surfline-extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const surflineDb = JSON.parse(await fs.readFile(path.join(ROOT, "data/surfline-spots.json"), "utf8"));
const SAMPLE_IDS = ["surfline-carcavelos", "surfline-supertubos", "surfline-sesimbra"];
const samples = SAMPLE_IDS.map((id) => surflineDb.spots.find((s) => s.id === id)).filter(Boolean);
const UA = "surfcams-portugal-refresh/1.0 (personal, low-volume; github.com/kuangc/surfcams-portugal)";
const results = [];

for (const spot of samples) {
  try {
    const res = await fetch(spot.url, { headers: { "user-agent": UA }, redirect: "follow" });
    const body = res.ok ? await res.text() : "";
    results.push({ kind: "page", id: spot.id, status: res.status, valid: !!parseNextDataState(body) });
  } catch (error) {
    results.push({ kind: "page", id: spot.id, status: "ERR", valid: false, error: error.message });
  }
  try {
    const url = `https://services.surfline.com/kbyg/spots/forecasts/conditions?spotId=${spot.remoteSpotId}&days=2`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    let valid = false;
    if (res.ok) {
      const json = await res.json();
      valid = Array.isArray(json?.data?.conditions);
    }
    results.push({ kind: "kbyg", id: spot.id, status: res.status, valid });
  } catch (error) {
    results.push({ kind: "kbyg", id: spot.id, status: "ERR", valid: false, error: error.message });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000));
}

const lines = ["| kind | spot | status | payload valid |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.kind} | ${r.id} | ${r.status} | ${r.valid} |`)];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  } catch {
    // best-effort summary write; the probe must always exit 0
  }
}
const pageOk = results.filter((r) => r.kind === "page" && r.valid).length;
const kbygOk = results.filter((r) => r.kind === "kbyg" && r.valid).length;
console.log(`\nverdict: pages ${pageOk}/${samples.length}, kbyg ${kbygOk}/${samples.length}`);
// exit 0 always: the probe reports, it does not fail the workflow
