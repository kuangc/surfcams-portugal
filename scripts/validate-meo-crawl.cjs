#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_REMOVED_IDS = Object.freeze([
  "espinho-silvade",
  "espinhosilvadeestatica",
  "surfline-castelo"
]);
const EXPECTED_ADDED_IDS = Object.freeze([
  "acores-ribeira-grande-praia-do-monte-verde",
  "espinho-silvalde",
  "espinhosilvaldeestatica"
]);
const RENAMED_IDS = Object.freeze({
  "espinho-silvade": "espinho-silvalde",
  espinhosilvadeestatica: "espinhosilvaldeestatica"
});
const REQUIRED_TOTAL = 190;
const REQUIRED_PLAYABLE = 148;
const REQUIRED_MULTICAM = 73;
const STREAM_HOST = "video-auth1.iol.pt";

function normalizeIdentityText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" | ");
}

function normalizeIdentityKey(value) {
  return normalizeIdentityText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b, "en"));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSurflineProvider(camera) {
  return /surfline/i.test(String(camera?.provider || ""));
}

function hasPlayableStream(camera) {
  return typeof camera?.streamUrl === "string" && camera.streamUrl.trim() !== "";
}

function addDuplicateError(errors, seen, value, label, cameraId) {
  if (seen.has(value)) {
    errors.push(`duplicate ${label} ${JSON.stringify(value)} at camera ${cameraId}`);
  } else {
    seen.add(value);
  }
}

function validateStream(camera, errors) {
  const errorCount = errors.length;
  const id = camera.id || "<missing id>";
  const livecamId = normalizeIdentityText(camera.livecamId);
  if (!livecamId || livecamId !== camera.livecamId) {
    errors.push(`playable camera ${id} must have a normalized nonblank livecamId`);
  }

  let stream;
  try {
    stream = new URL(camera.streamUrl);
  } catch (_error) {
    errors.push(`playable camera ${id} stream must be a valid credential-free HTTPS URL`);
    return null;
  }

  if (stream.protocol !== "https:" || stream.username || stream.password) {
    errors.push(`playable camera ${id} stream must be a credential-free HTTPS URL`);
  }
  if (stream.hostname !== STREAM_HOST) {
    errors.push(`playable camera ${id} stream host must be exactly ${STREAM_HOST}`);
  }
  if (stream.port !== "") {
    errors.push(`playable camera ${id} stream must use the default port`);
  }
  if (!/^\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i.test(stream.pathname)) {
    errors.push(`playable camera ${id} stream must use a provider MEO HLS path`);
  }
  if (stream.search || stream.hash) {
    errors.push(`playable camera ${id} stream must not contain query credentials or a fragment`);
  }
  return errors.length === errorCount ? stream.href : null;
}

function validateAggregateMetadata(candidate, cameras, total, playable, coordinates, errors) {
  if (candidate.total !== total) {
    errors.push(`candidate total metadata ${candidate.total} does not match ${total} camera rows`);
  }
  if (candidate.withStreams !== playable) {
    errors.push(`candidate withStreams metadata ${candidate.withStreams} does not match ${playable} playable rows`);
  }
  if (candidate.withCoordinates !== coordinates) {
    errors.push(`candidate withCoordinates metadata ${candidate.withCoordinates} does not match ${coordinates} coordinate rows`);
  }
  const derivedRegions = sorted(new Set(cameras.map((camera) => camera.region).filter(Boolean)));
  const candidateRegions = Array.isArray(candidate.regions) ? sorted(candidate.regions) : [];
  if (!sameArray(candidateRegions, derivedRegions)) {
    errors.push(`candidate regions metadata must match derived regions ${derivedRegions.join(", ")}`);
  }
  if (candidate?.source?.detailPageCount !== total) {
    errors.push(`candidate source.detailPageCount ${candidate?.source?.detailPageCount} does not match ${total} camera rows`);
  }
}

