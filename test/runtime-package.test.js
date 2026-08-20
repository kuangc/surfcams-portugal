import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {mkdtemp, mkdir, readFile, readdir, rename, symlink, writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {promisify} from 'node:util';
import {join, relative, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {
  RUNTIME_DATA_FILES,
  RUNTIME_ROOT_FILES,
  assertSafeOutputDirectory,
  buildRuntimeAssets,
  validateRuntimeInput,
} from '../scripts/build-runtime-assets.js';

const execFileAsync = promisify(execFile);
const builderPath = fileURLToPath(new URL('../scripts/build-runtime-assets.js', import.meta.url));
const canonicalTempDir = realpathSync(tmpdir());

const EXPECTED_ROOT_FILES = [
  'apple-touch-icon.png',
  'index.html',
  'manifest.webmanifest',
];

const EXPECTED_DATA_FILES = [
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
];

async function makeFixture() {
  const rootDir = await mkdtemp(join(canonicalTempDir, 'runtime-package-fixture-'));
  await Promise.all([
    mkdir(join(rootDir, 'data')),
    mkdir(join(rootDir, 'icons')),
    mkdir(join(rootDir, 'src', 'styles'), {recursive: true}),
    mkdir(join(rootDir, '.git')),
    mkdir(join(rootDir, 'docs')),
    mkdir(join(rootDir, 'scripts')),
    mkdir(join(rootDir, 'test')),
  ]);

  await Promise.all(EXPECTED_ROOT_FILES.map((path) =>
    writeFile(join(rootDir, path), `root:${path}\n`)));
  await Promise.all(EXPECTED_DATA_FILES.map((path) =>
    writeFile(join(rootDir, 'data', path), JSON.stringify({path}) + '\n')));
  await Promise.all([
    writeFile(join(rootDir, 'icons', 'icon-192.png'), Buffer.from([0, 1, 2, 255])),
    writeFile(join(rootDir, 'src', 'main.js'), 'export const cameraProvider = "MEO";\n'),
    writeFile(join(rootDir, 'src', 'styles', 'app.css'), 'body { color: navy; }\n'),
    writeFile(join(rootDir, '.git', 'leak.txt'), 'hls.cdn-surfline.com\n'),
    writeFile(join(rootDir, 'docs', 'leak.txt'), 'camstills.cdn-surfline.com\n'),
    writeFile(join(rootDir, 'scripts', 'leak.js'), '__rawSurflineFeeds\n'),
    writeFile(join(rootDir, 'test', 'leak.test.js'), 'hls.cdn-surfline.com\n'),
    writeFile(join(rootDir, '.dev.vars'), 'SECRET=camstills.cdn-surfline.com\n'),
  ]);
  return rootDir;
}

async function outputFiles(outputDir) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else files.push(relative(outputDir, absolutePath).split('\\').join('/'));
    }
  }
  await walk(outputDir);
  return files;
}

test('exports the exact runtime root and data allowlists', () => {
  assert.deepEqual(RUNTIME_ROOT_FILES, EXPECTED_ROOT_FILES);
  assert.deepEqual(RUNTIME_DATA_FILES, EXPECTED_DATA_FILES);
});

test('two fresh builds return identical metadata-only manifests', async () => {
  const rootDir = await makeFixture();
  const outputDirA = await mkdtemp(join(canonicalTempDir, 'runtime-package-output-a-'));
  const outputDirB = await mkdtemp(join(canonicalTempDir, 'runtime-package-output-b-'));

  const manifestA = await buildRuntimeAssets({rootDir, outputDir: outputDirA});
  const manifestB = await buildRuntimeAssets({rootDir, outputDir: outputDirB});

  assert.deepEqual(manifestA, manifestB);
  assert.deepEqual(Object.keys(manifestA), ['files']);
  assert.equal(JSON.stringify(manifestA).includes('generatedAt'), false);
  assert.equal(JSON.stringify(manifestA).includes('gitSha'), false);
  assert.deepEqual(manifestA.files.map(({path}) => path), [...manifestA.files.map(({path}) => path)].sort());
});

