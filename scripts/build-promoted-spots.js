#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateAssociation } from "./lib/spot-matching.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SURFLINE_DB_PATH = path.join(ROOT, "data", "surfline-spots.json");
const MEO_DB_PATH = path.join(ROOT, "data", "meo-spots.json");
const MATCHES_DB_PATH = path.join(ROOT, "data", "meo-surfline-matches.json");
const STRETCHES_PATH = path.join(ROOT, "data", "stretches.json");
const PROMOTIONS_PATH = path.join(ROOT, "data", "surfline-promotions.json");
const OUTPUT_PATH = path.join(ROOT, "data", "promoted-spots.json");

export function buildPromotedSpots({ surflineDb, meoDb, matchesDb, stretches, promotions }) {
  const slById = new Map(surflineDb.spots.map((s) => [s.id, s]));
  const meoById = new Map(meoDb.spots.map((s) => [s.id, s]));
  const stretchBySpot = new Map();
  for (const st of stretches.stretches) for (const id of st.surflineSpotIds) stretchBySpot.set(id, st);

  function trustedCamFor(surflineId) {
    let best = null;
    for (const row of matchesDb.matches) {
      if (row.reviewStatus === "rejected") continue;
      const cam = meoById.get(row.meoSpotId);
      if (!cam?.hasStream) continue;
      const distanceKm = row.distancesKm?.[surflineId];
      if (!Number.isFinite(distanceKm)) continue;
      const ev = (row.matchEvidence || []).find((e) => e.surflineSpotId === surflineId);
      const { trusted } = evaluateAssociation({
        nameScore: ev?.nameScore ?? 0, distanceKm,
        curated: row.reviewStatus === "curated",
        camLat: cam.lat, camLon: cam.lon,
        surflineName: surflineId.replace(/^surfline-/, ""), meoName: `${cam.id} ${cam.name}`
      });
      if (trusted && (!best || distanceKm < best.distanceKm)) best = { camId: cam.id, distanceKm };
    }
    return best;
  }

  const promoted = [];
  const deferred = [];
  for (const want of promotions.promoted) {
    const spot = slById.get(want.surflineSpotId);
    if (!spot) throw new Error(`promotion manifest references unknown spot ${want.surflineSpotId}`);
    const surflineCams = spot.staticMetadata?.surflineCams || [];
    const trustedCam = trustedCamFor(spot.id);
    const stretch = stretchBySpot.get(spot.id) || null;
    let camCoverage = "none";
    if (trustedCam || surflineCams.length > 0) camCoverage = "spot";
    else if (stretch) camCoverage = "stretch";
    if (camCoverage === "none" && promotions.promoteOnlyWithTrustedCam) {
      deferred.push({ surflineSpotId: spot.id, reason: "no trusted cam, no surfline cam, not on a stretch" });
      continue;
    }
    const nearestRegion = meoDb.spots
      .filter((m) => Number.isFinite(m.lat))
      .map((m) => ({ m, d2: (m.lat - spot.lat) ** 2 + (m.lon - spot.lon) ** 2 }))
      .sort((a, b) => a.d2 - b.d2)[0]?.m.region ?? null;
    promoted.push({
      id: spot.id,
      provider: "surfline-promoted",
      promoted: true,
      name: spot.name,
      lat: spot.lat,
      lon: spot.lon,
      region: trustedCam ? meoById.get(trustedCam.camId).region : nearestRegion,
      hasStream: false,
      camCoverage,
      linkedCamId: trustedCam?.camId ?? null,
      linkedCamDistanceKm: trustedCam?.distanceKm ?? null,
      stretchId: stretch?.id ?? null,
      stretchCamIds: stretch?.meoCamIds ?? [],
      surfline: { spotId: spot.remoteSpotId, pageUrl: spot.url },
      surflineCams,
      surfMetadata: {
        breakType: spot.staticMetadata?.breakType ?? null,
        best: spot.staticMetadata?.travelDetails?.best ?? null,
        guideSummary: spot.staticMetadata?.guideSummary ?? null,
        coastExposure: spot.staticMetadata?.coastExposure ?? null,
        sourceSpotId: spot.id
      },
      note: want.note ?? null
    });
  }
  return { promoted, deferred };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const [surflineDb, meoDb, matchesDb, stretches, promotions] = await Promise.all(
    [SURFLINE_DB_PATH, MEO_DB_PATH, MATCHES_DB_PATH, STRETCHES_PATH, PROMOTIONS_PATH].map(readJson)
  );
  const { promoted, deferred } = buildPromotedSpots({ surflineDb, meoDb, matchesDb, stretches, promotions });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    total: promoted.length, deferred, promoted
  }, null, 1)}\n`, "utf8");
  console.log(`Promoted ${promoted.length}, deferred ${deferred.length}:`);
  for (const d of deferred) console.log(`  deferred: ${d.surflineSpotId} (${d.reason})`);
  for (const p of promoted) console.log(`  ${p.camCoverage.padEnd(7)} ${p.id} cam:${p.linkedCamId ?? "-"} slCams:${p.surflineCams.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
