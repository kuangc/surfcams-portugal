import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { validateMeoCrawl } = require("../scripts/validate-meo-crawl.cjs");
const accepted = JSON.parse(fs.readFileSync("data/beachcam-cameras.json", "utf8"));

const ACTIVATED_CAMERA_IDS = new Set([
  "meia-praia",
  "vagueira",
  "pedra-do-ouro",
  "vagueira-areao",
  "nazare-forte-sao-miguel-arcanjo-panoramica",
  "ski-clube-quinta-grande",
  "nazare-forte-sao-miguel-arcanjo-panoramica-1"
]);
const LEGACY_ISLAND_CAMERA_IDS = new Set([
  "porto-santo",
  "faja-da-areia",
  "seixal",
  "madeira-paul-do-mar",
  "ponta-pequena",
  "madeira-jardim-do-mar",
  "madeira-maiata"
]);

const normalizeText = (value) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .split("|")
  .map((segment) => segment.trim())
  .filter(Boolean)
  .join(" | ");

function catalogWith(cameras, source = accepted.source) {
  return {
    ...accepted,
    total: cameras.length,
    withCoordinates: cameras.filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon)).length,
    withStreams: cameras.filter((camera) => camera.hasStream).length,
    regions: [...new Set(cameras.map((camera) => camera.region).filter(Boolean))].sort(),
    source: { ...source, detailPageCount: cameras.length },
    cameras
  };
}

function validCandidate() {
  return structuredClone(accepted);
}

function legacyBaseline() {
  const cameras = accepted.cameras
    .filter((camera) => camera.id !== "acores-ribeira-grande-praia-do-monte-verde")
    .map((camera) => {
      const legacy = structuredClone(camera);
      if (camera.id === "espinho-silvalde") {
        legacy.id = "espinho-silvade";
        legacy.name = legacy.name.replace(/Silvalde/g, "Silvade");
        legacy.pageUrl = legacy.pageUrl.replace(/silvalde/g, "silvade");
        legacy.videoId = legacy.videoId.replace(/silvalde/g, "silvade");
      } else if (camera.id === "espinhosilvaldeestatica") {
        legacy.id = "espinhosilvadeestatica";
        legacy.name = legacy.name.replace(/Silvalde/g, "Silvade");
        legacy.pageUrl = legacy.pageUrl.replace(/silvalde/g, "silvade");
        legacy.videoId = legacy.videoId.replace(/silvalde/g, "silvade");
      }
      if (ACTIVATED_CAMERA_IDS.has(camera.id)) {
        legacy.hasStream = false;
        legacy.streamUrl = "";
        legacy.videoId = "";
      }
      if (camera.id === "porto-carneiro") {
        legacy.hasStream = true;
        legacy.streamUrl = "https://video-auth1.iol.pt/beachcam/bccarneiro/playlist.m3u8";
        legacy.videoId = "130294768/beachcam/web/porto-carneiro/live/VIDEO";
      }
      if (LEGACY_ISLAND_CAMERA_IDS.has(camera.id)) legacy.region = "ilhas";
      if (["fonte-da-telha", "fonte-da-telha-sul"].includes(camera.id)) legacy.isMulti = false;
      return legacy;
    });
  cameras.push({
    id: "surfline-castelo",
    provider: "surfline",
    firstClass: true,
    name: "Costa da Caparica | Costelo (Irmao)",
    location: "ALMADA",
    region: "almada",
    pageUrl: "https://www.surfline.com/surf-report/castelo/584204204e65fad6a77099d8",
    lat: 38.6131034,
    lon: -9.2161894,
    clicks: 0,
    isMulti: false,
    forecast: {},
    livecamId: "",
    streamUrl: "",
    videoId: "",
    hasStream: false,
    image: "",
    description: "Legacy Surfline intelligence row",
    detailMetrics: {}
  });
  cameras.sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name));
  return catalogWith(cameras);
}

const baseline = legacyBaseline();

