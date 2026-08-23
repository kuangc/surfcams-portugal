import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const canonicalTempDir = realpathSync(tmpdir());
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

async function makeSitesVerifierFixture(path, contents) {
  const distDir = await mkdtemp(join(canonicalTempDir, 'sites-verifier-fixture-'));
  await Promise.all([
    mkdir(join(distDir, '.openai'), {recursive: true}),
    mkdir(join(distDir, 'server'), {recursive: true}),
    mkdir(dirname(join(distDir, path)), {recursive: true}),
  ]);
  await Promise.all([
    writeFile(join(distDir, '.openai', 'hosting.json'), '{"d1":"DB","r2":null}\n'),
    writeFile(join(distDir, 'server', 'index.js'), 'export default {fetch() { return new Response("ok"); }};\n'),
    writeFile(join(distDir, 'index.html'), '<!doctype html><title>fixture</title>\n'),
    writeFile(join(distDir, 'manifest.webmanifest'), '{}\n'),
    writeFile(join(distDir, path), contents),
  ]);
  const {buildSitesManifest} = await import('../scripts/build-sites-manifest.js');
  await buildSitesManifest({distDir});
  return distDir;
}

async function assertSitesPackageRejects(path, contents, expected) {
  const distDir = await makeSitesVerifierFixture(path, contents);
  const {verifySitesPackage} = await import('../scripts/verify-sites-package.js');
  await assert.rejects(
    verifySitesPackage({rootDir: repositoryRoot, distDir}),
    expected
  );
}

async function assertSitesPackageAccepts(path, contents) {
  const distDir = await makeSitesVerifierFixture(path, contents);
  const {verifySitesPackage} = await import('../scripts/verify-sites-package.js');
  await verifySitesPackage({rootDir: repositoryRoot, distDir});
}

test('the AST query scan visits one maximal nested builder only once', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const depth = 500;
  let unsafeSource = '"?wmsAuthSign=abc"';
  let runtimeSource = 'token';
  for (let index = 0; index < depth; index += 1) {
    unsafeSource = `wrap(${unsafeSource})`;
    runtimeSource = `wrap(${runtimeSource})`;
  }

  const unsafeDiagnostics = {};
  assert.notEqual(find(unsafeSource, {diagnostics: unsafeDiagnostics}), null);
  assert.equal(unsafeDiagnostics.queryCompositionRoots, 1);
  assert.ok(unsafeDiagnostics.staticFragmentNodes <= depth * 3 + 10);

  const runtimeDiagnostics = {};
  assert.equal(find(runtimeSource, {diagnostics: runtimeDiagnostics}), null);
  assert.equal(runtimeDiagnostics.queryCompositionRoots, 1);
  assert.ok(runtimeDiagnostics.staticFragmentNodes <= depth * 3 + 10);
});

test('credential reference summaries stay linear with member depth', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const depth = 18;
  const reference = `env${'.member'.repeat(depth)}`;
  const diagnostics = {};
  assert.notEqual(
    find(`GOOGLE_CLIENT_ID=(${reference}="hardcoded",${reference})`, {diagnostics}),
    null
  );
  assert.ok(diagnostics.credentialReferenceNodes <= depth * 8);
  assert.ok(diagnostics.credentialReferenceMaxBytes <= depth * 32);
});

test('the bundle credential scan distinguishes literals from identifier references', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  assert.equal(typeof verifier.findBundledRuntimeLiteral, 'function');

  for (const text of [
    'GOOGLE_CLIENT_ID="123-example.apps.googleusercontent.com"',
    'GOOGLE_CLIENT_ID=123-example.apps.googleusercontent.com',
    'GOOGLE_CLIENT_ID=literal-client-id',
    'GOOGLE_CLIENT_ID=abc/def',
    '({GOOGLE_CLIENT_ID:"123-object.apps.googleusercontent.com"})',
    '{"GOOGLE_CLIENT_ID":"123-json.apps.googleusercontent.com"}',
    'BOOTSTRAP_OWNER_EMAIL=owner@example.com',
    'BOOTSTRAP_OWNER_EMAIL=owner-example',
    '({BOOTSTRAP_OWNER_EMAIL:"owner@example.com"})',
    "({'BOOTSTRAP_OWNER_EMAIL':'owner@example.com'})",
    'wmsAuthSign=literal-token-value',
    'wmsAuthSign=abc+def',
    'wmsAuthSign=abc/def',
    '{"wmsAuthSign":"literal-token-value"}',
    '({SITES_SOURCE_CREDENTIAL: "sites-source-literal"})',
    'OPENAI_SITES_SOURCE_TOKEN=literal-token-value',
    'OPENAI_SITES_SOURCE_TOKEN=abc+def',
    '{"OPENAI_SITES_SOURCE_TOKEN":"sites-source-literal"}',
  ]) {
    assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
  }
  for (const text of [
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID',
    'BOOTSTRAP_OWNER_EMAIL=config.bootstrapOwnerEmail',
    'wmsAuthSign=token',
    'SITES_SOURCE_CREDENTIAL=sourceCredential',
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID||/* runtime */config.googleClientId',
    'GOOGLE_CLIENT_ID=env.\n GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_ID+="suffix"',
  ]) {
    assert.equal(verifier.findBundledRuntimeLiteral(text), null);
  }
});

test('the bundle credential scan follows AST targets but ignores inert source text', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'const GOOGLE_CLIENT_ID="hardcoded"',
    'function f({BOOTSTRAP_OWNER_EMAIL="owner@example.com"}) {}',
    'const config={SITES_SOURCE_TOKEN:"hardcoded"}',
    'config["OPENAI_"+"SITES_SOURCE_TOKEN"]="hardcoded"',
    'class Config {static GOOGLE_CLIENT_ID="hardcoded"}',
    'class Config {["OPENAI_SITES_SOURCE_TOKEN"]="hardcoded"}',
  ]) {
    assert.notEqual(find(text), null);
  }
  for (const text of [
    'const note="GOOGLE_CLIENT_ID=hardcoded"',
    '// OPENAI_SITES_SOURCE_TOKEN="hardcoded"',
    'GOOGLE_CLIENT_ID: "ordinary label body"',
    'const pattern=/wmsAuthSign=hardcoded/',
    '// https://example.test/x?wmsAuthSign=abc123',
    'const pattern=/https:\\/\\/example\\.test\\/x\\?wmsAuthSign=abc123/',
  ]) {
    assert.equal(find(text), null);
  }
});

