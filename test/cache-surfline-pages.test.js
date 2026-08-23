import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cacheScriptPath = path.join(repositoryRoot, "scripts", "cache-surfline-pages.js");
const previousReviewGeneratedAt = "2026-06-13T08:00:00.000Z";

const surflineSpot = {
  id: "surfline-test-spot",
  provider: "surfline",
  name: "Current Test Spot",
  url: "https://www.surfline.com/surf-report/current-test-spot/spot-id",
  lat: 38.7,
  lon: -9.4,
  region: "Lisboa Portugal",
  country: "Portugal"
};

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeFixture(t, { previousPages }) {
  const root = await mkdtemp(path.join(tmpdir(), "surfline-review-reuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(root, "scripts"), { recursive: true }),
    mkdir(path.join(root, "data"), { recursive: true }),
    mkdir(path.join(root, "docs"), { recursive: true })
  ]);
  await copyFile(cacheScriptPath, path.join(root, "scripts", "cache-surfline-pages.js"));
  await Promise.all([
    writeJson(path.join(root, "data", "surfline-spots.json"), {
      spots: [surflineSpot]
    }),
    writeJson(path.join(root, "data", "meo-spots.json"), {
      spots: [{ id: "meo-test-spot", name: "MEO Test Spot", url: "https://beachcam.meo.pt/test" }]
    }),
    writeJson(path.join(root, "data", "meo-surfline-matches.json"), {
      matches: [{
        meoSpotId: "meo-test-spot",
        surflineSpotIds: [surflineSpot.id],
        distancesKm: { [surflineSpot.id]: 1.25 },
        proposedCloseRule: "nearest",
        notes: "metadata-only review"
      }]
    }),
    writeJson(path.join(root, "data", "surfline-mapping-review.json"), {
      schemaVersion: 1,
      generatedAt: previousReviewGeneratedAt,
      pages: previousPages
    })
  ]);
  return root;
}

test("offline review rebuild reuses previously extracted Surfline metadata", async (t) => {
  const previousPage = {
    id: surflineSpot.id,
    provider: "surfline",
    name: "Old Test Spot",
    url: surflineSpot.url,
    lat: 1,
    lon: 2,
    region: "Old Region",
    country: "Old Country",
    extractedTitle: "Cached Surfline Review Title",
    titleSource: "h1",
    cachePath: ".cache/surfline/pages/surfline-test-spot.html",
    cacheMetaPath: ".cache/surfline/pages/surfline-test-spot.json",
    cacheStatus: "browser-fetched",
    httpStatus: 200,
    fetchedAt: "2026-06-11T12:50:25.711Z",
    fetchError: null
  };
  const root = await makeFixture(t, { previousPages: [previousPage] });

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "cache-surfline-pages.js"),
    "--offline"
  ], { cwd: root });

  const review = JSON.parse(await readFile(
    path.join(root, "data", "surfline-mapping-review.json"),
    "utf8"
  ));
  assert.equal(review.pages.length, 1);
  assert.deepEqual(review.pages[0], {
    id: surflineSpot.id,
    provider: surflineSpot.provider,
    name: surflineSpot.name,
    url: surflineSpot.url,
    lat: surflineSpot.lat,
    lon: surflineSpot.lon,
    region: surflineSpot.region,
    country: surflineSpot.country,
    extractedTitle: previousPage.extractedTitle,
    titleSource: previousPage.titleSource,
    cachePath: null,
    cacheMetaPath: null,
    cacheStatus: "reused-review-metadata",
    httpStatus: null,
    fetchedAt: null,
    generatedAt: null,
    fetchError: null,
    metadataSource: {
      kind: "previous-review",
      reviewGeneratedAt: previousReviewGeneratedAt,
      pageUrl: previousPage.url,
      fetchedAt: previousPage.fetchedAt,
      generatedAt: null,
      cacheStatus: previousPage.cacheStatus,
      httpStatus: previousPage.httpStatus
    }
  });
  assert.match(stdout, /reused metadata for 1/i);
  assert.doesNotMatch(stdout, /Cached 1 Surfline pages/);
  assert.equal(review.mappings[0].surflineMatches[0].extractedTitle, previousPage.extractedTitle);

  const markdown = await readFile(
    path.join(root, "docs", "surfline-mapping-review.md"),
    "utf8"
  );
  assert.match(markdown, /Cached Surfline Review Title/);
  assert.match(markdown, /reused-review-metadata/);
  assert.match(markdown, /do not claim a local HTML cache/i);
});

