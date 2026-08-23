import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  crawl,
  parseCliArgs,
  parseDetail,
  parseListing,
  writeFileAtomically
} = require("../scripts/crawl-beachcam.cjs");

function listingItem({
  slug = "espinho-silvalde",
  name = " Espinho | Silvalde | ",
  region = " norte ",
  multicam = true
} = {}) {
  return `
    <li class="liveCamsGrid__list-item"
        data-lat="40.998"
        data-lon="-8.647"
        data-clicks="12"
        data-name="${name}"
        data-region="${region}">
      <a href="https://beachcam.meo.pt/livecams/${slug}/" class="liveCamsGrid__list-item-link">
        ${multicam ? '<span class="liveCamsGrid__feature liveCamsGrid__feature--multicam">Multicam</span>' : ""}
        <label class="liveCamsGrid__list-item-location"> ESPINHO </label>
        <p class="liveCamsGrid__list-item-name">${name}</p>
      </a>
    </li>`;
}

function detailPage({ name = " Espinho | Silvalde | " } = {}) {
  return `
    <meta property="og:title" content="Fallback title">
    <section class="liveCamsHeader" data-name="${name}"></section>`;
}

test("provider identity parsing removes empty pipe segments and recognizes current multicam markup", () => {
  const [camera] = parseListing(listingItem());

  assert.equal(camera.name, "Espinho | Silvalde");
  assert.equal(camera.location, "ESPINHO");
  assert.equal(camera.region, "norte");
  assert.equal(camera.isMulti, true);

  const detail = parseDetail(
    detailPage(),
    "https://beachcam.meo.pt/livecams/espinho-silvalde/"
  );
  assert.equal(detail.name, "Espinho | Silvalde");
});

test("detail parsing rejects a generic success page without MEO camera structure", () => {
  assert.throws(
    () => parseDetail("<html><body>Upstream challenge</body></html>", "https://beachcam.meo.pt/livecams/test/"),
    /missing live camera header/i
  );
});

test("crawler CLI requires an explicit staging path and refuses the accepted catalog", () => {
  assert.deepEqual(parseCliArgs(["--refresh", "--output", "/tmp/meo-candidate.json"]), {
    refresh: true,
    outputPath: "/tmp/meo-candidate.json"
  });
  assert.throws(() => parseCliArgs([]), /output is required.*staging file/i);
  assert.throws(
    () => parseCliArgs(["--output", "data/../data/beachcam-cameras.json"]),
    /refusing to overwrite the accepted camera catalog/i
  );
});

test("crawler rejects an empty listing without replacing an existing staged candidate", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-empty-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  await fs.writeFile(outputPath, "existing candidate\n", "utf8");

  await assert.rejects(
    crawl({
      outputPath,
      fetchPage: async () => "<html><body>No cameras</body></html>",
      logger: () => {}
    }),
    /listing contained no cameras/i
  );
  assert.equal(await fs.readFile(outputPath, "utf8"), "existing candidate\n");
});

test("crawler rejects duplicate provider IDs before fetching details", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-duplicates-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  let detailFetches = 0;

  await assert.rejects(
    crawl({
      outputPath,
      fetchPage: async (url) => {
        if (url.endsWith("/livecams/")) return `${listingItem()}${listingItem()}`;
        detailFetches += 1;
        return detailPage();
      },
      logger: () => {}
    }),
    /duplicate camera IDs.*espinho-silvalde/i
  );

  assert.equal(detailFetches, 0);
  await assert.rejects(fs.access(outputPath), { code: "ENOENT" });
});

test("crawler rejects a generic HTTP-success detail page", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-generic-detail-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");

  await assert.rejects(
    crawl({
      outputPath,
      fetchPage: async (url) => (
        url.endsWith("/livecams/")
          ? listingItem()
          : "<html><body>Upstream challenge</body></html>"
      ),
      logger: () => {}
    }),
    /missing live camera header/i
  );

  await assert.rejects(fs.access(outputPath), { code: "ENOENT" });
});

test("crawler rejects a detail failure without replacing an existing staged candidate", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-detail-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  await fs.writeFile(outputPath, "existing candidate\n", "utf8");

  await assert.rejects(
    crawl({
      outputPath,
      fetchPage: async (url) => {
        if (url.endsWith("/livecams/")) return listingItem();
        throw new Error("provider detail unavailable");
      },
      logger: () => {}
    }),
    /provider detail unavailable/i
  );
  assert.equal(await fs.readFile(outputPath, "utf8"), "existing candidate\n");
});

test("crawler awaits in-flight details and starts no later work after a failure", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-stop-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  const listingHtml = Array.from({ length: 6 }, (_, index) => listingItem({
    slug: `camera-${index}`,
    name: `Camera ${index}`
  })).join("\n");
  const startedDetails = [];
  let releaseInFlight;
  const inFlightGate = new Promise((resolve) => {
    releaseInFlight = resolve;
  });

  const rejection = assert.rejects(
    crawl({
      outputPath,
      fetchPage: async (url) => {
        if (url.endsWith("/livecams/")) return listingHtml;
        const id = url.split("/").filter(Boolean).at(-1);
        startedDetails.push(id);
        if (id === "camera-0") throw new Error("first detail failed");
        await inFlightGate;
        return detailPage({ name: id });
      },
      logger: () => {}
    }),
    /first detail failed/
  );

  await new Promise((resolve) => setImmediate(resolve));
  releaseInFlight();
  await rejection;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(startedDetails.sort(), ["camera-0", "camera-1", "camera-2", "camera-3"]);
  await assert.rejects(fs.access(outputPath), { code: "ENOENT" });
});

