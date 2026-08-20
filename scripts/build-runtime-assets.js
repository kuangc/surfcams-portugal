import {createHash} from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {lstatSync, readdirSync, realpathSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const RUNTIME_ROOT_FILES = Object.freeze([
  'apple-touch-icon.png',
  'index.html',
  'manifest.webmanifest',
]);

export const RUNTIME_DATA_FILES = Object.freeze([
  'beachcam-cameras.json',
  'coast-exposures.json',
  'lisbon-drive-estimates.json',
  'meo-spots.json',
  'meo-surfline-matches.json',
  'portugal-tides.json',
  'promoted-spots.json',
  'spot-advice-resolved.json',
  'spot-metadata-enrichment.json',
  'stretches.json',
  'surfline-conditions.json',
  'surfline-spots.json',
]);

function normalizedPath(path) {
  return resolve(path);
}

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRealDirectory(directoryPath, label) {
  const directory = normalizedPath(directoryPath);
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real non-symlink directory: ${directory}`);
  }
  if (realpathSync(directory) !== directory) {
    throw new Error(`${label} must use a canonical path without symlink ancestry: ${directory}`);
  }
  return directory;
}

export function assertSafeOutputDirectory({rootDir, outputDir}) {
  if (!rootDir || !outputDir) throw new Error('rootDir and outputDir are required');

  const root = validateRealDirectory(rootDir, 'Repository root');
  const output = normalizedPath(outputDir);
  const canonicalDist = join(root, 'dist');
  const outputIsInsideRepository = isWithin(root, output);
  const outputIsRepositoryAncestor = isWithin(output, root);

  if (outputIsInsideRepository && output !== canonicalDist) {
    throw new Error(`Unsafe output directory inside repository: ${output}`);
  }
  if (outputIsRepositoryAncestor) {
    throw new Error(`Unsafe output directory at or above repository: ${output}`);
  }

  try {
    lstatSync(output);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (output === canonicalDist) return output;
    throw new Error(`External output directory must already exist and be empty: ${output}`);
  }

  validateRealDirectory(output, 'Output directory');

  const realRoot = root;
  const realOutput = realpathSync(output);
  if (isWithin(realRoot, realOutput) && output !== canonicalDist) {
    throw new Error(`Unsafe output directory resolves inside repository: ${output}`);
  }
  if (isWithin(realOutput, realRoot)) {
    throw new Error(`Unsafe output directory resolves at or above repository: ${output}`);
  }

  if (output !== canonicalDist && readdirSync(output).length !== 0) {
    throw new Error(`External output directory must be empty: ${output}`);
  }

  return output;
}

export function validateRuntimeInput(filePath) {
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink()) throw new Error(`Runtime input must not be a symlink: ${filePath}`);
  if (!stats.isFile()) throw new Error(`Runtime input must be a regular file: ${filePath}`);
  return filePath;
}

async function collectTreeFiles(rootDir, treeName) {
  const treeRoot = join(rootDir, treeName);
  validateRealDirectory(treeRoot, `Runtime ${treeName} directory`);

  const collected = [];
  async function walk(directory) {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Runtime input must not be a symlink: ${absolutePath}`);
      }
      if (stats.isDirectory()) {
        await walk(absolutePath);
      } else {
        validateRuntimeInput(absolutePath);
        collected.push(absolutePath);
      }
    }
  }
  await walk(treeRoot);
  return collected;
}

function runtimeRelativePath(rootDir, absolutePath) {
  return relative(rootDir, absolutePath).split(sep).join('/');
}

export async function buildRuntimeAssets({rootDir = process.cwd(), outputDir} = {}) {
  const root = normalizedPath(rootDir);
  const output = assertSafeOutputDirectory({
    rootDir: root,
    outputDir: outputDir === undefined ? join(root, 'dist') : outputDir,
  });
  const canonicalDist = join(root, 'dist');

  validateRealDirectory(join(root, 'data'), 'Runtime data directory');

  const allowlistedFiles = [
    ...RUNTIME_ROOT_FILES.map((path) => join(root, path)),
    ...RUNTIME_DATA_FILES.map((path) => join(root, 'data', path)),
  ];
  for (const filePath of allowlistedFiles) validateRuntimeInput(filePath);

  const treeFiles = [
    ...await collectTreeFiles(root, 'icons'),
    ...await collectTreeFiles(root, 'src'),
  ];
  const inputFiles = [...allowlistedFiles, ...treeFiles]
    .sort((left, right) => comparePaths(runtimeRelativePath(root, left), runtimeRelativePath(root, right)));
  const inputSnapshots = [];
  for (const sourcePath of inputFiles) {
    const path = runtimeRelativePath(root, sourcePath);
    const bytes = await readFile(sourcePath);
    inputSnapshots.push({path, bytes});
  }

  if (output === canonicalDist) {
    await rm(output, {recursive: true, force: true});
    await mkdir(output, {recursive: true});
  }

  const files = [];
  for (const {path, bytes} of inputSnapshots) {
    const destinationPath = join(output, ...path.split('/'));
    await mkdir(dirname(destinationPath), {recursive: true});
    await writeFile(destinationPath, bytes);
    files.push({
      path,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  const manifest = {files};
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, 'asset-manifest.json'), manifestBytes);
  return manifest;
}

async function main() {
  const rootDir = process.cwd();
  const outputDir = join(rootDir, 'dist');
  await buildRuntimeAssets({rootDir, outputDir});
  const manifestBytes = await readFile(join(outputDir, 'asset-manifest.json'));
  const digest = createHash('sha256').update(manifestBytes).digest('hex');
  process.stdout.write(`runtime-assets manifest-sha256=${digest}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