test('runtime package contains only approved files and no Surfline camera media text', async () => {
  const rootDir = await makeFixture();
  const outputDir = await mkdtemp(join(canonicalTempDir, 'runtime-package-output-'));

  const manifest = await buildRuntimeAssets({rootDir, outputDir});
  const files = await outputFiles(outputDir);
  const expectedPaths = [
    ...EXPECTED_ROOT_FILES,
    ...EXPECTED_DATA_FILES.map((path) => `data/${path}`),
    'icons/icon-192.png',
    'src/main.js',
    'src/styles/app.css',
  ].sort();

  assert.deepEqual(files, [...expectedPaths, 'asset-manifest.json'].sort());
  assert.deepEqual(manifest.files.map(({path}) => path), expectedPaths);
  assert.equal(files.some((path) => /(^|\/)(\.git|docs|scripts|test)(\/|$)/.test(path)), false);
  assert.equal(files.includes('.dev.vars'), false);

  for (const path of files) {
    const bytes = await readFile(join(outputDir, path));
    assert.doesNotMatch(bytes.toString('utf8'), /hls\.cdn-surfline\.com|camstills\.cdn-surfline\.com|__rawSurflineFeeds/);
  }
  for (const entry of manifest.files) {
    const bytes = await readFile(join(outputDir, entry.path));
    assert.deepEqual(Object.keys(entry), ['path', 'bytes', 'sha256']);
    assert.equal(entry.bytes, bytes.byteLength);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
});

test('output guard rejects destructive targets and allows only canonical repo dist internally', async () => {
  const rootDir = await makeFixture();
  const ancestor = resolve(rootDir, '..');
  const unsafeTargets = [
    rootDir,
    ancestor,
    resolve(rootDir, '/'),
    join(rootDir, 'src'),
    join(rootDir, 'src', 'nested'),
    join(rootDir, 'data'),
    join(rootDir, 'data', 'nested'),
    join(rootDir, 'icons'),
    join(rootDir, 'icons', 'nested'),
    join(rootDir, 'test'),
    join(rootDir, 'scripts'),
    join(rootDir, 'docs'),
    join(rootDir, '.git'),
    join(rootDir, 'arbitrary-output'),
  ];

  for (const outputDir of unsafeTargets) {
    assert.throws(() => assertSafeOutputDirectory({rootDir, outputDir}), {name: 'Error'});
  }

  assert.doesNotThrow(() => assertSafeOutputDirectory({rootDir, outputDir: join(rootDir, 'dist')}));

  const externalTarget = await mkdtemp(join(canonicalTempDir, 'runtime-package-symlink-target-'));
  const linkedOutput = join(rootDir, 'dist');
  await symlink(externalTarget, linkedOutput, 'dir');
  assert.throws(() => assertSafeOutputDirectory({rootDir, outputDir: linkedOutput}), /symlink/i);

  const emptyInternalDirectory = join(rootDir, 'src', 'nested-output');
  await mkdir(emptyInternalDirectory);
  const externalAliasParent = await mkdtemp(join(canonicalTempDir, 'runtime-package-alias-parent-'));
  const externalAlias = join(externalAliasParent, 'repo-src-alias');
  await symlink(join(rootDir, 'src'), externalAlias, 'dir');
  assert.throws(
    () => assertSafeOutputDirectory({rootDir, outputDir: join(externalAlias, 'nested-output')}),
    /inside repository|symlink/i,
  );
});

test('output guard rejects an external directory beneath a symlinked parent', async () => {
  const rootDir = await makeFixture();
  const realOutputParent = await mkdtemp(join(canonicalTempDir, 'runtime-real-output-parent-'));
  const realOutput = join(realOutputParent, 'empty-output');
  await mkdir(realOutput);
  const aliasContainer = await mkdtemp(join(canonicalTempDir, 'runtime-output-alias-container-'));
  const aliasParent = join(aliasContainer, 'output-parent-alias');
  await symlink(realOutputParent, aliasParent, 'dir');

  assert.throws(
    () => assertSafeOutputDirectory({rootDir, outputDir: join(aliasParent, 'empty-output')}),
    /symlink|canonical|real/i,
  );
});

test('symlinked root default dist is rejected without removing its sentinel', async () => {
  const realRoot = await makeFixture();
  const realDist = join(realRoot, 'dist');
  const sentinelPath = join(realDist, 'sentinel.txt');
  await mkdir(realDist);
  await writeFile(sentinelPath, 'preserve symlinked-root sentinel\n');
  const aliasContainer = await mkdtemp(join(canonicalTempDir, 'runtime-root-alias-container-'));
  const aliasRoot = join(aliasContainer, 'root-alias');
  await symlink(realRoot, aliasRoot, 'dir');

  await assert.rejects(buildRuntimeAssets({rootDir: aliasRoot}), /root|symlink|canonical|real/i);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve symlinked-root sentinel\n');
});

test('symlinked data directory cannot package external allowlisted bytes', async () => {
  const rootDir = await makeFixture();
  const externalParent = await mkdtemp(join(canonicalTempDir, 'runtime-external-data-parent-'));
  const externalData = join(externalParent, 'data');
  await rename(join(rootDir, 'data'), externalData);
  await writeFile(
    join(externalData, EXPECTED_DATA_FILES[0]),
    '{"external":"must not be packaged"}\n',
  );
  await symlink(externalData, join(rootDir, 'data'), 'dir');
  const outputDir = await mkdtemp(join(canonicalTempDir, 'runtime-data-symlink-output-'));

  await assert.rejects(buildRuntimeAssets({rootDir, outputDir}), /data|symlink|canonical|real/i);
  assert.deepEqual(await readdir(outputDir), []);
});

test('input validator accepts a regular file and rejects a symlink', async () => {
  const fixtureDir = await mkdtemp(join(canonicalTempDir, 'runtime-input-'));
  const regularFile = join(fixtureDir, 'regular.txt');
  const linkedFile = join(fixtureDir, 'linked.txt');
  await writeFile(regularFile, 'safe\n');
  await symlink(regularFile, linkedFile);

  assert.doesNotThrow(() => validateRuntimeInput(regularFile));
  assert.throws(() => validateRuntimeInput(linkedFile), /symlink|regular file/i);
});

test('canonical dist is preserved when deep input validation fails', async () => {
  const rootDir = await makeFixture();
  const outputDir = join(rootDir, 'dist');
  const sentinelPath = join(outputDir, 'sentinel.txt');
  const symlinkTarget = join(rootDir, 'outside-runtime-input.txt');
  await mkdir(outputDir);
  await writeFile(sentinelPath, 'preserve me\n');
  await writeFile(symlinkTarget, 'unsafe through symlink\n');
  await symlink(symlinkTarget, join(rootDir, 'src', 'zz-unsafe-link.js'));

  await assert.rejects(buildRuntimeAssets({rootDir, outputDir}), /symlink/i);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve me\n');
});

test('builder snapshots each validated input once before removal and writes snapshot bytes', async () => {
  const builderSource = await readFile(builderPath, 'utf8');
  const sourceReads = builderSource.match(/readFile\(sourcePath\)/g) ?? [];
  const snapshotReadIndex = builderSource.indexOf('await readFile(sourcePath)');
  const canonicalRemovalIndex = builderSource.indexOf('await rm(output');
  const snapshotWriteIndex = builderSource.indexOf('await writeFile(destinationPath, bytes)');

  assert.doesNotMatch(builderSource, /\bcopyFile\b/);
  assert.equal(sourceReads.length, 1);
  assert.notEqual(snapshotReadIndex, -1);
  assert.notEqual(canonicalRemovalIndex, -1);
  assert.ok(snapshotReadIndex < canonicalRemovalIndex);
  assert.ok(snapshotWriteIndex > canonicalRemovalIndex);
});

test('CLI prints exactly the deterministic manifest digest', async () => {
  const rootDir = await makeFixture();
  const {stdout, stderr} = await execFileAsync(process.execPath, [builderPath], {cwd: rootDir});
  const manifestBytes = await readFile(join(rootDir, 'dist', 'asset-manifest.json'));
  const expectedDigest = createHash('sha256').update(manifestBytes).digest('hex');

  assert.equal(stderr, '');
  assert.equal(stdout, `runtime-assets manifest-sha256=${expectedDigest}\n`);
  assert.match(expectedDigest, /^[0-9a-f]{64}$/);
});

test('the public Worker test command builds ignored assets first', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.match(packageJson.scripts['test:worker'], /^npm run build && /);
});