test('the bundle credential scan conservatively checks parse-failure text', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  assert.notEqual(find('{"GOOGLE_CLIENT_ID":"hardcoded"}'), null);
  assert.notEqual(find('BOOTSTRAP_OWNER_EMAIL=owner@example.com'), null);
  assert.equal(find('{"GOOGLE_CLIENT_ID":env.GOOGLE_CLIENT_ID}'), null);
  assert.equal(find('{"GOOGLE_CLIENT_ID":env["GOOGLE_CLIENT_ID"]}'), null);
  assert.equal(find('{"GOOGLE_CLIENT_ID":env?.GOOGLE_CLIENT_ID}'), null);
});

test('the public package verifier strictly scans decoded JSON keys and values', async (t) => {
  for (const [name, contents] of [
    ['comma-bearing literal', '{"nested":{"GOOGLE_CLIENT_ID":"hard,coded"}}'],
    ['long literal', JSON.stringify({GOOGLE_CLIENT_ID: 'a'.repeat(1024)})],
    ['Unicode-escaped key', '{"GOOGLE_\\u0043LIENT_ID":"hardcoded"}'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `data/${name.replaceAll(' ', '-')}.json`,
      contents,
      /Bundled Google client ID literal/
    ));
  }
});

test('the public package verifier scans decoded JSON keys for signed query text', async (t) => {
  for (const [name, contents] of [
    ['literal key', '{"?wmsAuthSign=abc":"x"}'],
    ['escaped key', '{"?wmsAuth\\u0053ign=abc":"x"}'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `data/signed-${name.replaceAll(' ', '-')}.json`,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('duplicate JSON keys cannot hide an earlier protected literal', async (t) => {
  for (const [name, contents] of [
    ['credential', '{"GOOGLE_CLIENT_ID":"hardcoded","GOOGLE_CLIENT_ID":""}'],
    ['signed query', '{"x":"?wmsAuthSign=abc","x":""}'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `data/duplicate-${name.replaceAll(' ', '-')}.json`,
      contents,
      /Bundled duplicate JSON key literal/
    ));
  }
});

test('the public package verifier scans source-map sources as executable source', async () => {
  await assertSitesPackageRejects(
    'server/index.js.map',
    JSON.stringify({
      version: 3,
      sources: ['credential-source.js'],
      sourcesContent: ['GOOGLE_CLIENT_ID="hardcoded"'],
    }),
    /Bundled Google client ID literal/
  );
});

test('source-map metadata cannot weaken executable sourcesContent scanning', async () => {
  await assertSitesPackageRejects(
    'server/index.js.map',
    JSON.stringify({
      version: 3,
      sources: ['attacker-labelled.html'],
      sourcesContent: ['const u="?wmsAuth"+"Sign=abc"'],
    }),
    /Bundled signed MEO token literal/
  );
});

test('source-map source payloads are typed exactly once', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const sourceMap = (source) => JSON.stringify({
    version: 3,
    sources: ['source.js'],
    names: [],
    mappings: '',
    sourcesContent: [source],
  });
  for (const source of [
    'const url="?wmsAuthSign="+token',
    'const url=`?wmsAuthSign=${token}`',
  ]) {
    await t.test(`runtime ${source}`, () => assert.equal(
      find(sourceMap(source), {path: 'server/index.js.map'}),
      null
    ));
  }
  for (const source of [
    'const url="?wmsAuthSign=abc"',
    'const url=`?wmsAuthSign=${"abc"}`',
  ]) {
    await t.test(`literal ${source}`, () => assert.notEqual(
      find(sourceMap(source), {path: 'server/index.js.map'}),
      null
    ));
  }
});

test('indexed source maps recursively scan child sourcesContent', async () => {
  await assertSitesPackageRejects(
    'server/index.js.map',
    JSON.stringify({
      version: 3,
      sections: [{
        offset: {line: 0, column: 0},
        map: {
          version: 3,
          sources: ['child.js'],
          names: [],
          mappings: '',
          sourcesContent: ['const u="?wmsAuth"+"Sign=abc"'],
        },
      }],
    }),
    /Bundled signed MEO token literal/
  );
});

test('the public package verifier rejects inline data source maps', async (t) => {
  const sourceMap = Buffer.from(JSON.stringify({
    version: 3,
    sources: ['inline.js'],
    names: [],
    mappings: '',
    sourcesContent: ['const u="?wmsAuth"+"Sign=abc"'],
  })).toString('base64');
  for (const [name, path, contents] of [
    [
      'line-start JavaScript comment',
      'server/inline-map.js',
      `export default {};\n//# sourceMappingURL=data:application/json;base64,${sourceMap}\n`
    ],
    [
      'same-line JavaScript comment',
      'server/same-line-map.js',
      `export default {};//# sourceMappingURL=data:application/json;base64,${sourceMap}\n`
    ],
    [
      'CSS block comment',
      'assets/inline-map.css',
      `body{}/*# sourceMappingURL=data:application/json;base64,${sourceMap} */\n`
    ],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      path,
      contents,
      /Bundled inline source map literal/
    ));
  }
});

test('inline source-map text inside JavaScript literals remains inert', async (t) => {
  for (const [name, contents] of [
    ['string', 'const s="/*# sourceMappingURL=data:ordinary";'],
    ['template', 'const s=`example\n//# sourceMappingURL=data:ordinary`;'],
  ]) {
    await t.test(name, () => assertSitesPackageAccepts(
      `server/source-map-${name}.js`,
      contents
    ));
  }
});

test('the public package verifier rejects ambiguous protected parse failures', async (t) => {
  for (const [name, contents] of [
    ['unterminated literal', 'GOOGLE_CLIENT_ID="unterminated'],
    ['truncated long literal', `GOOGLE_CLIENT_ID="${'a'.repeat(1024)}`],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `server/${name.replaceAll(' ', '-')}.js`,
      contents,
      /Bundled Google client ID literal/
    ));
  }
});

test('the public package verifier decodes HTML query separators', async (t) => {
  for (const [name, contents] of [
    ['decimal equals', '<a href="?wmsAuthSign&#61;abc123">camera</a>'],
    ['hex equals', '<a href="?wmsAuthSign&#x3d;abc123">camera</a>'],
    ['named equals', '<a href="?wmsAuthSign&equals;abc123">camera</a>'],
    ['marker character', '<a href="?wmsAuth&#83;ign=abc123">camera</a>'],
    ['named ampersand', '<a href="?x=1&amp;wmsAuthSign=abc123">camera</a>'],
    ['numeric ampersand', '<a href="?x=1&#38;wmsAuthSign=abc123">camera</a>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `html-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('the public package verifier parses JSON script blocks by declared type', async () => {
  await assertSitesPackageAccepts(
    'safe-json-script.html',
    '<script type="application/json">{"camera":"MEO","region":"Lisbon"}</script>'
  );
});

test('executable HTML-family extensions receive structured scanning', async (t) => {
  for (const extension of ['shtm', 'shtml']) {
    await t.test(extension, () => assertSitesPackageRejects(
      `document.${extension}`,
      '<script>const u="?wmsAuth"+"Sign=abc"</script>',
      /Bundled signed MEO token literal/
    ));
  }
  for (const extension of ['xht', 'xhtm']) {
    await t.test(extension, () => assertSitesPackageRejects(
      `document.${extension}`,
      '<script>const u="?wmsAuth"+"Sign=abc"</script>',
      /Bundled unsupported XML literal/
    ));
  }
});

test('XHTML is rejected as standalone executable XML', async (t) => {
  await t.test('nested executable script', () => assertSitesPackageRejects(
    'document.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title><script>const u="?wmsAuth"+"Sign=abc"</script></title></head></html>',
    /Bundled unsupported XML literal/
  ));
  await t.test('benign document follows the same fail-closed policy', () => assertSitesPackageRejects(
    'benign.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>safe</title></head></html>',
    /Bundled unsupported XML literal/
  ));
});

test('the public package verifier handles HTML script types and quoted tag delimiters', async (t) => {
  for (const [name, contents] of [
    [
      'JSON MIME parameters',
      '<script type="application/json; charset=utf-8">{"camera":"MEO"}</script>'
    ],
    ['import map', '<script type="importmap">{"imports":{}}</script>'],
    ['plain data', '<script type="text/plain">camera=MEO</script>'],
    [
      'quoted greater-than',
      '<script type="application/json" data-x=">">{"camera":"MEO"}</script>'
    ],
    [
      'type text inside another attribute',
      '<script data-x=" type=application/json">const camera="MEO";</script>'
    ],
  ]) {
    await t.test(name, () => assertSitesPackageAccepts(
      `safe-${name.replaceAll(' ', '-')}.html`,
      contents
    ));
  }
});

test('the public package verifier parses every executable legacy JavaScript MIME type', async (t) => {
  for (const [name, openTag] of [
    ['text/javascript1.5', '<script type="text/javascript1.5">'],
    ['text/jscript', '<script type="text/jscript">'],
    ['text/livescript', '<script type="text/livescript">'],
    ['text/x-ecmascript', '<script type="text/x-ecmascript">'],
    ['application/x-ecmascript', '<script type="application/x-ecmascript">'],
    ['fake plain type attribute', '<script data-x=" type=text/plain">'],
    ['fake binary type attribute', '<script data-x=" type=application/octet-stream">'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `legacy-${name.replaceAll(' ', '-') .replace('/', '-')}.html`,
      `${openTag}const u="?wmsAuth"+"Sign=abc"</script>`,
      /Bundled signed MEO token literal/
    ));
  }
});

test('non-HTML whitespace cannot create an inert script type attribute', async (t) => {
  for (const [name, separator] of [
    ['nonbreaking space', '\u00a0'],
    ['vertical tab', '\u000b'],
    ['em space', '\u2003'],
    ['byte-order mark', '\ufeff'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `script-attribute-${name.replaceAll(' ', '-')}.html`,
      `<script data-x${separator}type=text/plain>const u="?wmsAuth"+"Sign=abc"</script>`,
      /Bundled signed MEO token literal/
    ));
  }
});

test('non-HTML whitespace cannot terminate an executable script block', async () => {
  await assertSitesPackageRejects(
    'script-close-boundary.html',
    '<script>// </script\u00a0fake>\nconst u="?wmsAuth"+"Sign=abc";</script>',
    /Bundled signed MEO token literal/
  );
});

test('HTML text that looks like a script tag cannot hide a later executable script', async (t) => {
  for (const [name, contents] of [
    [
      'comment',
      '<!-- <script type="text/plain"> --><script>const u="?wmsAuth"+"Sign=abc"</script><!-- </script> -->'
    ],
    [
      'quoted attribute',
      '<div data-x="<script type=\'text/plain\'>"><script>const u="?wmsAuth"+"Sign=abc"</script></div>'
    ],
    [
      'RCDATA element',
      '<textarea><script type="text/plain"></textarea><script>const u="?wmsAuth"+"Sign=abc"</script>'
    ],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `script-context-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('the public package verifier scans executable HTML attribute contexts', async (t) => {
  for (const [name, contents] of [
    ['event handler', '<button onclick="const u=\'?wmsAuth\'+\'Sign=abc\'">go</button>'],
    ['JavaScript URL', '<a href="javascript:fetch(\'?wmsAuth\'+\'Sign=abc\')">go</a>'],
    ['srcdoc', '<iframe srcdoc="<script>const u=\'?wmsAuth\'+\'Sign=abc\'</script>"></iframe>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `executable-attribute-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('structured executable HTML attributes preserve direct runtime references', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '<button onclick="GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID">go</button>',
    '<a href="javascript:GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID">go</a>',
    '<iframe srcdoc="<script>GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID</script>"></iframe>',
    '<button onclick="const u=`?wmsAuthSign=${token}`">go</button>',
  ]) {
    await t.test(text, () => assert.equal(find(text, { path: 'x.html' }), null));
  }
  for (const text of [
    '<button onclick="GOOGLE_CLIENT_ID=\'hardcoded\'">go</button>',
    '<a href="javascript:GOOGLE_CLIENT_ID=\'hardcoded\'">go</a>',
    '<iframe srcdoc="<script>GOOGLE_CLIENT_ID=\'hardcoded\'</script>"></iframe>',
    '<button onclick="const u=\'?wmsAuthSign=abc\'">go</button>',
  ]) {
    await t.test(text, () => assert.notEqual(find(text, { path: 'x.html' }), null));
  }
});

test('executable HTML attributes use browser-equivalent entity and URL decoding', async (t) => {
  for (const [name, contents] of [
    ['named plus', '<button onclick="const u=\'?wmsAuth\'&plus;\'Sign=abc\'">go</button>'],
    ['named JavaScript URL', '<a href="javascript&colon;const u=\'?wmsAuth\'&plus;\'Sign=abc\'">go</a>'],
    ['encoded srcdoc', '<iframe srcdoc="&lt;script&gt;const u=\'?wmsAuth\'&plus;\'Sign=abc\'&lt;/script&gt;"></iframe>'],
    ['numeric tab in scheme', '<a href="java&#9;script:const u=\'?wmsAuth\'&#43;\'Sign=abc\'">go</a>'],
    ['numeric line-feed in scheme', '<a href="java&#10;script:const u=\'?wmsAuth\'&#43;\'Sign=abc\'">go</a>'],
    ['numeric carriage-return in scheme', '<a href="java&#13;script:const u=\'?wmsAuth\'&#43;\'Sign=abc\'">go</a>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `entity-attribute-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('the public package verifier rejects executable data URLs', async (t) => {
  const encodedJavaScript = "const u='?wmsAuth'%2B'Sign%3Dabc'";
  const base64JavaScript = Buffer.from("const u='?wmsAuth'+'Sign=abc'").toString('base64');
  for (const [name, contents] of [
    ['percent JavaScript', `<script src="data:text/javascript,${encodedJavaScript}"></script>`],
    ['base64 JavaScript', `<script src="data:text/javascript;base64,${base64JavaScript}"></script>`],
    ['HTML document', `<iframe src="data:text/html,%3Cscript%3E${encodedJavaScript}%3C/script%3E"></iframe>`],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `data-url-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled executable data URL literal/
    ));
  }
});

test('foreign-content elements cannot hide executable scripts', async (t) => {
  for (const [name, contents] of [
    ...['title', 'textarea', 'iframe'].map((tagName) => [
      tagName,
      `<svg><${tagName}><script>globalThis.hit=("?wmsAuth"+"Sign=abc")</script></${tagName}></svg>`,
    ]),
    [
      'nested title',
      '<svg><svg></svg><title><script>globalThis.hit=("?wmsAuth"+"Sign=abc")</script></title></svg>',
    ],
    [
      'nested textarea',
      '<svg><svg></svg><textarea><script>globalThis.hit=("?wmsAuth"+"Sign=abc")</script></textarea></svg>',
    ],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `foreign-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled (?:signed MEO token|invalid HTML) literal/
    ));
  }
});

test('standalone SVG is rejected as executable foreign content', async () => {
  await assertSitesPackageRejects(
    'icon.svg',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.u="?wmsAuth"+"Sign=abc"</script></svg>',
    /Bundled unsupported SVG literal/
  );
});

test('standalone XML and compressed SVG are rejected as executable foreign content', async (t) => {
  await t.test('XML', () => assertSitesPackageRejects(
    'document.xml',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.u="?wmsAuth"+"Sign=abc"</script></svg>',
    /Bundled unsupported XML literal/
  ));
  await t.test('compressed SVG', () => assertSitesPackageRejects(
    'icon.svgz',
    Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    /Bundled unsupported SVG literal/
  ));
});

test('inline style source maps cannot hide protected source content', async () => {
  const sourceMap = Buffer.from(JSON.stringify({
    version: 3,
    sources: ['source.js'],
    names: [],
    mappings: '',
    sourcesContent: ['GOOGLE_CLIENT_ID="hardcoded"'],
  })).toString('base64');
  await assertSitesPackageRejects(
    'inline-style-source-map.html',
    `<style>body{}/*# sourceMappingURL=data:application/json;base64,${sourceMap} */</style>`,
    /Bundled inline source map literal/
  );
});

test('embed data URLs are treated as executable HTML contexts', async () => {
  await assertSitesPackageRejects(
    'embed-data-url.html',
    '<embed src="data:text/html,<script>globalThis.hit=(%22?wmsAuth%22+%22Sign=abc%22)</script>">',
    /Bundled executable data URL literal/
  );
});

test('JavaScript URLs are percent-decoded before executable scanning', async () => {
  await assertSitesPackageRejects(
    'percent-javascript-url.html',
    '<a href="javascript:const u=\'%3FwmsAuthSign%3Dabc\'">go</a>',
    /Bundled signed MEO token literal/
  );
});

test('ambiguous HTML tokenizer constructs cannot swallow executable scripts', async (t) => {
  for (const [name, contents] of [
    ['space after less-than', '< script type="text/plain"><script>const u="?wmsAuth"+"Sign=abc"</script>'],
    ['abrupt empty comment', '<!--><script>const u="?wmsAuth"+"Sign=abc"</script>-->'],
    ['overlapping abrupt comment', '<!---><script>const u="?wmsAuth"+"Sign=abc"</script>-->'],
    ['bang-ended comment', '<!-- fake --!><script>const u="?wmsAuth"+"Sign=abc"</script>'],
    ['CDATA ambiguity', '<![CDATA[><script>const u="?wmsAuth"+"Sign=abc"</script>]]>'],
    ['custom tag punctuation', '<script.fake type="text/plain"><script>const u="?wmsAuth"+"Sign=abc"</script>'],
    ['double-escaped script data', '<script>\n<!--<script></script>\nconst u="?wmsAuth"+"Sign=abc";\n</script>'],
    ['bogus declaration quotes', '<!foo "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['processing-instruction quotes', '<?foo "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['non-doctype declaration', '<!NOTDOCTYPE "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['bogus doctype quotes', '<!DOCTYPE html "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['bogus named doctype', '<!DOCTYPE x "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['NUL tag name', '<script\0fake type=text/plain><script>const u="?wmsAuth"+"Sign=abc"</script>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `tokenizer-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled (?:signed MEO token|invalid HTML) literal/
    ));
  }
});

test('stray start-tag quotes cannot swallow executable scripts', async (t) => {
  for (const [name, contents] of [
    ['standalone quote', '<div "><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['attribute-name quote', '<div a"><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['single attribute-name quote', '<div a\'><script>const u="?wmsAuth"+"Sign=abc"</script>\'>'],
    ['unquoted-value quote', '<div a=x"><script>const u="?wmsAuth"+"Sign=abc"</script>">'],
    ['single unquoted-value quote', '<div a=x\'><script>const u="?wmsAuth"+"Sign=abc"</script>\'>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `stray-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled (?:signed MEO token|invalid HTML) literal/
    ));
  }
  await t.test('valid quoted attribute', () => assertSitesPackageAccepts(
    'valid-quoted-attribute.html',
    '<div title="><script>const u=\' ?wmsAuth\'+\'Sign=abc\'</script>">safe</div>'
  ));
  await t.test('valid single-quoted attribute', () => assertSitesPackageAccepts(
    'valid-single-quoted-attribute.html',
    '<div title=\'><script>const u="?wmsAuth"+"Sign=abc"</script>\'>safe</div>'
  ));
});

test('stray solidus recovery cannot hide executable attributes', async (t) => {
  for (const [name, contents] of [
    ['event handler', '<button x/onclick="const u=\'?wmsAuth\'+\'Sign=abc\'">go</button>'],
    ['JavaScript URL', '<a x/href="javascript:const u=\'?wmsAuth\'+\'Sign=abc\'">go</a>'],
    ['srcdoc', '<iframe x/srcdoc="<script>const u=\'?wmsAuth\'+\'Sign=abc\'</script>"></iframe>'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `solidus-${name.replaceAll(' ', '-')}.html`,
      contents,
      /Bundled (?:signed MEO token|invalid HTML) literal/
    ));
  }
  for (const [name, contents] of [
    ['compact', '<img/>'],
    ['spaced', '<img />'],
  ]) {
    await t.test(`valid ${name} self-close`, () => assertSitesPackageAccepts(
      `self-close-${name}.html`,
      contents
    ));
  }
});

test('the public package verifier fails closed on an unterminated script start tag', async () => {
  await assertSitesPackageRejects(
    'malformed-script.html',
    '<script type="module"',
    /Bundled invalid HTML literal/
  );
});

test('the public package verifier strips URL control characters before token checks', async (t) => {
  for (const [name, source] of [
    ['tab after equals', '?wmsAuthSign=\\tabc123'],
    ['line-feed after equals', '?wmsAuthSign=\\nabc123'],
    ['carriage-return after equals', '?wmsAuthSign=\\rabc123'],
    ['tab inside marker', '?wmsAuth\\tSign=abc123'],
    ['line-feed inside marker', '?wmsAuth\\nSign=abc123'],
    ['carriage-return inside marker', '?wmsAuth\\rSign=abc123'],
    ['space value', '?wmsAuthSign= abc123'],
    ['form-feed value', '?wmsAuthSign=\\fabc123'],
    ['vertical-tab value', '?wmsAuthSign=\\vabc123'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `server/url-${name.replaceAll(' ', '-')}.js`,
      `const url="${source}";`,
      /Bundled signed MEO token literal/
    ));
  }
});

test('the bundle credential scan rejects dynamic-looking query values in raw text', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '<a href="?wmsAuthSign=${token}">camera</a>',
    'https://x.test/y?wmsAuthSign=${token}',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  assert.equal(find('https://x.test/y?wmsAuthSign='), null);
});

test('the bundle credential scan keeps inline script query interpolation AST-aware', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  assert.equal(
    find('<script>const url=`?wmsAuthSign=${token}`</script>'),
    null
  );
});

test('the bundle credential scan inspects static-key setter arguments', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'searchParams.set("wmsAuthSign", "abc")',
    'config.set("GOOGLE_CLIENT_ID", condition ? env.ID : "hardcoded")',
    'config.append("OPENAI_SITES_SOURCE_TOKEN", "hardcoded")',
    'config.setAttribute("GOOGLE_CLIENT_ID", "hardcoded")',
    '(config?.set)("GOOGLE_CLIENT_ID", "hardcoded")',
    '(config?.setAttribute)("GOOGLE_CLIENT_ID", "hardcoded")',
    'Reflect.set(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    'Reflect.set(config, "wmsAuthSign", "abc")',
    'globalThis.Reflect.set(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    '(globalThis?.Reflect?.set)(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    '(globalThis?.Reflect).set(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    '(0,Reflect.set)(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    '(observe(),config.set)("GOOGLE_CLIENT_ID", "hardcoded")',
    'self.Reflect.set(config, "wmsAuthSign", "abc")',
    'Reflect.set("GOOGLE_CLIENT_ID", "hardcoded")',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'searchParams.set("wmsAuthSign", token)',
    'config.set("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    'config.setAttribute("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(config?.set)("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    'Reflect.set(config, "GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    'globalThis.Reflect.set(config, "GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(globalThis?.Reflect?.set)(config, "GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(globalThis?.Reflect).set(config, "GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(0,Reflect.set)(config, "GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(observe(),config.set)("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID)',
    '(observe(),config.get)("GOOGLE_CLIENT_ID", "hardcoded")',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('the bundle credential scan fails closed on complex protected values', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=getClientId()',
    'GOOGLE_CLIENT_ID=String("hardcoded")',
    'BOOTSTRAP_OWNER_EMAIL={value:owner}',
    'OPENAI_SITES_SOURCE_TOKEN=`${env.token}`',
    'GOOGLE_CLIENT_ID=condition?env.ID:getClientId()',
    'GOOGLE_CLIENT_ID=env.ID+other',
    'GOOGLE_CLIENT_ID=env.ID-other',
    'GOOGLE_CLIENT_ID=({value:"hardcoded"}).value',
    'GOOGLE_CLIENT_ID=["hardcoded"][0]',
    'GOOGLE_CLIENT_ID=({value:"hardcoded"})?.value',
    'GOOGLE_CLIENT_ID=getConfig().ID',
    'config.set("GOOGLE_CLIENT_ID",({value:"hardcoded"}).value)',
    'config.set("GOOGLE_CLIENT_ID",String("hardcoded"))',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
});

test('the bundle credential scan follows one-step sequence fallbacks', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=(token="hardcoded",token)',
    'config.set("GOOGLE_CLIENT_ID",(token||="hardcoded",token))',
    'config.set("OPENAI_SITES_SOURCE_TOKEN",(token??="hardcoded",token))',
    'GOOGLE_CLIENT_ID=(env[key]="hardcoded",env[key])',
    'config.set("GOOGLE_CLIENT_ID",(env[key]||="hardcoded",env[key]))',
    'GOOGLE_CLIENT_ID=(env[null]="hardcoded",env[null])',
    'GOOGLE_CLIENT_ID=(env[/key/]="hardcoded",env[/key/])',
    'function x(){GOOGLE_CLIENT_ID=(env[this]="hardcoded",env[this])}',
    'GOOGLE_CLIENT_ID=env[(env.ID="hardcoded","ID")]',
    'config.set("GOOGLE_CLIENT_ID",env[(env.ID="hardcoded","ID")])',
    'GOOGLE_CLIENT_ID=((token="hardcoded")?observe1():observe2(),token)',
    'GOOGLE_CLIENT_ID=(initialize(token="hardcoded"),token)',
    'GOOGLE_CLIENT_ID=(new Query(token="hardcoded"),token)',
    'GOOGLE_CLIENT_ID=([token="hardcoded"],token)',
    'GOOGLE_CLIENT_ID=({x:token="hardcoded"},token)',
    'GOOGLE_CLIENT_ID=(`value:${token="hardcoded"}`,token)',
    'GOOGLE_CLIENT_ID=((()=>{token="hardcoded"})(),token)',
    'GOOGLE_CLIENT_ID=((function(){token="hardcoded"})(),token)',
    'GOOGLE_CLIENT_ID=(class {static {token="hardcoded"}},token)',
    'GOOGLE_CLIENT_ID=(class extends (token="hardcoded",Base) {},token)',
    'GOOGLE_CLIENT_ID=(class {[token="hardcoded"](){}},token)',
    'GOOGLE_CLIENT_ID=(observe(),env.GOOGLE_CLIENT_ID)',
    'config.set("GOOGLE_CLIENT_ID",(observe(),env.GOOGLE_CLIENT_ID))',
    'GOOGLE_CLIENT_ID=(initialize(env.ID),token)',
    'GOOGLE_CLIENT_ID=(new Query(env.ID),token)',
    'GOOGLE_CLIENT_ID=(tag`runtime:${env.ID}`,token)',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'GOOGLE_CLIENT_ID=(token=env.GOOGLE_CLIENT_ID,token)',
    'GOOGLE_CLIENT_ID=(env[key]=config[key],env[key])',
    'GOOGLE_CLIENT_ID=(env[null]=config[null],env[null])',
    'function x(){GOOGLE_CLIENT_ID=(env[this]=config[this],env[this])}',
    'GOOGLE_CLIENT_ID=([env.ID],token)',
    'GOOGLE_CLIENT_ID=({x:env.ID},token)',
    'GOOGLE_CLIENT_ID=(()=>{token="hardcoded"},token)',
    'GOOGLE_CLIENT_ID=(function inert(){token="hardcoded"},token)',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('the signed query scan inspects computed keys inside opaque roots', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'fn(env["?wmsAuth"+"Sign=abc"])',
    'obj["?wmsAuth"+"Sign=abc"]()',
    'new Query(env["?wmsAuth"+"Sign=abc"])',
    'fn(env["?wmsAuth"+"Sign=abc"].value)',
    'fn(env["?wmsAuth"+"Sign=abc"]?.value)',
    'new Query(env["?wmsAuth"+"Sign=abc"].value)',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'fn(env[key])',
    'obj[method]()',
    'new Query(env[usePrimary ? "ID" : "FALLBACK_ID"])',
    'fn(env[key].value)',
    'fn(env[key]?.value)',
    'new Query(env[key].value)',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('the bundle credential scan follows protected destructuring targets', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'const {foo:GOOGLE_CLIENT_ID}={foo:"hardcoded"}',
    '({foo:GOOGLE_CLIENT_ID}={foo:"hardcoded"})',
    'const [GOOGLE_CLIENT_ID]=["hardcoded"]',
    '({foo:config.GOOGLE_CLIENT_ID}={foo:"hardcoded"})',
    '[config.GOOGLE_CLIENT_ID]=["hardcoded"]',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'const {foo:GOOGLE_CLIENT_ID}=config',
    '[config.GOOGLE_CLIENT_ID]=config.ids',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('the bundle credential scan rejects bracketed credential keys', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'config["GOOGLE_CLIENT_ID"]="123-computed.apps.googleusercontent.com"',
    'config[true ? "GOOGLE_CLIENT_ID" : "OTHER"]="hardcoded"',
    'config[condition ? "GOOGLE_CLIENT_ID" : "GOOGLE_CLIENT_ID"]="hardcoded"',
    'config[(0,"GOOGLE_CLIENT_ID")]="hardcoded"',
    'config[false || "GOOGLE_CLIENT_ID"]="hardcoded"',
    '({["wmsAuthSign"]:"literal-token-value"})',
    'config["OPENAI_SITES_SOURCE_TOKEN"] ??= "sites-source-literal"',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan rejects comment-separated credential keys', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID /* comment */ = "hardcoded"',
    'config["GOOGLE_CLIENT_ID" /* comment */] = "hardcoded"',
    'config["GOOGLE_CLIENT_ID"] /* comment */ = "hardcoded"',
    '({"GOOGLE_CLIENT_ID" /* comment */ : "hardcoded"})',
    'config["OPENAI_SITES_SOURCE_TOKEN"] /* comment */ ??= "hardcoded"',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan stops at an unrelated ASI statement', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  assert.equal(
    verifier.findBundledRuntimeLiteral(
      'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID\nconst label=value||"ordinary-default";'
    ),
    null
  );
});

test('the bundle credential scan allows comments after runtime references', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID/* runtime */',
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID// runtime\nconst x=1;',
    'OPENAI_SITES_SOURCE_TOKEN=env.sourceToken/* runtime */',
    'GOOGLE_CLIENT_ID=env.ID/* comment\n*/\nconst label=value||"ordinary";',
  ]) {
    await t.test(text, () => {
      assert.equal(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan rejects a literal fallback after a runtime reference', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID||"hardcoded"',
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID\n || "hardcoded"',
    'GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID ||\n "hardcoded"',
    'BOOTSTRAP_OWNER_EMAIL=config.email\n ?? "owner@example.com"',
    'GOOGLE_CLIENT_ID=env\n .GOOGLE_CLIENT_ID\n || "hardcoded"',
    'BOOTSTRAP_OWNER_EMAIL=config\n ?.bootstrapOwnerEmail\n ?? "owner@example.com"',
    'SITES_SOURCE_CREDENTIAL=env\n .sourceCredential\n || "hardcoded"',
    'GOOGLE_CLIENT_ID=env\n ["GOOGLE_CLIENT_ID"]\n || "hardcoded"',
    'GOOGLE_CLIENT_ID=env.\n GOOGLE_CLIENT_ID\n || "hardcoded"',
    'GOOGLE_CLIENT_ID=env.ID\n + other\n || "hardcoded"',
    'GOOGLE_CLIENT_ID=env.ID +\n other\n || "hardcoded"',
    'GOOGLE_CLIENT_ID ||= "hardcoded"',
    'GOOGLE_CLIENT_ID ??= "hardcoded"',
    'async function f(){GOOGLE_CLIENT_ID=await "hardcoded"}',
    'async function f(){GOOGLE_CLIENT_ID=env.ID||await "hardcoded"}',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan rejects literal conditional branches', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=condition ? env.ID : "hardcoded.apps.googleusercontent.com"',
    'BOOTSTRAP_OWNER_EMAIL=condition ? "owner@example.com" : config.ownerEmail',
    'SITES_SOURCE_CREDENTIAL=first ? env.token : second ? sourceCredential : "sites-source-literal"',
    'GOOGLE_CLIENT_ID=condition\n ? env.ID\n : "hardcoded.apps.googleusercontent.com"',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
  assert.equal(
    verifier.findBundledRuntimeLiteral(
      'GOOGLE_CLIENT_ID=condition ? env.GOOGLE_CLIENT_ID : config.googleClientId'
    ),
    null
  );
});

test('the bundle credential scan allows conditional runtime member references', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'GOOGLE_CLIENT_ID=env[usePrimary ? "GOOGLE_CLIENT_ID" : "FALLBACK_CLIENT_ID"]',
    'GOOGLE_CLIENT_ID=env?.[usePrimary ? "GOOGLE_CLIENT_ID" : "FALLBACK_CLIENT_ID"]',
    'GOOGLE_CLIENT_ID=outer ? ("prod"===mode ? env.ID : config.ID) : fallback.ID',
  ]) {
    await t.test(text, () => {
      assert.equal(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan distinguishes dynamic and concrete signed query values', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  assert.equal(
    verifier.findBundledRuntimeLiteral(
      'const url="https://example.test/x?wmsAuthSign="+token'
    ),
    null
  );
  assert.equal(
    verifier.findBundledRuntimeLiteral(
      'const url=base+"?wmsAuthSign="+token'
    ),
    null
  );
  assert.equal(
    verifier.findBundledRuntimeLiteral(
      'const url=`https://example.test/x?wmsAuthSign=${env?.token}`'
    ),
    null
  );
  for (const text of [
    'const url="https://example.test/x?wmsAuthSign=abc"+token',
    'const url=`https://example.test/x?wmsAuthSign=abc${token}`',
    'const url=String("https://example.test/x?wmsAuthSign=abc")+token',
    'const url=(0,"https://example.test/x?wmsAuthSign=abc")+token',
    'const url=`${String("https://example.test/x?wmsAuthSign=abc")}${token}`',
    'const url="https://example.test/x?wmsAuthSign="+(condition?"abc":"def")',
    'const url="https://example.test/x?wmsAuthSign="+(token||"abc")',
    'const url="https://example.test/x?wmsAuthSign="+(token+="abc")',
    'const url="https://example.test/x?wmsAuthSign="+(condition?token:otherToken)',
  ]) {
    assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
  }
  assert.notEqual(
    verifier.findBundledRuntimeLiteral(
      'const url="https://example.test/x?wmsAuthSign="+(token="abc")'
    ),
    null
  );
  for (const text of [
    '<script>const url="https://example.test/x?wmsAuthSign="+token</script>',
  ]) {
    assert.equal(verifier.findBundledRuntimeLiteral(text), null);
  }
  assert.notEqual(
    verifier.findBundledRuntimeLiteral(
      '<script>const url=`https://example.test/x?wmsAuthSign=abc${token}`</script>'
    ),
    null
  );
  assert.notEqual(
    verifier.findBundledRuntimeLiteral(
      '<script>const url="https://example.test/x?wmsAuthSign=abc"</script>'
    ),
    null
  );
  assert.notEqual(
    verifier.findBundledRuntimeLiteral(
      'https://video-auth1.iol.pt/auth-beachcam/camera/playlist.m3u8?wmsAuthSign=abc123'
    ),
    null
  );
  assert.notEqual(
    verifier.findBundledRuntimeLiteral(
      'const url="https://example.test/x?wmsAuthSign="+"abc123"'
    ),
    null
  );
});

test('the bundle credential scan rejects a concrete signed query concatenation fragment', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  assert.notEqual(
    verifier.findBundledRuntimeLiteral('base+"?wmsAuthSign=abc123"'),
    null
  );
});

test('the bundle credential scan rejects a concrete signed query template fragment', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '`...?wmsAuthSign=abc123&cacheBust=${Date.now()}`',
    '`?wmsAuth${"Sign=abc"}`',
    '`?wmsAuthSign${"=abc"}`',
    '`?wmsAuth${"Sign="}${"abc"}`',
    '`${base}?wmsAuth${"Sign=abc"}`',
    '`${base}?wmsAuthSign${"=abc"}`',
    '`${base}?wmsAuth${"Sign="}${"abc"}`',
  ]) assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
});

test('the bundle credential scan checks composed values after signed query prefixes', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'base+"?wmsAuthSign="+"abc"+token',
    'base+"?wmsAuthSign="+(token||"abc")',
    '`${base}?wmsAuthSign=${"abc"}&x=${token}`',
    '`${base}?wmsAuthSign=${condition ? "abc" : token}`',
    'base+(first?"?wmsAuthSign=":"?other=")+(second?token:"abc")',
    'base+"?wmsAuthSign=".concat("abc",token)',
    '`${"?wmsAuthSign=".concat("abc")}`',
    'base+["?wmsAuthSign=","abc"].join("")',
    'base+"?wmsAuthSign=".concat(token)',
    'const url="?wmsAuthSign=".concat("abc",token)',
    'const url=["?wmsAuthSign=","abc"].join("")',
    'const url="?wmsAuthSign=".concat(token)',
    'new Query("?wmsAuthSign=","abc")',
    'new URL("?wmsAuthSign="+token,base)',
    'query`?wmsAuthSign=${token}`',
    '`?wmsAuth${condition?"Sign=abc":"Other=x"}`',
    '`?wmsAuthSign${condition?"=abc":token}`',
    'base+"?wmsAuth"+(condition?"Sign=abc":"Other=x")',
    'base+"?wmsAuthSign"+(condition?"=abc":token)',
    'const url="?wmsAuth"+"Sign=abc"',
    'const url="?wmsAuthSign"+"=abc"',
    'base+"?wmsAuth"+"Sign=abc"+token',
    'base+"?wmsAuthSign"+"=abc"+token',
    'base+(condition?"?wmsAuth":"?x=")+"Sign=abc"',
    'base+(condition?"?wmsAuth":"?x=")+"Sign="+token',
    'base+(condition?("?wmsAuth"+"Sign="):"?x=")+"abc"',
    '`${base}${condition?"?wmsAuth":"?x="}Sign=abc`',
    'base+"?"+(condition?"wmsAuthSign=abc":"other=x")',
    '`${base}?${condition?"wmsAuthSign=abc":"other=x"}`',
    'base+"&"+(condition?"wmsAuthSign=abc":"other=x")',
    'base+(condition?"?":"&")+"wmsAuthSign=abc"',
    '`${base}${condition?"?":"&"}wmsAuthSign=abc`',
    'base+(condition?"?w":"&w")+"msAuthSign=abc"',
    'const url="?wmsAuth".concat("Sign=abc")',
    '["?wmsAuth","Sign=abc"].join("")',
    'new Query("?wmsAuth","Sign=abc")',
    'build("?wmsAuth","Sign=abc")',
    'fn(env["?wmsAuthSign=abc"])',
    'obj["?wmsAuthSign=abc"]()',
    'base+(a?"?wms":"?x")+"Auth"+(b?"Sign=abc":"Other=x")',
    'base+(a?"?":"x")+"wms"+(b?"AuthSign=abc":"Other=x")',
    '`${base}${a?"?wms":"?x"}Auth${b?"Sign=abc":"Other=x"}`',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
  for (const text of [
    'base+"?wmsAuthSign="+token',
    '`${base}?wmsAuthSign=${token}`',
    'base+runtimePrefix+"Sign=abc"',
    '`${base}${runtimePrefix}Sign=abc`',
    'build("?wmsAuth",runtimeSuffix)',
    'build(runtimePrefix,"Sign=abc")',
    'base+(condition?"hello?":"world")+"ordinary"',
    '`${base}?${url.searchParams.toString()}`',
    'base+runtimePrefix+"Auth"+runtimeSuffix',
    '`${base}${runtimePrefix}Auth${runtimeSuffix}`',
  ]) {
    await t.test(text, () => {
      assert.equal(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan fails closed on side-effectful query builders', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'base+(kind?(kind=false,"?wmsAuthSign="):"?other=")+(kind?token:"abc")',
    'base+(kind?"?wmsAuthSign=":"?other=")+(kind=false,kind?token:"abc")',
    'base+(obj.kind?"?wmsAuthSign=":"?other=")+(obj.kind?token:"abc")',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the bundle credential scan keeps executable template and regex syntax in sync', async (t) => {
  const verifier = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'const x=`before ${GOOGLE_CLIENT_ID="hardcoded"} after`',
    'const re=/don\'t/; GOOGLE_CLIENT_ID="hardcoded"',
    'const re=/`/; OPENAI_SITES_SOURCE_TOKEN="hardcoded"',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
});

test('the forbidden Surfline media scan rejects mixed-case package text', async () => {
  const verifier = await import('../scripts/verify-sites-package.js');
  assert.equal(typeof verifier.containsForbiddenSurflineText, 'function');
  assert.equal(verifier.containsForbiddenSurflineText('HLS.CDN-SURFLINE.COM'), true);
  assert.equal(verifier.containsForbiddenSurflineText('CamStills.CDN-Surfline.com'), true);
  assert.equal(verifier.containsForbiddenSurflineText('__RAWSURFLINEFEEDS'), true);
  assert.equal(verifier.containsForbiddenSurflineText('safe MEO package text'), false);
});