test("validator accepts the exact provider-native MEO crawl delta and returns an audit summary", () => {
  const result = validateMeoCrawl({ baseline, candidate: validCandidate() });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, 190);
  assert.equal(result.playable, 154);
  assert.equal(result.baselinePlayable, 147);
  assert.equal(result.multicam, 73);
  assert.deepEqual(result.removedIds, [
    "espinho-silvade",
    "espinhosilvadeestatica",
    "surfline-castelo"
  ]);
  assert.deepEqual(result.addedIds, [
    "acores-ribeira-grande-praia-do-monte-verde",
    "espinho-silvalde",
    "espinhosilvaldeestatica"
  ]);
});

test("validator accepts an unchanged refresh after the MEO migration has landed", () => {
  const result = validateMeoCrawl({ baseline: accepted, candidate: validCandidate() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removedIds, []);
  assert.deepEqual(result.addedIds, []);
});

test("validator rejects fetch errors, unnormalized identity, invalid coordinates, and Surfline camera rows", () => {
  const candidate = validCandidate();
  candidate.cameras[0] = {
    ...candidate.cameras[0],
    name: ` ${candidate.cameras[0].name}  `,
    lat: Number.NaN,
    error: "detail fetch failed",
    provider: "surfline"
  };

  const result = validateMeoCrawl({ baseline, candidate });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /detail fetch failed/);
  assert.match(result.errors.join("\n"), /normalized nonempty name/);
  assert.match(result.errors.join("\n"), /finite coordinates/);
  assert.match(result.errors.join("\n"), /Surfline provider identity/);
});

test("validator rejects duplicate identities and malformed or repeated playable feeds", () => {
  const candidate = validCandidate();
  const first = candidate.cameras.find((camera) => camera.hasStream);
  const second = candidate.cameras.find((camera) => camera.hasStream && camera.id !== first.id);
  second.id = first.id;
  second.livecamId = first.livecamId;
  second.streamUrl = "https://user:secret@video-auth1.iol.pt:444/path/not-a-playlist.txt?token=secret";

  const result = validateMeoCrawl({ baseline, candidate });
  const errors = result.errors.join("\n");
  assert.match(errors, /duplicate camera id/);
  assert.match(errors, /duplicate playable livecamId/);
  assert.match(errors, /credential-free HTTPS URL/);
  assert.match(errors, /default port/);
  assert.match(errors, /provider MEO HLS path/);
});

test("validator rejects unexpected delta, stable identity drift, and renamed feed drift", () => {
  const candidate = validCandidate();
  const stable = candidate.cameras.find((camera) => camera.id === "praia-de-espinho");
  stable.name = "A different beach";
  stable.location = "SOMEWHERE ELSE";
  stable.lat += 0.01;
  stable.region = "unexpected-region";
  const renamed = candidate.cameras.find((camera) => camera.id === "espinho-silvalde");
  renamed.videoId = "changed-provider-video";
  candidate.cameras.find((camera) => camera.id === "tamariz").id = "unexpected-new-id";

  const result = validateMeoCrawl({ baseline, candidate });
  const errors = result.errors.join("\n");
  assert.match(errors, /camera ID delta/);
  assert.match(errors, /stable camera praia-de-espinho changed name/);
  assert.match(errors, /stable camera praia-de-espinho changed location/);
  assert.match(errors, /stable camera praia-de-espinho changed coordinates/);
  assert.match(errors, /stable camera praia-de-espinho changed region/);
  assert.match(errors, /renamed camera espinho-silvalde changed videoId/);
});

test("validator binds every stable camera name to its physical provider feed", () => {
  const candidate = validCandidate();
  const first = candidate.cameras.find((camera) => camera.id === "praia-de-carcavelos");
  const second = candidate.cameras.find((camera) => camera.id === "costa-da-caparica-cds");
  const firstFeed = {
    livecamId: first.livecamId,
    streamUrl: first.streamUrl,
    videoId: first.videoId
  };
  for (const field of Object.keys(firstFeed)) first[field] = second[field];
  for (const field of Object.keys(firstFeed)) second[field] = firstFeed[field];

  const result = validateMeoCrawl({ baseline, candidate });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /stable camera .* changed (?:livecamId|streamUrl|videoId)/);
});

