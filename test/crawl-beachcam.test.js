import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  assertUniqueCameras,
  crawl,
  parseCliArgs,
  parseDetail,
  parseListing
} = require("../scripts/crawl-beachcam.cjs");

const currentListingItem = ({
  slug = "espinho-silvalde",
  name = "  Espinho   | Silvalde  ",
  multicam = true
} = {}) => `
  <li class="liveCamsGrid__list-item"
      data-lat="40.99806714090027"
      data-lon="-8.647296248547374"
      data-clicks="264666"
      data-name="${name}"
      data-region="norte">
    <a href="http://beachcam.meo.pt/livecams/${slug}/" class="liveCamsGrid__list-item-link">
      <div class="liveCamsGrid__list-item-info">
        ${multicam ? '<span class="liveCamsGrid__feature liveCamsGrid__feature--multicam" aria-label="Multicam"><span>Multicam</span></span>' : ""}
        <label class="liveCamsGrid__list-item-location"> ESPINHO </label>
        <p class="liveCamsGrid__list-item-name">${name}</p>
      </div>
    </a>
  </li>`;

const detailPage = ({ name = "  Espinho   | Silvalde  ", livecamId = "2286", stream = "https://video-auth1.iol.pt/auth-beachcam/bcsilvade/playlist.m3u8" } = {}) => `
  <meta property="og:title" content="Fallback title">
  <section class="liveCamsHeader" data-name="${name}" data-livecam-id="${livecamId}"></section>
  <div data-control="livecam" data-video-url="${stream}" data-video-id="provider-video"></div>`;

test("parseListing recognizes current multicam markup and normalizes provider identity text", () => {
  const [camera] = parseListing(currentListingItem());

  assert.equal(camera.id, "espinho-silvalde");
  assert.equal(camera.name, "Espinho | Silvalde");
  assert.equal(camera.location, "ESPINHO");
  assert.equal(camera.region, "norte");
  assert.equal(camera.isMulti, true);
});

test("parseListing retains compatibility with the legacy multicam marker", () => {
  const html = currentListingItem({ multicam: false }).replace(
    '<div class="liveCamsGrid__list-item-info">',
    '<div class="liveCamsGrid__list-item-info"><span class="liveCamsGrid__list-item-cam">Multi</span>'
  );
  assert.equal(parseListing(html)[0].isMulti, true);
});

test("parseDetail normalizes the authoritative detail data-name", () => {
  const detail = parseDetail(detailPage(), "https://beachcam.meo.pt/livecams/espinho-silvalde/");
  assert.equal(detail.name, "Espinho | Silvalde");
  assert.equal(detail.livecamId, "2286");
  assert.equal(detail.streamUrl, "https://video-auth1.iol.pt/auth-beachcam/bcsilvade/playlist.m3u8");
});

test("provider identity normalization removes empty pipe segments", () => {
  const detail = parseDetail(
    detailPage({ name: "  Espinho  |  Silvalde | Estática |  " }),
    "https://beachcam.meo.pt/livecams/espinhosilvaldeestatica/"
  );
  assert.equal(detail.name, "Espinho | Silvalde | Estática");
});

test("parseCliArgs requires an explicit path after --output", () => {
  assert.deepEqual(parseCliArgs(["--refresh", "--output", "/tmp/meo.json"]), {
    refresh: true,
    outputPath: "/tmp/meo.json"
  });
  assert.throws(() => parseCliArgs(["--output"]), /--output requires a path/);
  assert.throws(() => parseCliArgs(["--unknown"]), /Unknown option/);
});

test("crawl writes a validated candidate to the explicit staging path", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-test-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");

  const db = await crawl({
    outputPath,
    fetchPage: async (url) => (
      url.endsWith("/livecams/")
        ? currentListingItem({ slug: "espinho-silvalde" })
        : detailPage()
    ),
    logger: () => {}
  });

  assert.equal(db.total, 1);
  assert.equal(db.cameras[0].name, "Espinho | Silvalde");
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), db);
});

test("crawl leaves the staged output untouched when any detail fetch fails", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-test-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  await fs.writeFile(outputPath, "existing candidate\n", "utf8");
  const listing = `${currentListingItem({ slug: "one" })}${currentListingItem({ slug: "two" })}`;

  await assert.rejects(
    crawl({
      outputPath,
      fetchPage: async (url) => {
        if (url.endsWith("/livecams/")) return listing;
        if (url.endsWith("/one/")) return detailPage({ livecamId: "1" });
        throw new Error("provider detail unavailable");
      },
      logger: () => {}
    }),
    /provider detail unavailable/
  );
  assert.equal(await fs.readFile(outputPath, "utf8"), "existing candidate\n");
});

test("duplicate camera IDs and playable provider feeds are rejected", () => {
  const base = {
    id: "one",
    livecamId: "1",
    streamUrl: "https://video-auth1.iol.pt/auth-beachcam/one/playlist.m3u8",
    hasStream: true
  };
  const streamless = {
    id: "offline-provider-row",
    livecamId: "2771",
    streamUrl: "",
    hasStream: false
  };

  assert.doesNotThrow(() => assertUniqueCameras([base, streamless]));

  assert.throws(() => assertUniqueCameras([base, { ...base }]), /duplicate camera id.*one/i);
  assert.throws(
    () => assertUniqueCameras([base, { ...base, id: "two", streamUrl: "https://video-auth1.iol.pt/auth-beachcam/two/playlist.m3u8" }]),
    /duplicate playable livecamId.*1/i
  );
  assert.throws(
    () => assertUniqueCameras([base, { ...base, id: "two", livecamId: "2" }]),
    /duplicate playable stream URL/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, livecamId: "" }]),
    /missing livecamId.*one/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, streamUrl: "https://example.test/looks-valid/playlist.m3u8" }]),
    /non-playable stream URL.*one/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, streamUrl: "https://user:secret@video-auth1.iol.pt/beachcam/one/playlist.m3u8" }]),
    /non-playable stream URL.*one/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, streamUrl: "https://video-auth1.iol.pt:444/beachcam/one/playlist.m3u8" }]),
    /non-playable stream URL.*one/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, streamUrl: "https://video-auth1.iol.pt/other/one/playlist.m3u8" }]),
    /non-playable stream URL.*one/i
  );
  assert.throws(
    () => assertUniqueCameras([{ ...base, error: "detail failed" }]),
    /detail failed.*one/i
  );
});