test("crawler writes a complete candidate only to the requested staging path", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-success-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");

  const database = await crawl({
    outputPath,
    fetchPage: async (url) => (
      url.endsWith("/livecams/") ? listingItem() : detailPage()
    ),
    logger: () => {}
  });

  assert.equal(database.total, 1);
  assert.equal(database.cameras[0].name, "Espinho | Silvalde");
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), database);
});

test("atomic candidate writes preserve the previous file when the temporary write fails", async (t) => {
  assert.equal(typeof writeFileAtomically, "function");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-atomic-failure-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, "candidate.json");
  const temporaryPaths = [];
  await fs.writeFile(outputPath, "existing candidate\n", "utf8");

  await assert.rejects(
    writeFileAtomically(outputPath, "replacement candidate\n", {
      writeTemp: async (temporaryPath) => {
        temporaryPaths.push(temporaryPath);
        await fs.writeFile(temporaryPath, "partial", "utf8");
        throw new Error("simulated disk failure");
      }
    }),
    /simulated disk failure/
  );

  assert.equal(await fs.readFile(outputPath, "utf8"), "existing candidate\n");
  assert.equal(temporaryPaths.length, 1);
  await assert.rejects(fs.access(temporaryPaths[0]), { code: "ENOENT" });
});

test("atomic candidate writes replace a staging symlink without following it", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-atomic-symlink-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const acceptedPath = path.join(tempDir, "accepted.json");
  const outputPath = path.join(tempDir, "candidate.json");
  await fs.writeFile(acceptedPath, "accepted catalog\n", "utf8");
  await fs.symlink(acceptedPath, outputPath);

  await writeFileAtomically(outputPath, "replacement candidate\n", {
    forbiddenPath: acceptedPath
  });

  assert.equal(await fs.readFile(acceptedPath, "utf8"), "accepted catalog\n");
  assert.equal((await fs.lstat(outputPath)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(outputPath, "utf8"), "replacement candidate\n");
});

test("atomic candidate writes reject a parent-directory symlink to the accepted catalog", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-parent-symlink-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const acceptedDirectory = path.join(tempDir, "data");
  const stagingDirectory = path.join(tempDir, "cache");
  await Promise.all([
    fs.mkdir(acceptedDirectory, { recursive: true }),
    fs.mkdir(stagingDirectory, { recursive: true })
  ]);
  const acceptedPath = path.join(acceptedDirectory, "beachcam-cameras.json");
  await fs.writeFile(acceptedPath, "accepted catalog\n", "utf8");
  const linkedDirectory = path.join(stagingDirectory, "data-link");
  await fs.symlink(acceptedDirectory, linkedDirectory);
  const outputPath = path.join(linkedDirectory, "beachcam-cameras.json");

  await assert.rejects(
    writeFileAtomically(outputPath, "replacement candidate\n", {
      forbiddenPath: acceptedPath
    }),
    /accepted camera catalog/i
  );
  assert.equal(await fs.readFile(acceptedPath, "utf8"), "accepted catalog\n");
});

test("atomic candidate writes reject a hardlink to the accepted catalog", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-hardlink-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const acceptedPath = path.join(tempDir, "accepted.json");
  const outputPath = path.join(tempDir, "candidate.json");
  await fs.writeFile(acceptedPath, "accepted catalog\n", "utf8");
  await fs.link(acceptedPath, outputPath);

  await assert.rejects(
    writeFileAtomically(outputPath, "replacement candidate\n", {
      forbiddenPath: acceptedPath
    }),
    /accepted camera catalog/i
  );
  assert.equal(await fs.readFile(acceptedPath, "utf8"), "accepted catalog\n");
});

test("atomic candidate writes reject case aliases on case-insensitive file systems", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meo-crawl-case-alias-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const acceptedDirectory = path.join(tempDir, "Data");
  await fs.mkdir(acceptedDirectory, { recursive: true });
  const acceptedPath = path.join(acceptedDirectory, "beachcam-cameras.json");
  await fs.writeFile(acceptedPath, "accepted catalog\n", "utf8");
  const outputPath = path.join(tempDir, "data", "beachcam-cameras.json");
  try {
    await fs.realpath(path.dirname(outputPath));
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("filesystem is case-sensitive");
      return;
    }
    throw error;
  }

  await assert.rejects(
    writeFileAtomically(outputPath, "replacement candidate\n", {
      forbiddenPath: acceptedPath
    }),
    /accepted camera catalog/i
  );
  assert.equal(await fs.readFile(acceptedPath, "utf8"), "accepted catalog\n");
});
