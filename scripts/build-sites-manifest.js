import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_FILE = "sites-package-manifest.json";

function packagePath(distDir, absolutePath) {
  return relative(distDir, absolutePath).split(sep).join("/");
}

async function assertRealDirectory(directory, label) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real non-symlink directory: ${directory}`);
  }
}

async function collectFiles(distDir) {
  await assertRealDirectory(distDir, "Sites package directory");
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

      const path = packagePath(distDir, absolutePath);
      if (path === MANIFEST_FILE) continue;
      files.push({ path, bytes: await readFile(absolutePath) });
    }
  }

  await walk(distDir);
  return files;
}

export async function buildSitesManifest({ distDir = resolve("dist") } = {}) {
  const files = await collectFiles(resolve(distDir));
  const manifest = {
    files: files
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ path, bytes }) => ({
        path,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }))
  };
  await writeFile(
    join(resolve(distDir), MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  buildSitesManifest().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