test("validator attests the renamed Espinho identities and new Monte Verde camera", () => {
  const candidate = validCandidate();
  const renamed = candidate.cameras.find((camera) => camera.id === "espinho-silvalde");
  renamed.name = "A different camera";
  renamed.lat += 0.01;
  const monteVerde = candidate.cameras.find((camera) => camera.id === "acores-ribeira-grande-praia-do-monte-verde");
  monteVerde.name = "Another beach";
  monteVerde.location = "SOMEWHERE ELSE";
  monteVerde.livecamId = "99999";
  monteVerde.streamUrl = "https://video-auth1.iol.pt/auth-beachcam/not-monte-verde/playlist.m3u8";

  const result = validateMeoCrawl({ baseline, candidate });
  const errors = result.errors.join("\n");
  assert.equal(result.ok, false);
  assert.match(errors, /renamed camera espinho-silvalde changed name/);
  assert.match(errors, /renamed camera espinho-silvalde changed coordinates/);
  assert.match(errors, /Monte Verde.*name/);
  assert.match(errors, /Monte Verde.*location/);
  assert.match(errors, /Monte Verde.*livecamId/);
  assert.match(errors, /Monte Verde.*streamUrl/);
});

test("stable region migration allows only the attested ilhas to madeira correction", () => {
  const candidate = validCandidate();
  assert.equal(validateMeoCrawl({ baseline, candidate }).ok, true);

  const stable = candidate.cameras.find((camera) => camera.id === "porto-santo");
  stable.region = "acores";
  candidate.regions = [...new Set(candidate.cameras.map((camera) => camera.region).filter(Boolean))].sort();
  const result = validateMeoCrawl({ baseline, candidate });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /stable camera porto-santo changed region/);
});

test("validator enforces aggregate totals, playable floor, stream uniqueness, and multicam count", () => {
  const candidate = validCandidate();
  const playable = candidate.cameras.filter((camera) => camera.hasStream);
  playable[1].streamUrl = playable[0].streamUrl;
  for (const camera of playable.slice(2, 12)) {
    camera.hasStream = false;
    camera.streamUrl = "";
  }
  candidate.cameras.find((camera) => camera.isMulti).isMulti = false;

  const result = validateMeoCrawl({ baseline, candidate });
  const errors = result.errors.join("\n");
  assert.match(errors, /duplicate playable stream URL/);
  assert.match(errors, /exactly 154 playable/);
  assert.match(errors, /not regress below baseline/);
  assert.match(errors, /exactly 73 multicam/);
});

test("validator canonicalizes feed URLs and verifies derived catalog metadata", () => {
  const candidate = validCandidate();
  const playable = candidate.cameras.filter((camera) => camera.hasStream);
  playable[1].streamUrl = playable[0].streamUrl.replace("video-auth1.iol.pt", "VIDEO-AUTH1.IOL.PT");
  candidate.regions = candidate.regions.filter((region) => region !== "acores");
  candidate.source.detailPageCount -= 1;

  const result = validateMeoCrawl({ baseline, candidate });
  const errors = result.errors.join("\n");
  assert.match(errors, /duplicate playable stream URL/);
  assert.match(errors, /candidate regions metadata/);
  assert.match(errors, /detailPageCount/);

  const wrongPath = validCandidate();
  wrongPath.cameras.find((camera) => camera.hasStream).streamUrl =
    "https://video-auth1.iol.pt/not-a-provider-feed/playlist.m3u8";
  assert.match(validateMeoCrawl({ baseline, candidate: wrongPath }).errors.join("\n"), /provider MEO HLS path/);
});

test("CLI prints JSON and exits nonzero for a rejected candidate", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meo-validator-"));
  const baselinePath = path.join(tempDir, "baseline.json");
  const candidatePath = path.join(tempDir, "candidate.json");
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  fs.writeFileSync(candidatePath, JSON.stringify({ cameras: [] }));

  const failed = spawnSync(process.execPath, [
    "scripts/validate-meo-crawl.cjs",
    "--baseline", baselinePath,
    "--candidate", candidatePath
  ], { encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.equal(JSON.parse(failed.stdout).ok, false);

  fs.writeFileSync(candidatePath, JSON.stringify(validCandidate()));
  const stdout = execFileSync(process.execPath, [
    "scripts/validate-meo-crawl.cjs",
    "--baseline", baselinePath,
    "--candidate", candidatePath
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(stdout).ok, true);
});