test("consecutive offline rebuilds retain the original metadata provenance", async (t) => {
  const previousPage = {
    id: surflineSpot.id,
    provider: "surfline",
    name: "Old Test Spot",
    url: surflineSpot.url,
    extractedTitle: "Cached Surfline Review Title",
    titleSource: "h1",
    cacheStatus: "browser-fetched",
    httpStatus: 200,
    fetchedAt: "2026-06-11T12:50:25.711Z",
    generatedAt: "2026-06-11T13:00:00.000Z"
  };
  const root = await makeFixture(t, { previousPages: [previousPage] });
  const args = [
    path.join(root, "scripts", "cache-surfline-pages.js"),
    "--offline"
  ];

  await execFileAsync(process.execPath, args, { cwd: root });
  const reviewPath = path.join(root, "data", "surfline-mapping-review.json");
  const firstReview = JSON.parse(await readFile(reviewPath, "utf8"));
  await execFileAsync(process.execPath, args, { cwd: root });
  const secondReview = JSON.parse(await readFile(reviewPath, "utf8"));

  assert.deepEqual(secondReview.pages[0].metadataSource, firstReview.pages[0].metadataSource);
  assert.deepEqual(secondReview.pages[0].metadataSource, {
    kind: "previous-review",
    reviewGeneratedAt: previousReviewGeneratedAt,
    pageUrl: previousPage.url,
    fetchedAt: previousPage.fetchedAt,
    generatedAt: previousPage.generatedAt,
    cacheStatus: previousPage.cacheStatus,
    httpStatus: previousPage.httpStatus
  });
});

test("offline review rebuild reads the HTML cache for pages absent from the prior review", async (t) => {
  const root = await makeFixture(t, { previousPages: [] });
  const cacheRoot = path.join(root, ".cache", "surfline", "pages");
  await mkdir(cacheRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(cacheRoot, `${surflineSpot.id}.html`),
      "<!doctype html><body><h1>Title From Offline HTML Cache</h1></body>\n"
    ),
    writeJson(path.join(cacheRoot, `${surflineSpot.id}.json`), {
      id: surflineSpot.id,
      url: surflineSpot.url,
      status: 200,
      fetchedAt: "2026-06-12T10:00:00.000Z",
      cacheStatus: "browser-fetched"
    })
  ]);

  await execFileAsync(process.execPath, [
    path.join(root, "scripts", "cache-surfline-pages.js"),
    "--offline"
  ], { cwd: root });

  const review = JSON.parse(await readFile(
    path.join(root, "data", "surfline-mapping-review.json"),
    "utf8"
  ));
  assert.equal(review.pages[0].extractedTitle, "Title From Offline HTML Cache");
  assert.equal(review.pages[0].titleSource, "h1");
  assert.equal(review.pages[0].cacheStatus, "browser-fetched");
});

test("offline review does not relabel prior metadata when a spot URL changed", async (t) => {
  const previousPage = {
    id: surflineSpot.id,
    provider: "surfline",
    name: "Old Test Spot",
    url: "https://www.surfline.com/surf-report/old-test-spot/spot-id",
    extractedTitle: "Title From The Old URL",
    titleSource: "h1",
    cacheStatus: "browser-fetched"
  };
  const root = await makeFixture(t, { previousPages: [previousPage] });
  const cacheRoot = path.join(root, ".cache", "surfline", "pages");
  await mkdir(cacheRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(cacheRoot, `${surflineSpot.id}.html`),
      "<!doctype html><body><h1>Title From Current Cache Review</h1></body>\n"
    ),
    writeJson(path.join(cacheRoot, `${surflineSpot.id}.json`), {
      id: surflineSpot.id,
      url: previousPage.url,
      status: 200,
      fetchedAt: "2026-06-12T10:00:00.000Z",
      cacheStatus: "browser-fetched"
    })
  ]);

  await execFileAsync(process.execPath, [
    path.join(root, "scripts", "cache-surfline-pages.js"),
    "--offline"
  ], { cwd: root });

  const review = JSON.parse(await readFile(
    path.join(root, "data", "surfline-mapping-review.json"),
    "utf8"
  ));
  assert.equal(review.pages[0].url, surflineSpot.url);
  assert.equal(review.pages[0].extractedTitle, "Title From Current Cache Review");
  assert.equal(review.pages[0].cacheStatus, "cached-url-mismatch");
});

test("offline review reports a malformed prior review instead of hiding it as a cache miss", async (t) => {
  const root = await makeFixture(t, { previousPages: [] });
  await writeFile(
    path.join(root, "data", "surfline-mapping-review.json"),
    "{malformed review\n",
    "utf8"
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(root, "scripts", "cache-surfline-pages.js"),
      "--offline"
    ], { cwd: root }),
    (error) => {
      assert.doesNotMatch(error.stderr, /Missing cache/i);
      assert.match(error.stderr, /JSON|Expected property|position/i);
      return true;
    }
  );
});