function comparableStreamIdentity(value) {
  try {
    const stream = new URL(value);
    const path = stream.pathname.replace(/^\/auth-beachcam\//, "/beachcam/");
    return `${stream.hostname.toLowerCase()}${path}`;
  } catch {
    return "";
  }
}

function validateStableIdentities(baselineById, candidateById, removedIds, addedIds, errors) {
  const removed = new Set(removedIds);
  const added = new Set(addedIds);

  for (const [id, before] of baselineById) {
    if (removed.has(id)) continue;
    const after = candidateById.get(id);
    if (!after || added.has(id)) continue;

    for (const field of ["name", "location"]) {
      if (normalizeIdentityText(before[field]) !== normalizeIdentityText(after[field])) {
        errors.push(`stable camera ${id} changed ${field}`);
      }
    }

    if (Number(before.lat) !== Number(after.lat) || Number(before.lon) !== Number(after.lon)) {
      errors.push(`stable camera ${id} changed coordinates`);
    }

    const beforeRegion = normalizeIdentityText(before.region);
    const afterRegion = normalizeIdentityText(after.region);
    if (beforeRegion !== afterRegion && !(beforeRegion === "ilhas" && afterRegion === "madeira")) {
      errors.push(`stable camera ${id} changed region from ${beforeRegion} to ${afterRegion}`);
    }

    if (Boolean(before.hasStream) !== Boolean(after.hasStream)) {
      errors.push(`stable camera ${id} changed hasStream`);
    }
    if (normalizeIdentityText(before.livecamId) !== normalizeIdentityText(after.livecamId)) {
      errors.push(`stable camera ${id} changed livecamId`);
    }
    if (comparableStreamIdentity(before.streamUrl) !== comparableStreamIdentity(after.streamUrl)) {
      errors.push(`stable camera ${id} changed streamUrl`);
    }
    if (String(before.videoId || "") !== String(after.videoId || "")) {
      errors.push(`stable camera ${id} changed videoId`);
    }
  }
}

function validateRenamedFeeds(baselineById, candidateById, errors) {
  for (const [oldId, newId] of Object.entries(RENAMED_IDS)) {
    const before = baselineById.get(oldId);
    const after = candidateById.get(newId);
    if (!before || !after) continue;

    const expectedName = normalizeIdentityText(before.name).replace(/Silvade/g, "Silvalde");
    if (normalizeIdentityText(after.name) !== expectedName) {
      errors.push(`renamed camera ${newId} changed name; expected ${expectedName}`);
    }
    if (normalizeIdentityText(after.location) !== normalizeIdentityText(before.location)) {
      errors.push(`renamed camera ${newId} changed location`);
    }
    if (Number(after.lat) !== Number(before.lat) || Number(after.lon) !== Number(before.lon)) {
      errors.push(`renamed camera ${newId} changed coordinates`);
    }
    if (normalizeIdentityKey(after.region) !== normalizeIdentityKey(before.region)) {
      errors.push(`renamed camera ${newId} changed region`);
    }
    if (Boolean(after.hasStream) !== Boolean(before.hasStream)) {
      errors.push(`renamed camera ${newId} changed hasStream`);
    }
    if (normalizeIdentityText(after.livecamId) !== normalizeIdentityText(before.livecamId)) {
      errors.push(`renamed camera ${newId} changed livecamId`);
    }
    if (comparableStreamIdentity(after.streamUrl) !== comparableStreamIdentity(before.streamUrl)) {
      errors.push(`renamed camera ${newId} changed streamUrl`);
    }
    const expectedVideoId = String(before.videoId || "").replace(/silvade/g, "silvalde");
    if (String(after.videoId || "") !== expectedVideoId) {
      errors.push(`renamed camera ${newId} changed videoId; expected ${expectedVideoId}`);
    }
  }
}

function validateMonteVerde(candidateById, errors) {
  const camera = candidateById.get("acores-ribeira-grande-praia-do-monte-verde");
  if (!camera) return;
  const expected = {
    name: "Praia do Monte Verde",
    location: "RIBEIRA GRANDE",
    region: "acores",
    lat: 37.82283518670187,
    lon: -25.525591721374866,
    livecamId: "34828",
    streamUrl: "video-auth1.iol.pt/beachcam/bcribeiragrande/playlist.m3u8",
    videoId: "130294768/beachcam/web/acores-ribeira-grande-praia-do-monte-verde/live/VIDEO"
  };
  if (normalizeIdentityText(camera.name) !== expected.name) errors.push("Monte Verde camera changed name");
  if (normalizeIdentityText(camera.location) !== expected.location) errors.push("Monte Verde camera changed location");
  if (normalizeIdentityKey(camera.region) !== expected.region) errors.push("Monte Verde camera changed region");
  if (Number(camera.lat) !== expected.lat || Number(camera.lon) !== expected.lon) errors.push("Monte Verde camera changed coordinates");
  if (normalizeIdentityText(camera.livecamId) !== expected.livecamId) errors.push("Monte Verde camera changed livecamId");
  if (comparableStreamIdentity(camera.streamUrl) !== expected.streamUrl) errors.push("Monte Verde camera changed streamUrl");
  if (String(camera.videoId || "") !== expected.videoId) errors.push("Monte Verde camera changed videoId");
  if (camera.hasStream !== true) errors.push("Monte Verde camera must remain playable");
}

function validateMeoCrawl({ baseline, candidate }) {
  const errors = [];
  const baselineCameras = Array.isArray(baseline?.cameras) ? baseline.cameras : [];
  const cameras = Array.isArray(candidate?.cameras) ? candidate.cameras : [];
  if (!Array.isArray(baseline?.cameras)) errors.push("baseline must contain a cameras array");
  if (!Array.isArray(candidate?.cameras)) errors.push("candidate must contain a cameras array");

  const ids = new Set();
  const playableLivecamIds = new Set();
  const playableStreams = new Set();
  let coordinates = 0;

  for (const camera of cameras) {
    const cameraId = normalizeIdentityText(camera?.id) || "<missing id>";
    for (const field of ["id", "name", "location", "region"]) {
      const normalized = normalizeIdentityText(camera?.[field]);
      if (!normalized || normalized !== camera?.[field]) {
        errors.push(`camera ${cameraId} must have a normalized nonempty ${field}`);
      }
    }

    addDuplicateError(errors, ids, String(camera?.id || ""), "camera id", cameraId);

    if (
      !Number.isFinite(camera?.lat)
      || camera.lat < -90
      || camera.lat > 90
      || !Number.isFinite(camera?.lon)
      || camera.lon < -180
      || camera.lon > 180
    ) {
      errors.push(`camera ${cameraId} must have finite coordinates within geographic bounds`);
    } else {
      coordinates += 1;
    }

    if (camera?.error) {
      errors.push(`camera ${cameraId} contains crawl error: ${camera.error}`);
    }
    if (isSurflineProvider(camera)) {
      errors.push(`camera ${cameraId} retains a Surfline provider identity`);
    }
    if (camera?.id === "surfline-castelo") {
      errors.push("candidate must not retain camera id surfline-castelo");
    }

    const playable = hasPlayableStream(camera);
    if (Boolean(camera?.hasStream) !== playable) {
      errors.push(`camera ${cameraId} hasStream must match the presence of streamUrl`);
    }
    if (!playable) continue;

    const canonicalStream = validateStream(camera, errors);
    const livecamId = normalizeIdentityText(camera.livecamId);
    if (livecamId) addDuplicateError(errors, playableLivecamIds, livecamId, "playable livecamId", cameraId);
    if (canonicalStream) addDuplicateError(errors, playableStreams, canonicalStream, "playable stream URL", cameraId);
  }

  const baselineIds = new Set(baselineCameras.map((camera) => camera.id));
  const candidateIds = new Set(cameras.map((camera) => camera.id));
  const removedIds = sorted([...baselineIds].filter((id) => !candidateIds.has(id)));
  const addedIds = sorted([...candidateIds].filter((id) => !baselineIds.has(id)));
  const expectedRemoved = sorted(EXPECTED_REMOVED_IDS);
  const expectedAdded = sorted(EXPECTED_ADDED_IDS);
  if (!sameArray(removedIds, expectedRemoved) || !sameArray(addedIds, expectedAdded)) {
    errors.push(`camera ID delta must remove ${expectedRemoved.join(", ")} and add ${expectedAdded.join(", ")}; got removed ${removedIds.join(", ")} and added ${addedIds.join(", ")}`);
  }

  const baselineById = new Map(baselineCameras.map((camera) => [camera.id, camera]));
  const candidateById = new Map(cameras.map((camera) => [camera.id, camera]));
  validateStableIdentities(baselineById, candidateById, EXPECTED_REMOVED_IDS, EXPECTED_ADDED_IDS, errors);
  validateRenamedFeeds(baselineById, candidateById, errors);
  validateMonteVerde(candidateById, errors);

  const total = cameras.length;
  const playable = cameras.filter(hasPlayableStream).length;
  const baselinePlayable = baselineCameras.filter((camera) => !isSurflineProvider(camera) && hasPlayableStream(camera)).length;
  const multicam = cameras.filter((camera) => camera?.isMulti === true).length;

  if (total !== REQUIRED_TOTAL) errors.push(`candidate must contain exactly ${REQUIRED_TOTAL} cameras; got ${total}`);
  if (playable !== REQUIRED_PLAYABLE) errors.push(`candidate must contain exactly ${REQUIRED_PLAYABLE} playable cameras; got ${playable}`);
  if (playable < baselinePlayable) errors.push(`candidate playable count ${playable} must not regress below baseline real-MEO playable count ${baselinePlayable}`);
  if (multicam !== REQUIRED_MULTICAM) errors.push(`candidate must contain exactly ${REQUIRED_MULTICAM} multicam cameras; got ${multicam}`);
  validateAggregateMetadata(candidate || {}, cameras, total, playable, coordinates, errors);

  return {
    ok: errors.length === 0,
    errors,
    total,
    playable,
    baselinePlayable,
    multicam,
    removedIds,
    addedIds
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== "--baseline" && option !== "--candidate") {
      throw new Error(`Unknown option: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a path`);
    options[option.slice(2)] = path.resolve(value);
    index += 1;
  }
  if (!options.baseline) throw new Error("--baseline requires a path");
  if (!options.candidate) throw new Error("--candidate requires a path");
  return options;
}

function main(argv = process.argv.slice(2)) {
  let result;
  try {
    const options = parseArgs(argv);
    const baseline = JSON.parse(fs.readFileSync(options.baseline, "utf8"));
    const candidate = JSON.parse(fs.readFileSync(options.candidate, "utf8"));
    result = validateMeoCrawl({ baseline, candidate });
  } catch (error) {
    result = { ok: false, errors: [error.message] };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) main();

module.exports = {
  EXPECTED_ADDED_IDS,
  EXPECTED_REMOVED_IDS,
  normalizeIdentityText,
  parseArgs,
  validateMeoCrawl
};
