import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function applyFeedback(db, feedback) {
  const matches = db.matches.map((m) => ({ ...m }));
  const byId = new Map(matches.map((m) => [m.meoSpotId, m]));
  for (const item of feedback) {
    const row = byId.get(item.meoSpotId);
    if (!row) throw new Error(`feedback references unknown meoSpotId ${item.meoSpotId}`);
    if (item.decision === "accept") {
      if (!row.surflineSpotIds.includes(item.selectedSurflineSpotId)) {
        throw new Error(`selected ${item.selectedSurflineSpotId} not in candidates for ${item.meoSpotId}`);
      }
      row.source = "curated";
      row.confidence = "curated";
      row.reviewStatus = "curated";
      row.surflineSpotIds = [item.selectedSurflineSpotId,
        ...row.surflineSpotIds.filter((id) => id !== item.selectedSurflineSpotId)];
      if (item.notes) row.notes = item.notes;
    } else if (item.decision === "reject") {
      row.reviewStatus = "rejected";
    }
  }
  return { ...db, matches };
}

async function main() {
  const feedbackPath = process.argv[2];
  if (!feedbackPath) {
    console.error("usage: node scripts/apply-mapping-feedback.js <feedback.json>");
    process.exitCode = 1;
    return;
  }
  const db = JSON.parse(await fs.readFile("data/meo-surfline-matches.json", "utf8"));
  const feedback = JSON.parse(await fs.readFile(feedbackPath, "utf8"));
  const out = applyFeedback(db, feedback);
  await fs.writeFile("data/meo-surfline-matches.json", JSON.stringify(out, null, 1) + "\n");
  console.log(`Applied ${feedback.length} feedback decisions`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