test('the Worker dry-run uses only the committed non-production secrets fixture', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.equal(
    packageJson.scripts['check:worker'],
    'wrangler deploy --dry-run --config wrangler.jsonc --secrets-file test/fixtures/wrangler-dry-run-secrets.env --outdir .wrangler/dry-run'
  );
  const fixture = fs.readFileSync(
    new URL('./fixtures/wrangler-dry-run-secrets.env', import.meta.url),
    'utf8'
  );
  assert.equal(
    fixture,
    'ACCESS_TEAM_DOMAIN=https://family.cloudflareaccess.com\nACCESS_AUD=surfcams-local-dry-run-only\n'
  );
});

test('the Worker declares one global SQLite Durable Object without previews or migrations', () => {
  const config = JSON.parse(
    fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  );
  assert.equal(config.name, 'surfcams-portugal');
  assert.equal(config.main, 'worker/index.js');
  assert.equal(config.compatibility_date, '2026-08-19');
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets, {
    directory: './dist',
    binding: 'ASSETS',
    run_worker_first: ['/api', '/api/*'],
  });
  assert.deepEqual(config.durable_objects, {
    bindings: [{
      name: 'MEO_TOKEN_COORDINATOR',
      class_name: 'MeoTokenCoordinator',
    }],
  });
  assert.deepEqual(config.exports, {
    MeoTokenCoordinator: {
      type: 'durable-object',
      storage: 'sqlite',
    },
  });
  assert.deepEqual(config.secrets, {
    required: ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'],
  });
  assert.equal('migrations' in config, false);
  assert.equal('env' in config, false);
  assert.equal('vars' in config, false);
});
