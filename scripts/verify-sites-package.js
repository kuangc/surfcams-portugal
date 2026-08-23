import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { findBundledRuntimeLiteral } from "./sites-package/typed-content-scan.js";

const required = [
  "server/index.js",
  ".openai/hosting.json",
  "index.html",
  "manifest.webmanifest",
  "sites-package-manifest.json"
];
const forbiddenText = new RegExp([
  ["hls", "cdn-surfline", "com"].join("\\."),
  ["camstills", "cdn-surfline", "com"].join("\\."),
  "__rawSurfline" + "Feeds"
].join("|"));
const forbiddenTextCaseInsensitive = new RegExp(forbiddenText.source, "i");
const forbiddenFiles = /(^|\/)(test|docs|\.git|\.wrangler|wrangler\.jsonc|wrangler\.bootstrap\.jsonc)(\/|$)/;
const volatilePublicFiles = new Set([
  "data/surfline-conditions.json",
  "data/portugal-tides.json"
]);
const expectedWorkflowHashes = new Map([
  [
    ".github/workflows/update-surfline-conditions.yml",
    "01c9f7be6173ef4f9369d9d4944ece26504ebc771738c268ebdbc90b1020cdea"
  ],
  [
    ".github/workflows/update-tides.yml",
    "84c59d101d89768e99905bb3cbec4dc99d18ba05540123496d7a45b46d4c3175"
  ]
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function packagePath(distDir, absolutePath) {
  return relative(distDir, absolutePath).split(sep).join("/");
}

export function containsForbiddenSurflineText(text) {
  return typeof text === "string"
    && (forbiddenText.test(text) || forbiddenTextCaseInsensitive.test(text));
}

async function collectPackageFiles(distDir) {
  const rootStats = await lstat(distDir);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Sites package directory must be a real non-symlink directory: ${distDir}`);
  }

  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Sites package must not contain symlinks: ${absolutePath}`);
      }
      if (stats.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Sites package entry must be a regular file: ${absolutePath}`);
      }
      files.push({
        path: packagePath(distDir, absolutePath),
        absolutePath,
        bytes: await readFile(absolutePath)
      });
    }
  }
  await walk(distDir);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function verifyManifest(manifest, packageFiles) {
  if (
    manifest === null
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || Object.keys(manifest).length !== 1
    || !Array.isArray(manifest.files)
  ) {
    throw new Error("Sites package manifest must contain only a files array");
  }

  const expectedFiles = packageFiles.filter(
    ({ path }) => path !== "sites-package-manifest.json"
  );
  if (manifest.files.length !== expectedFiles.length) {
    throw new Error("Sites package manifest does not cover the complete package");
  }

  for (let index = 0; index < expectedFiles.length; index += 1) {
    const entry = manifest.files[index];
    const expected = expectedFiles[index];
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || JSON.stringify(Object.keys(entry)) !== JSON.stringify(["path", "bytes", "sha256"])
      || entry.path !== expected.path
      || entry.bytes !== expected.bytes.byteLength
      || entry.sha256 !== sha256(expected.bytes)
    ) {
      throw new Error(`Invalid Sites package manifest entry at index ${index}`);
    }
  }

  const sorted = [...manifest.files].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  if (JSON.stringify(manifest.files) !== JSON.stringify(sorted)) {
    throw new Error("Sites package manifest entries must be sorted by path");
  }
}

export async function verifySitesPackage({ rootDir = resolve("."), distDir } = {}) {
  const root = resolve(rootDir);
  const output = resolve(distDir ?? join(root, "dist"));
  const packageFiles = await collectPackageFiles(output);
  const packageFileMap = new Map(packageFiles.map((file) => [file.path, file]));

  for (const path of required) {
    if (!packageFileMap.has(path)) throw new Error(`Missing required Sites package file: ${path}`);
  }
  for (const { path, bytes } of packageFiles) {
    if (forbiddenFiles.test(path)) throw new Error(`Forbidden Sites package file: ${path}`);
    if (volatilePublicFiles.has(path)) throw new Error(`Volatile data must not be public: ${path}`);

    const text = bytes.toString("utf8");
    if (containsForbiddenSurflineText(text)) {
      throw new Error(`Forbidden Surfline media text in package: ${path}`);
    }
    const bundledLiteral = findBundledRuntimeLiteral(text, { path });
    if (bundledLiteral) throw new Error(`Bundled ${bundledLiteral} literal in package: ${path}`);
  }

  const hosting = JSON.parse(packageFileMap.get(".openai/hosting.json").bytes.toString("utf8"));
  if (hosting.d1 !== "DB" || hosting.r2 !== null) {
    throw new Error("Sites hosting metadata must declare logical DB and no R2 binding");
  }
  if (!Object.keys(hosting).every((key) => ["project_id", "d1", "r2"].includes(key))) {
    throw new Error("Sites hosting metadata contains an unexpected key");
  }

  const manifest = JSON.parse(
    packageFileMap.get("sites-package-manifest.json").bytes.toString("utf8")
  );
  verifyManifest(manifest, packageFiles);

  for (const [path, expectedHash] of expectedWorkflowHashes) {
    const bytes = await readFile(join(root, ...path.split("/")));
    if (sha256(bytes) !== expectedHash) throw new Error(`Frozen workflow changed: ${path}`);
  }

  return { files: packageFiles.map(({ path }) => path) };
}

export { findBundledRuntimeLiteral };

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifySitesPackage()
    .then(({ files }) => {
      process.stdout.write(`sites-package verified-files=${files.length}\n`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
