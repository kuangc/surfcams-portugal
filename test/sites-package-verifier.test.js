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

test('the AST query scan summarizes each nested builder once', async () => {
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
  assert.ok(unsafeDiagnostics.concreteLiteralNodes <= depth * 4 + 10);
  assert.ok(unsafeDiagnostics.queryCompositionRoots <= depth + 2);

  const runtimeDiagnostics = {};
  assert.equal(find(runtimeSource, {diagnostics: runtimeDiagnostics}), null);
  assert.ok(runtimeDiagnostics.concreteLiteralNodes <= depth * 4 + 10);
  assert.ok(runtimeDiagnostics.queryCompositionRoots <= depth + 2);
});

test('structured carrier literal summaries stay linear when wrappers are nested', async () => {
  const {parseAst} = await import('vite');
  const {findAstSignedQuery} = await import(
    '../scripts/sites-package/signed-query-scan.js'
  );
  const depth = 1000;
  const expression = `entries${'.slice()'.repeat(depth)}`;
  const diagnostics = {};

  assert.equal(
    findAstSignedQuery(
      parseAst(`new URLSearchParams(${expression})`),
      diagnostics
    ),
    null
  );
  assert.ok(diagnostics.concreteLiteralNodes <= depth * 8 + 20);
});

test('computed carrier selectors are visited once through 4k wrapper layers', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const selector = '[(env.method,"slice")]()';
    assert.equal(
      find(`new URLSearchParams(entries${selector.repeat(depth)})`, {
        path: 'server/deep-computed-selectors.js',
        diagnostics,
      }),
      null
    );
    assert.ok(diagnostics.computedSelectorVisits >= depth);
    assert.ok(diagnostics.computedSelectorVisits <= depth + 4);
  }
});

test('signed composition summaries stay linear for left and right nested plus chains', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const sources = [
      Array.from({length: depth}, (_, index) => `value${index}`).join('+'),
      `${'value+('.repeat(depth)}value${')'.repeat(depth)}`,
      Array.from({length: depth}, () => '"a"').join('+'),
      `${'"a"+('.repeat(depth)}"a"${')'.repeat(depth)}`,
    ];
    for (const source of sources) {
      const diagnostics = {};
      assert.equal(find(source, {path: 'server/deep-plus.js', diagnostics}), null);
      assert.ok(diagnostics.signedRelationCompositions <= depth * 8 + 20);
      assert.ok((diagnostics.signedStaticInputCharacters ?? 0) <= depth * 4 + 20);
    }
  }
});

test('the full structured URL carrier scan stays stack-safe through 4k wrappers', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    assert.equal(
      find(`new URLSearchParams(entries${'.slice()'.repeat(depth)})`, {
        path: 'server/deep-url-carrier.js',
        diagnostics,
      }),
      null
    );
  }
});

test('finite static array views materialize elements once across deep transforms', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const concatDiagnostics = {};
    const concatSource = `["?wmsAuth"]${'.concat(["x"])'.repeat(depth)}`
      + '.concat(["Sign=abc"]).join("")';
    assert.equal(find(concatSource, {
      path: 'server/deep-array-concat.js',
      diagnostics: concatDiagnostics,
    }), null);
    assert.ok(
      concatDiagnostics.staticArrayElementMaterializations <= depth + 4
    );

    const sliceDiagnostics = {};
    const literal = `[${Array.from({length: depth}, () => '"x"').join(',')}]`;
    const sliceSource = `${literal}${'.slice()'.repeat(depth)}.join("")`;
    assert.equal(find(sliceSource, {
      path: 'server/deep-array-slice.js',
      diagnostics: sliceDiagnostics,
    }), null);
    assert.ok(
      sliceDiagnostics.staticArrayElementMaterializations <= depth + 4
    );
  }
});

test('nested static literal selectors resolve once per member', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let literal = '"?wmsAuth"';
    for (let index = 0; index < depth; index += 1) literal = `{part:${literal}}`;
    assert.notEqual(find(
      `(${literal})${'.part'.repeat(depth)}+"Sign=abc"`,
      {path: 'server/deep-static-selector.js', diagnostics}
    ), null);
    assert.equal(diagnostics.staticLiteralSelectorSteps, depth);
    assert.equal(diagnostics.staticLiteralSelectorCacheHits, depth);
  }
});

test('derived static array selectors materialize only the selected view', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const source = `["?wmsAuth"]${'.slice()'.repeat(depth)}[0]+"Sign=abc"`;
    assert.notEqual(find(source, {
      path: 'server/deep-array-selector.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticLiteralSelectorSteps, depth + 1);
    assert.equal(diagnostics.staticArrayElementMaterializations, 1);
  }
});

test('nested static object spreads inspect and reuse each property once', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let object = '{part:"?wmsAuth"}';
    for (let index = 0; index < depth; index += 1) object = `{...${object}}`;
    assert.notEqual(find(`(${object}).part+"Sign=abc"`, {
      path: 'server/deep-object-selector.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticObjectSelectorSteps, depth + 1);
    assert.equal(diagnostics.staticObjectSelectorCacheHits, depth);
  }
});

test('optional object spreads preserve fallback property outcomes', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const spreads = ',...runtimeObject'.repeat(depth);
    assert.notEqual(find(
      `({part:"?wmsAuth"${spreads}}).part+"Sign=abc"`,
      {path: 'server/deep-optional-object-spread.js', diagnostics}
    ), null);
    assert.equal(diagnostics.staticObjectSelectorSteps, depth + 1);
  }
});

test('static object prototype lookup stays cached through 4k levels', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let object = '{part:"?wmsAuth"}';
    for (let index = 0; index < depth; index += 1) {
      object = `{__proto__:${object}}`;
    }
    assert.notEqual(find(`(${object}).part+"Sign=abc"`, {
      path: 'server/deep-object-prototype.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticObjectPrototypeSteps, depth);
    assert.equal(diagnostics.staticObjectPrototypeCacheHits, depth);
  }
});

test('getter selections inspect one bounded return per member', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const source = Array.from(
      {length: depth},
      () => '({get part(){return runtimePrefix}}).part'
    ).join(';');
    assert.equal(find(source, {
      path: 'server/deep-getter-selector.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticLiteralSelectorSteps, depth);
    assert.equal(diagnostics.staticGetterReturnInspections, depth);
  }
});

test('getter fall-through outcomes are summarized once per return', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const source = Array.from(
      {length: depth},
      () => '"?wmsAuthSign="+({get part(){if(flag)return token}}).part'
    ).join(';');
    assert.notEqual(find(source, {
      path: 'server/deep-getter-fallthrough.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticGetterReturnInspections, depth);
    assert.equal(diagnostics.staticGetterFallthroughOutcomes, depth);
  }
});

test('optional array index outcomes are scanned once per visible segment', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const source = `[${'...parts,'.repeat(depth)}"?wmsAuth"][0]+"Sign=abc"`;
    assert.notEqual(find(source, {
      path: 'server/deep-optional-selector.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticArrayIndexOutcomeSteps, depth + 1);
    assert.equal(diagnostics.staticArrayElementMaterializations, depth + 1);
  }
});

test('variable-length slice views map stable edges once', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const frontDiagnostics = {};
    const front = `["?wmsAuth",${'...parts,'.repeat(depth)}]`
      + '.slice(0,1)[0]+"Sign=abc"';
    assert.notEqual(find(front, {
      path: 'server/deep-variable-front-slice.js',
      diagnostics: frontDiagnostics,
    }), null);
    assert.equal(frontDiagnostics.staticArraySliceMappingSteps, depth + 1);
    assert.equal(frontDiagnostics.staticArraySliceOperations, 1);

    const suffixDiagnostics = {};
    const suffix = `[${'...parts,'.repeat(depth)}"?wmsAuth"]`
      + '.slice(-1)[0]+"Sign=abc"';
    assert.notEqual(find(suffix, {
      path: 'server/deep-variable-suffix-slice.js',
      diagnostics: suffixDiagnostics,
    }), null);
    assert.equal(suffixDiagnostics.staticArraySliceMappingSteps, depth + 1);
    assert.equal(suffixDiagnostics.staticArraySliceOperations, 1);

    const nestedDiagnostics = {};
    const nested = `["?wmsAuth",...parts]${'.slice(0,1)'.repeat(depth)}`
      + '[0]+"Sign=abc"';
    assert.notEqual(find(nested, {
      path: 'server/deep-variable-nested-slice.js',
      diagnostics: nestedDiagnostics,
    }), null);
    assert.equal(nestedDiagnostics.staticArraySliceMappingSteps, 2);
    assert.equal(nestedDiagnostics.staticArraySliceOperations, depth);
  }
});

test('selection outcomes stay closed through chained access and array coercion', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const unsafe = [
    '({get a(){if(flag)return {b:"?wmsAuth"};return {b:runtimePrefix}}}).a.b+"Sign=abc"',
    '({get a(){if(flag)return {b:"?wmsAuth"}}}).a?.b+"Sign=abc"',
    '({get a(){if(flag)return ["?wmsAuth"];return [runtimePrefix]}}).a[0]+"Sign=abc"',
    '({part:{sub:"?wmsAuth"},...runtimeObject}).part.sub+"Sign=abc"',
    '[...runtimeArray,{sub:"?wmsAuth"}][0].sub+"Sign=abc"',
    '({part:["?wmsAuth"],...runtimeObject}).part.join("")+"Sign=abc"',
    '[...runtimeArray,["?wmsAuth"]][0].join("")+"Sign=abc"',
    'String(({part:["?wmsAuth"],...runtimeObject}).part)+"Sign=abc"',
    '`${[...runtimeArray,["?wmsAuth"]][0]}Sign=abc`',
  ];
  for (const source of unsafe) {
    await t.test(source, () => {
      assert.notEqual(find(source, {path: 'server/selection-outcomes.js'}), null);
    });
  }

  const safe = [
    '({get a(){if(flag)return {b:runtimePrefix};return {b:env.prefix}}}).a.b+runtimeSuffix',
    '({get a(){if(flag)return {b:runtimePrefix}}}).a?.b+runtimeSuffix',
    '({get a(){if(flag)return [runtimePrefix];return [env.prefix]}}).a[0]+runtimeSuffix',
    '({part:{sub:runtimePrefix},...runtimeObject}).part.sub+runtimeSuffix',
    '[...runtimeArray,{sub:runtimePrefix}][0].sub+runtimeSuffix',
    '({part:[runtimePrefix],...runtimeObject}).part.join("")+runtimeSuffix',
    '[...runtimeArray,[runtimePrefix]][0].join("")+runtimeSuffix',
    'String(({part:[runtimePrefix],...runtimeObject}).part)+runtimeSuffix',
    '`${[...runtimeArray,[runtimePrefix]][0]}${runtimeSuffix}`',
  ];
  for (const source of safe) {
    await t.test(source, () => {
      assert.equal(find(source, {path: 'server/selection-outcomes.js'}), null);
    });
  }
});

test('alternating selection outcomes compose linearly through 4k members', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let object = '{leaf:"?wmsAuth"}';
    for (let index = depth - 1; index >= 0; index -= 1) {
      object = `{next:${object},...runtimeObject${index}}`;
    }
    const source = `(${object})${'.next'.repeat(depth)}.leaf+"Sign=abc"`;
    assert.notEqual(find(source, {
      path: 'server/deep-selection-outcomes.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticSelectionOperations, depth + 1);
    assert.equal(diagnostics.staticSelectionAlternativeSteps, depth + 1);
  }
});

test('selection alternative overflow fails closed without unbounded mapping', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const runtimeReturns = Array.from(
    {length: 128},
    (_, index) => `if(flag${index})return runtime${index};`
  ).join('');
  assert.equal(find(
    `({get value(){${runtimeReturns}return runtimeFallback}}).value.part`,
    {path: 'server/selection-cap.js'}
  ), null);

  const structuredReturns = Array.from(
    {length: 64},
    (_, index) => `if(flag${index})return {part:"ordinary${index}"};`
  ).join('');

  const diagnostics = {};
  assert.notEqual(find(
    `({get value(){${structuredReturns}return {part:"ordinary"}}}).value.part`,
    {path: 'server/selection-cap.js', diagnostics}
  ), null);
  assert.equal(diagnostics.staticSelectionAlternativeSteps, 1);
});

test('object accessor descriptor halves preserve the effective getter', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const source of [
    '({get x(){return "?wmsAuth"},set x(value){}}).x+"Sign=abc"',
    '({set x(value){},get x(){return "?wmsAuth"}}).x+"Sign=abc"',
    '({get x(){return "?wmsAuth"},...{},set x(value){}}).x+"Sign=abc"',
    '({get x(){return runtimePrefix},set x(value){},get x(){return "?wmsAuth"}}).x+"Sign=abc"',
  ]) {
    await t.test(`getter: ${source}`, () => {
      assert.notEqual(find(source, {path: 'server/object-descriptor.js'}), null);
    });
  }
  for (const source of [
    '({get x(){return runtimePrefix},set x(value){}}).x+runtimeSuffix',
    '({set x(value){},get x(){return runtimePrefix}}).x+runtimeSuffix',
    '({get x(){return "?wmsAuth"},x:runtimePrefix,set x(value){}}).x+"Sign=abc"',
    '({get x(){return "?wmsAuth"},set x(value){},x:runtimePrefix}).x+"Sign=abc"',
  ]) {
    await t.test(`control: ${source}`, () => {
      assert.equal(find(source, {path: 'server/object-descriptor.js'}), null);
    });
  }
});

test('accessor descriptor merging stays linear across 4k objects', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    const source = Array.from(
      {length: depth},
      () => '({get x(){return runtimePrefix},set x(value){}}).x'
    ).join(';');
    assert.equal(find(source, {
      path: 'server/deep-object-descriptors.js',
      diagnostics,
    }), null);
    assert.equal(diagnostics.staticObjectDescriptorHalfMerges, depth);
  }
});

test('member-valued selection outcomes and computed keys stay compositional', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const source of [
    '({get a(){return ({b:{c:"?wmsAuth"}}).b}}).a.c+"Sign=abc"',
    '({get a(){return ({b:[{c:"?wmsAuth"}]}).b}}).a[0].c+"Sign=abc"',
    '({root:({next:{leaf:"?wmsAuth"}}).next}).root.leaf+"Sign=abc"',
    '({c:"?wmsAuth"})[({k:"c"}).k]+"Sign=abc"',
    '({c:"?wmsAuth"})[({get k(){if(flag)return "c";return runtimeKey}}).k]+"Sign=abc"',
  ]) {
    await t.test(`static: ${source}`, () => {
      assert.notEqual(find(source, {path: 'server/member-valued-selection.js'}), null);
    });
  }
  for (const source of [
    '({get a(){return ({b:{c:runtimePrefix}}).b}}).a.c+runtimeSuffix',
    '({get a(){return ({b:[{c:runtimePrefix}]}).b}}).a[0].c+runtimeSuffix',
    '({root:runtimeRoot}).root.leaf+runtimeSuffix',
    '({c:"?wmsAuth"})[runtimeKey]+runtimeSuffix',
    '({c:runtimePrefix})[({get k(){if(flag)return "c";return runtimeKey}}).k]+runtimeSuffix',
  ]) {
    await t.test(`runtime: ${source}`, () => {
      assert.equal(find(source, {path: 'server/member-valued-selection.js'}), null);
    });
  }
});

test('member-valued outcome chains resolve once through 4k levels', async () => {
  const {staticLiteralMemberSelection} = await import(
    '../scripts/sites-package/static-member-selection.js'
  );
  const identifier = (name) => ({name, type: 'Identifier'});
  const member = (object, key) => ({
    computed: false,
    object,
    optional: false,
    property: identifier(key),
    type: 'MemberExpression',
  });
  const object = (key, value) => ({
    properties: [{
      computed: false,
      key: identifier(key),
      kind: 'init',
      method: false,
      shorthand: false,
      type: 'Property',
      value,
    }],
    type: 'ObjectExpression',
  });
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let value = object('leaf', {type: 'Literal', value: '?wmsAuth'});
    for (let index = 0; index < depth; index += 1) {
      value = member(object('next', value), 'next');
    }
    const root = member(member(object('root', value), 'root'), 'leaf');
    const outcome = staticLiteralMemberSelection(root, {
      members: new WeakMap(),
      objects: new WeakMap(),
    }, diagnostics);
    assert.deepEqual(outcome.nodes.map((node) => node.value), ['?wmsAuth']);
    assert.equal(diagnostics.staticSelectionOperations, depth + 2);
    assert.equal(diagnostics.staticSelectionResolvedMemberSteps, depth);
  }
});

test('computed key expressions preserve bounded static alternatives', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const source of [
    '({c:"?wmsAuth"})[flag?"c":"other"]+"Sign=abc"',
    '({c:"?wmsAuth"})[flag&&"c"]+"Sign=abc"',
    '({c:"?wmsAuth"})[flag||"c"]+"Sign=abc"',
    '({c:"?wmsAuth"})[flag?"c":runtimeKey]+"Sign=abc"',
    '({c:"?wmsAuth"})[(flag?"":"x")+"c"]+"Sign=abc"',
    '({c:"?wmsAuth"})[`${flag?"":"x"}c`]+"Sign=abc"',
    '({c:"?wmsAuth"})[["c"]]+"Sign=abc"',
    '({c:"?wmsAuth"})[Array.of("c")]+"Sign=abc"',
  ]) {
    await t.test(`static: ${source}`, () => {
      assert.notEqual(find(source, {path: 'server/computed-key-outcomes.js'}), null);
    });
  }
  for (const source of [
    '({c:"?wmsAuth"})[runtimeKey]+runtimeSuffix',
    '({c:"?wmsAuth"})[flag?runtimeKey:otherKey]+runtimeSuffix',
    '({c:"?wmsAuth"})[runtimePrefix+"c"]+runtimeSuffix',
    '({c:"?wmsAuth"})[`${runtimePrefix}c`]+runtimeSuffix',
    '({c:"?wmsAuth"})[runtimeArray]+runtimeSuffix',
    '({c:"?wmsAuth"})[["other"]]+runtimeSuffix',
  ]) {
    await t.test(`runtime: ${source}`, () => {
      assert.equal(find(source, {path: 'server/computed-key-outcomes.js'}), null);
    });
  }
});

test('computed key primitive outcomes preserve JavaScript plus semantics', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const source of [
    '({3:"?wmsAuth"})[1+2]+"Sign=abc"',
    '({0:"?wmsAuth"})[-1+1]+"Sign=abc"',
    '({12:"?wmsAuth"})["1"+2]+"Sign=abc"',
    '({1:"?wmsAuth"})[null+1]+"Sign=abc"',
    '({1:"?wmsAuth"})[true+0]+"Sign=abc"',
    '({undefinedx:"?wmsAuth"})[({}).missing+"x"]+"Sign=abc"',
    '({3:"?wmsAuth"})[1n+2n]+"Sign=abc"',
    '({0:"?wmsAuth"})[-1n+1n]+"Sign=abc"',
    '({3:"?wmsAuth"})[flag?(1n+2):(1n+2n)]+"Sign=abc"',
    '({3:"?wmsAuth"})[`${1+2}`]+"Sign=abc"',
  ]) {
    await t.test(`static: ${source}`, () => {
      assert.notEqual(find(source, {path: 'server/typed-computed-key.js'}), null);
    });
  }

  for (const source of [
    '({3:"?wmsAuth"})[1n+2]+"Sign=abc"',
    '({3:"?wmsAuth"})[2+1n]+"Sign=abc"',
    '({1:"?wmsAuth"})[+1n]+"Sign=abc"',
    '({ordinary:"safe"})[null+false]',
    'runtimeRoot[runtimeKey+1]+runtimeSuffix',
  ]) {
    await t.test(`throw/runtime control: ${source}`, () => {
      assert.equal(find(source, {path: 'server/typed-computed-key.js'}), null);
    });
  }
});

test('primitive outcomes retain typed values and actual undefined', async () => {
  const {createStaticPrimitiveOutcomeAnalyzer} = await import(
    '../scripts/sites-package/static-primitive-outcomes.js'
  );
  const literal = (value) => ({type: 'Literal', value});
  const branch = (left, right) => ({
    alternate: right,
    consequent: left,
    test: {name: 'flag', type: 'Identifier'},
    type: 'ConditionalExpression',
  });
  const selected = {
    computed: false,
    object: {type: 'ObjectExpression', properties: []},
    property: {name: 'missing', type: 'Identifier'},
    type: 'MemberExpression',
  };
  const analyzer = createStaticPrimitiveOutcomeAnalyzer({
    selectedOutcome(node) {
      return node === selected
        ? {conservative: false, dynamic: false, nodes: [], undefinedOutcome: true}
        : null;
    },
  });
  const values = analyzer.outcomes(
    branch(literal(1), branch(literal('1'), branch(literal(-0), literal(0))))
  ).values;
  assert.equal(values.some((value) => typeof value === 'number' && value === 1), true);
  assert.equal(values.some((value) => typeof value === 'string' && value === '1'), true);
  assert.equal(values.some((value) => Object.is(value, -0)), true);
  assert.equal(values.some((value) => Object.is(value, 0)), true);

  const nanValues = analyzer.outcomes(
    branch(literal(Number.NaN), literal(Number.NaN))
  ).values;
  assert.equal(nanValues.length, 1);
  assert.equal(Object.is(nanValues[0], Number.NaN), true);

  const missing = analyzer.outcomes(selected);
  assert.deepEqual(missing.values, [undefined]);
  assert.equal(typeof missing.values[0], 'undefined');
});

test('computed key outcome caps distinguish runtime and structured alternatives', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  let runtimeOnly = 'runtimeFallback';
  for (let index = 127; index >= 0; index -= 1) {
    runtimeOnly = `flag${index}?runtime${index}:${runtimeOnly}`;
  }
  assert.equal(find(
    `({ordinary:"safe"})[${runtimeOnly}]`,
    {path: 'server/computed-key-cap.js'}
  ), null);

  let overflow = '"ordinary64"';
  for (let index = 63; index >= 0; index -= 1) {
    overflow = `flag${index}?"ordinary${index}":(${overflow})`;
  }
  assert.notEqual(find(
    `({ordinary:"safe"})[${overflow}]`,
    {path: 'server/computed-key-cap.js'}
  ), null);
});

test('computed key character bounds fail closed only for static outcomes', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const length of [255, 256, 257, 4096]) {
    const key = 'k'.repeat(length);
    const literal = JSON.stringify(key);
    const left = JSON.stringify(key.slice(0, Math.floor(length / 2)));
    const right = JSON.stringify(key.slice(Math.floor(length / 2)));
    for (const [shape, selector] of [
      ['literal', literal],
      ['template', `\`${key}\``],
      ['plus', `${left}+${right}`],
      ['selected member', `({key:${literal}}).key`],
    ]) {
      await t.test(`${length} ${shape}`, () => {
        assert.notEqual(find(
          `({[${literal}]:"?wmsAuth"})[${selector}]+"Sign=abc"`,
          {path: 'server/computed-key-char-cap.js'}
        ), null);
      });
    }
  }

  const long = JSON.stringify('k'.repeat(4096));
  for (const source of [
    'runtimeRoot[runtimeKey]+runtimeSuffix',
    `runtimeRoot[runtimePrefix+${long}]+runtimeSuffix`,
    `runtimeRoot[\`${'${runtimePrefix}'}${'k'.repeat(4096)}\`]+runtimeSuffix`,
    'runtimeRoot[({key:runtimeKey}).key]+runtimeSuffix',
  ]) {
    await t.test(`runtime: ${source.slice(0, 80)}`, () => {
      assert.equal(find(source, {path: 'server/computed-key-char-cap.js'}), null);
    });
  }
});

test('primitive outcome character overflow is explicit and conservative', async () => {
  const {createStaticPrimitiveOutcomeAnalyzer} = await import(
    '../scripts/sites-package/static-primitive-outcomes.js'
  );
  const analyzer = createStaticPrimitiveOutcomeAnalyzer();
  const bounded = analyzer.outcomes({type: 'Literal', value: 'x'.repeat(256)});
  assert.equal(bounded.conservative, false);
  assert.deepEqual(bounded.values, ['x'.repeat(256)]);

  const overflow = analyzer.outcomes({type: 'Literal', value: 'x'.repeat(257)});
  assert.equal(overflow.conservative, true);
  assert.deepEqual(overflow.values, []);

  const runtime = analyzer.outcomes({name: 'runtimeKey', type: 'Identifier'});
  assert.equal(runtime.conservative, false);
  assert.equal(runtime.dynamic, true);
});

test('URL field character bounds cannot drop split protected names', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const googleSuffix = '&GOOGLE_';
  for (const length of [255, 256, 257, 300]) {
    const first = `${'x'.repeat(length - googleSuffix.length)}${googleSuffix}`;
    await t.test(`Google split at ${length}`, () => {
      assert.notEqual(find(
        `new URLSearchParams(${JSON.stringify(first)}+"CLIENT_ID=hardcoded")`,
        {path: 'server/url-field-char-cap.js'}
      ), null);
    });
  }
  for (const [prefix, suffix] of [
    ['&BOOTSTRAP_', 'OWNER_EMAIL=owner@example.com'],
    ['&OPENAI_SITES_', 'SOURCE_TOKEN=secret'],
  ]) {
    const first = `${'x'.repeat(300 - prefix.length)}${prefix}`;
    await t.test(prefix, () => {
      assert.notEqual(find(
        `new URLSearchParams(${JSON.stringify(first)}+${JSON.stringify(suffix)})`,
        {path: 'server/url-field-char-cap.js'}
      ), null);
    });
  }
  for (const [prefix, completion] of [
    ['GOOGLE_', `CLIENT_ID=${'x'.repeat(300)}`],
    ['BOOTSTRAP_', `OWNER_EMAIL=${'x'.repeat(300)}@example.com`],
    ['OPENAI_SITES_', `SOURCE_TOKEN=${'x'.repeat(300)}`],
  ]) {
    await t.test(`long completion: ${prefix}`, () => {
      assert.notEqual(find(
        `new URLSearchParams(${JSON.stringify(prefix)}+${JSON.stringify(completion)})`,
        {path: 'server/url-field-char-cap.js'}
      ), null);
    });
  }

  const pad = 'x'.repeat(300);
  for (const source of [
    `new URLSearchParams(${JSON.stringify(`${pad}&ordinary=`)}+"value")`,
    `new URLSearchParams(${JSON.stringify(`${pad}&GOOGLE_CLIENT_ID=`)}+env.ID)`,
    `new URLSearchParams(${JSON.stringify(`${pad}&OPENAI_SITES_SOURCE_TOKEN=`)}+env.token)`,
  ]) {
    await t.test(`safe: ${source.slice(0, 80)}`, () => {
      assert.equal(find(source, {path: 'server/url-field-char-cap.js'}), null);
    });
  }
});

test('computed key branch and composition outcomes stay linear through 4k', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const {createStaticPrimitiveOutcomeAnalyzer} = await import(
    '../scripts/sites-package/static-primitive-outcomes.js'
  );
  for (const depth of [1000, 2000, 4000]) {
    const branchDiagnostics = {};
    let branch = {type: 'Literal', value: 'c'};
    for (let index = depth - 1; index >= 0; index -= 1) {
      branch = {
        type: 'ConditionalExpression',
        test: {name: `flag${index}`, type: 'Identifier'},
        consequent: {type: 'Literal', value: 'c'},
        alternate: branch,
      };
    }
    const branchAnalyzer = createStaticPrimitiveOutcomeAnalyzer({
      coerceStatic(node) {
        return node.type === 'Literal'
          ? {known: true, value: node.value}
          : null;
      },
      diagnosticPrefix: 'staticKeyOutcome',
      diagnostics: branchDiagnostics,
    });
    assert.deepEqual(branchAnalyzer.outcomes(branch).values, ['c']);
    assert.equal(branchDiagnostics.staticKeyOutcomeCompositions, depth);

    const compositionDiagnostics = {};
    let composition = {type: 'Literal', value: 'c'};
    for (let index = depth - 1; index >= 0; index -= 1) {
      composition = {
        type: 'BinaryExpression',
        operator: '+',
        left: {
          type: 'ConditionalExpression',
          test: {name: `flag${index}`, type: 'Identifier'},
          consequent: {type: 'Literal', value: ''},
          alternate: {type: 'Literal', value: ''},
        },
        right: composition,
      };
    }
    const compositionAnalyzer = createStaticPrimitiveOutcomeAnalyzer({
      coerceStatic(node) {
        return node.type === 'Literal'
          ? {known: true, value: node.value}
          : null;
      },
      diagnosticPrefix: 'staticKeyOutcome',
      diagnostics: compositionDiagnostics,
    });
    assert.deepEqual(compositionAnalyzer.outcomes(composition).values, ['c']);
    assert.equal(compositionDiagnostics.staticKeyOutcomeCompositions, depth * 2);
  }

  let parsedBranch = '"c"';
  for (let index = 999; index >= 0; index -= 1) {
    parsedBranch = `flag${index}?"c":(${parsedBranch})`;
  }
  assert.notEqual(find(`({c:"?wmsAuth"})[${parsedBranch}]+"Sign=abc"`, {
    path: 'server/deep-computed-key-branch.js',
  }), null);
});

test('typed primitive plus summaries have bounded exact work through 4k', async () => {
  const {createStaticPrimitiveOutcomeAnalyzer} = await import(
    '../scripts/sites-package/static-primitive-outcomes.js'
  );
  const literal = (value) => ({type: 'Literal', value});
  const plus = (left, right) => ({
    left,
    operator: '+',
    right,
    type: 'BinaryExpression',
  });

  for (const depth of [1000, 2000, 4000]) {
    for (const direction of ['left', 'right']) {
      const numericDiagnostics = {};
      let numeric = literal(0);
      for (let index = 0; index < depth; index += 1) {
        numeric = direction === 'left'
          ? plus(numeric, literal(1))
          : plus(literal(1), numeric);
      }
      const numericAnalyzer = createStaticPrimitiveOutcomeAnalyzer({
        diagnosticPrefix: 'typedPrimitive',
        diagnostics: numericDiagnostics,
      });
      assert.deepEqual(numericAnalyzer.outcomes(numeric).values, [depth]);
      assert.equal(numericDiagnostics.typedPrimitiveCompositions, depth);
      assert.equal(numericDiagnostics.typedPrimitivePlusOperations, depth);
      assert.equal(numericDiagnostics.typedPrimitiveMaterializedCharacters, 0);

      const stringDiagnostics = {};
      let string = literal('');
      for (let index = 0; index < depth; index += 1) {
        string = direction === 'left'
          ? plus(string, literal('x'))
          : plus(literal('x'), string);
      }
      const stringAnalyzer = createStaticPrimitiveOutcomeAnalyzer({
        diagnosticPrefix: 'typedPrimitive',
        diagnostics: stringDiagnostics,
      });
      const result = stringAnalyzer.outcomes(string);
      assert.equal(result.conservative, true);
      assert.deepEqual(result.values, []);
      assert.equal(stringDiagnostics.typedPrimitiveCompositions, depth);
      assert.equal(stringDiagnostics.typedPrimitivePlusOperations, 257);
      assert.equal(stringDiagnostics.typedPrimitiveMaterializedCharacters, 33153);
    }
  }
});

test('lexical binding resolution caches each nested scope', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const diagnostics = {};
    let source = '';
    for (let index = 0; index < depth; index += 1) {
      source = `{URLSearchParams;${source}}`;
    }
    assert.equal(find(source, {path: 'server/deep-scope.js', diagnostics}), null);
    assert.equal(diagnostics.lexicalBindingResolutionSteps, depth + 1);
  }
});

test('the full URL field summaries stay stack-safe through 4k branches', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const depth = 4000;
  let ordinary = '"ordinary=x"';
  let partial = '"GOOGLE_"';
  let trailing = '"GOOGLE_CLIENT_ID="';
  for (let index = 0; index < depth; index += 1) {
    ordinary = `flag${index}?"ordinary${index}=x":${ordinary}`;
    partial = `flag${index}?"ordinary${index}":${partial}`;
    trailing = `flag${index}?"ordinary${index}":${trailing}`;
  }

  assert.equal(find(`new URLSearchParams(${ordinary})`, {path: 'server/deep-url.js'}), null);
  assert.notEqual(
    find(`new URLSearchParams((${partial})+"CLIENT_ID=hardcoded")`, {
      path: 'server/deep-url.js',
    }),
    null
  );
  assert.equal(
    find(`new URLSearchParams((${trailing})+token)`, {path: 'server/deep-url.js'}),
    null
  );
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

test('credential outcome summaries stay linear for nested protected assignments', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const measurements = [];
  for (const depth of [1000, 2000, 4000]) {
    const source = 'GOOGLE_CLIENT_ID='.repeat(depth) + 'env.GOOGLE_CLIENT_ID';
    const diagnostics = {};
    assert.equal(find(source, {path: 'server/nested.js', diagnostics}), null);
    measurements.push({depth, diagnostics});
  }

  for (const {depth, diagnostics} of measurements) {
    assert.ok(diagnostics.credentialAstNodes <= depth * 4 + 10);
    assert.ok(diagnostics.credentialOutcomeComputations <= depth * 2 + 10);
    assert.ok(diagnostics.credentialOutcomeCacheHits >= depth - 2);
  }
  assert.ok(
    measurements[1].diagnostics.credentialOutcomeComputations
      <= measurements[0].diagnostics.credentialOutcomeComputations * 2 + 10
  );
  assert.ok(
    measurements[2].diagnostics.credentialOutcomeComputations
      <= measurements[1].diagnostics.credentialOutcomeComputations * 2 + 10
  );
});

test('protected iterable carrier scans stay linear when carriers are nested', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const measurements = [];
  for (const depth of [200, 400, 800]) {
    let source = 'env';
    for (let index = 0; index < depth; index += 1) {
      source = `Object.fromEntries([["ordinary",${source}]])`;
    }
    const diagnostics = {};
    assert.equal(find(source, {path: 'server/nested-carriers.js', diagnostics}), null);
    measurements.push({depth, diagnostics});
  }

  for (const {diagnostics} of measurements) {
    assert.ok(diagnostics.credentialIterableNodes <= diagnostics.credentialAstNodes * 2);
  }
  assert.ok(
    measurements[1].diagnostics.credentialIterableNodes
      <= measurements[0].diagnostics.credentialIterableNodes * 2 + 20
  );
  assert.ok(
    measurements[2].diagnostics.credentialIterableNodes
      <= measurements[1].diagnostics.credentialIterableNodes * 2 + 20
  );
});

test('bounded protected key summaries stay stack-safe with nested branches', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const key = 'flag?"ordinary":'.repeat(depth) + '"other"';
    const diagnostics = {};
    assert.equal(
      find(`Object.fromEntries([[${key},"hardcoded"]])`, {
        path: 'server/nested-keys.js',
        diagnostics,
      }),
      null
    );
    assert.ok(diagnostics.credentialKeyOutcomeNodes <= depth * 3 + 10);
  }
});

test('generic target key caps cannot discard a protected static branch', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  let key = '"GOOGLE_CLIENT_ID"';
  for (let index = 63; index >= 0; index -= 1) {
    key = `condition${index}?"ordinary${index}":(${key})`;
  }

  assert.notEqual(find(`config[${key}]="hardcoded"`), null);
  assert.equal(find('config[getKey()]="hardcoded"'), null);
});

test('static tuple spread summaries stay stack-safe when deeply nested', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const depth of [1000, 2000, 4000]) {
    const tuple = '[...'.repeat(depth)
      + '["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]'
      + ']'.repeat(depth);
    assert.equal(
      find(`Object.fromEntries([${tuple}])`, {path: 'server/nested-tuples.js'}),
      null
    );
  }
});

test('protected sequence assignment summaries stay linear when nested', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const measurements = [];
  for (const depth of [200, 400, 800]) {
    let value = '(token=env.ID,token)';
    for (let index = 0; index < depth; index += 1) {
      value = `(GOOGLE_CLIENT_ID=${value},token)`;
    }
    const diagnostics = {};
    assert.equal(
      find(`GOOGLE_CLIENT_ID=${value}`, {path: 'server/nested-sequences.js', diagnostics}),
      null
    );
    measurements.push({depth, diagnostics});
  }

  for (const {diagnostics} of measurements) {
    assert.ok(diagnostics.credentialAssignmentNodes <= diagnostics.credentialAstNodes * 2);
  }
  assert.ok(
    measurements[1].diagnostics.credentialAssignmentNodes
      <= measurements[0].diagnostics.credentialAssignmentNodes * 2 + 20
  );
  assert.ok(
    measurements[2].diagnostics.credentialAssignmentNodes
      <= measurements[1].diagnostics.credentialAssignmentNodes * 2 + 20
  );
});

test('protected assignment summaries stay linear across distinct result references', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const measurements = [];
  for (const depth of [1000, 2000, 4000]) {
    let value = '(token0=env.ID,token0)';
    for (let index = 1; index <= depth; index += 1) {
      value = `(GOOGLE_CLIENT_ID=${value},token${index})`;
    }
    const diagnostics = {};
    assert.equal(
      find(`GOOGLE_CLIENT_ID=${value}`, {path: 'server/distinct-sequences.js', diagnostics}),
      null
    );
    measurements.push({depth, diagnostics});
  }

  for (const {diagnostics} of measurements) {
    assert.ok(diagnostics.credentialAssignmentNodes <= diagnostics.credentialAstNodes * 2);
  }
  assert.ok(
    measurements[1].diagnostics.credentialAssignmentNodes
      <= measurements[0].diagnostics.credentialAssignmentNodes * 2 + 20
  );
  assert.ok(
    measurements[2].diagnostics.credentialAssignmentNodes
      <= measurements[1].diagnostics.credentialAssignmentNodes * 2 + 20
  );
});

test('protected assignment summaries classify repeated safe assignments once', async () => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  const measurements = [];
  for (const depth of [1000, 2000, 4000]) {
    let value = '(token=env.ID,token)';
    for (let index = 0; index < depth; index += 1) {
      value = `(token=env.ID,GOOGLE_CLIENT_ID=${value},token)`;
    }
    const diagnostics = {};
    assert.equal(
      find(`GOOGLE_CLIENT_ID=${value}`, {path: 'server/repeated-sequences.js', diagnostics}),
      null
    );
    measurements.push({depth, diagnostics});
  }

  for (const {diagnostics} of measurements) {
    assert.ok(
      diagnostics.credentialAssignmentCandidateInspections
        <= diagnostics.credentialAstNodes * 2
    );
  }
  assert.ok(
    measurements[1].diagnostics.credentialAssignmentCandidateInspections
      <= measurements[0].diagnostics.credentialAssignmentCandidateInspections * 2 + 20
  );
  assert.ok(
    measurements[2].diagnostics.credentialAssignmentCandidateInspections
      <= measurements[1].diagnostics.credentialAssignmentCandidateInspections * 2 + 20
  );
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

test('the public package verifier scans decoded JSON string values for credentials', async (t) => {
  for (const [name, contents, expected] of [
    [
      'Google value',
      '{"x":"GOOGLE_CLIENT_ID=hardcoded"}',
      /Bundled Google client ID literal/,
    ],
    [
      'owner value',
      '{"x":"BOOTSTRAP_OWNER_EMAIL=owner@example.com"}',
      /Bundled bootstrap owner email literal/,
    ],
    [
      'Sites value',
      '{"x":"OPENAI_SITES_SOURCE_TOKEN=secret"}',
      /Bundled Sites source credential literal/,
    ],
    [
      'escaped separator',
      '{"x":"GOOGLE_CLIENT_ID\\u003dhardcoded"}',
      /Bundled Google client ID literal/,
    ],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      `data/decoded-${name.replaceAll(' ', '-')}.json`,
      contents,
      expected
    ));
  }
  for (const [name, contents] of [
    ['empty binding', '{"x":"GOOGLE_CLIENT_ID="}'],
    ['key-only text', '{"x":"GOOGLE_CLIENT_ID"}'],
    ['runtime member binding', '{"x":"GOOGLE_CLIENT_ID=env.GOOGLE_CLIENT_ID"}'],
  ]) {
    await t.test(name, () => assertSitesPackageAccepts(
      `data/safe-${name.replaceAll(' ', '-')}.json`,
      contents
    ));
  }
});

test('source-map metadata string values receive decoded credential scanning', async (t) => {
  await t.test('literal metadata', () => assertSitesPackageRejects(
    'server/credential.js.map',
    JSON.stringify({version: 3, sourceRoot: 'GOOGLE_CLIENT_ID=hardcoded'}),
    /Bundled Google client ID literal/
  ));
  await t.test('empty metadata binding', () => assertSitesPackageAccepts(
    'server/safe.js.map',
    JSON.stringify({version: 3, sourceRoot: 'GOOGLE_CLIENT_ID='})
  ));
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

test('the public package verifier decodes percent-encoded signed-query name characters', async (t) => {
  const signedUrl = 'https://x.test/y?wms%41uthSign=abc123';
  for (const [name, path, contents] of [
    ['JavaScript', 'server/percent-name.js', `const url=${JSON.stringify(signedUrl)};`],
    ['JSON', 'data/percent-name.json', JSON.stringify({url: signedUrl})],
    ['HTML', 'percent-name.html', `<a href="${signedUrl}">camera</a>`],
    ['text', 'assets/percent-name.txt', signedUrl],
    ['lowercase hex', 'server/percent-name-lower.js', 'const url="?wmsAuthSig%6e=abc123";'],
    ['uppercase hex', 'server/percent-name-upper.js', 'const url="?wmsAuthSig%6E=abc123";'],
    ['split escape', 'server/percent-name-split.js', 'const url="?wmsAuth%"+"53ign=abc123";'],
    ['split hex pair', 'server/percent-name-split-hex.js', 'const url="?wmsAuth%5"+"3ign=abc123";'],
    ['encoded ampersand value', 'server/percent-value-amp.js', 'const url="?wmsAuth%53ign=%26x";'],
    ['encoded hash value', 'server/percent-value-hash.js', 'const url="?wmsAuth%53ign=%23x";'],
    ['encoded JSON key', 'data/percent-key.json', '{"?wmsAuth%53ign=abc123":"x"}'],
  ]) {
    await t.test(name, () => assertSitesPackageRejects(
      path,
      contents,
      /Bundled signed MEO token literal/
    ));
  }
});

test('percent decoding preserves raw query delimiters and direct runtime values', async (t) => {
  for (const [name, source] of [
    ['invalid hex', 'const url="?wms%4GuthSign=abc123";'],
    ['incomplete hex', 'const url="?wms%4uthSign=abc123";'],
    ['incomplete escape', 'const url="?wms%uthSign=abc123";'],
    ['non-ASCII escape', 'const url="?wms%80uthSign=abc123";'],
    ['encoded equals', 'const url="?wmsAuthSign%3Dabc123";'],
    ['encoded question', 'const url="%3FwmsAuthSign=abc123";'],
    ['encoded ampersand', 'const url="?other=x%26wmsAuthSign=abc123";'],
    ['runtime concatenation', 'const url="?wms%41uthSign="+token;'],
    ['runtime template', 'const url=`?wmsAuthSig%6e=${token}`;'],
    ['split runtime value', 'const url="?wmsAuth%5"+"3ign="+token;'],
    ['incomplete percent EOF', 'const url="?wmsAuth%";'],
    ['incomplete nibble EOF', 'const url="?wmsAuth%5";'],
    ['double encoding', 'const url="?wmsAuth%2553ign=abc123";'],
    ['raw ampersand terminator', 'const url="?wmsAuth%53ign=&x=1";'],
    ['raw hash terminator', 'const url="?wmsAuth%53ign=#fragment";'],
  ]) {
    await t.test(name, () => assertSitesPackageAccepts(
      `server/percent-control-${name.replaceAll(' ', '-')}.js`,
      source
    ));
  }
  for (const [name, path, contents] of [
    ['empty raw HTML value', 'percent-empty-raw.html', '<a href="?wmsAuthSign=">camera</a>'],
    ['empty encoded HTML value', 'percent-empty-encoded.html', '<a href="?wmsAuth%53ign=">camera</a>'],
    ['empty raw text value', 'assets/percent-empty-raw.txt', 'url="?wmsAuthSign="'],
    ['empty encoded text value', 'assets/percent-empty-encoded.txt', 'url="?wmsAuth%53ign="'],
  ]) {
    await t.test(name, () => assertSitesPackageAccepts(path, contents));
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
    'Object.defineProperty.call(Object,config,"GOOGLE_CLIENT_ID",{value:"hardcoded"})',
    'Object.defineProperty.apply(Object,[config,"GOOGLE_CLIENT_ID",{value:"hardcoded"}])',
    'Reflect.set.call(Reflect,config,"GOOGLE_CLIENT_ID","hardcoded")',
    'Reflect.set.apply(Reflect,[config,"GOOGLE_CLIENT_ID","hardcoded"])',
    'URLSearchParams.prototype.set.call(params,"wmsAuthSign","abc")',
    'URLSearchParams.prototype.set.apply(params,["wmsAuthSign","abc"])',
    'Object.defineProperty.apply(Object,[config,...["GOOGLE_CLIENT_ID",{value:"hardcoded"}]])',
    'Reflect.set.apply(Reflect,[config,...["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Reflect.set.call(Reflect,...[config,"GOOGLE_CLIENT_ID","hardcoded"])',
    'URLSearchParams.prototype.set.call(params,...["wmsAuthSign","abc"])',
    'Object.defineProperty(...[config,"GOOGLE_CLIENT_ID",{value:"hardcoded"}])',
    'Reflect.set(...[config,"GOOGLE_CLIENT_ID","hardcoded"])',
    'config.set(...["GOOGLE_CLIENT_ID","hardcoded"])',
    'config.setAttribute(...["GOOGLE_CLIENT_ID","hardcoded"])',
    'Reflect.set.call(Reflect,...runtimeArgs,config,"GOOGLE_CLIENT_ID","hardcoded")',
    'Object.defineProperty.apply(Object,[...runtimeArgs,config,"GOOGLE_CLIENT_ID",{value:"hardcoded"}])',
    'URLSearchParams.prototype.set.call(params,...runtimeArgs,"wmsAuthSign","abc")',
    'config.set(...["GOOGLE_CLIENT_ID","hardcoded"].slice())',
    'Reflect.set(...[config,"GOOGLE_CLIENT_ID","hardcoded"].slice())',
    'Object.defineProperty(...[config,"GOOGLE_CLIENT_ID",{value:"hardcoded"}].slice())',
    'URLSearchParams.prototype.set.call(params,...["wmsAuthSign","abc"].slice())',
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
    'evil.Reflect.set(config, "GOOGLE_CLIENT_ID", "hardcoded")',
    'Object.defineProperty.call(Object,config,"GOOGLE_CLIENT_ID",{value:env.GOOGLE_CLIENT_ID})',
    'Object.defineProperty.apply(Object,[config,"GOOGLE_CLIENT_ID",{value:env.GOOGLE_CLIENT_ID}])',
    'Reflect.set.call(Reflect,config,"GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID)',
    'Reflect.set.apply(Reflect,[config,"GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])',
    'URLSearchParams.prototype.set.call(params,"wmsAuthSign",token)',
    'URLSearchParams.prototype.set.apply(params,["wmsAuthSign",token])',
    'Object.defineProperty.apply(Object,[config,...["GOOGLE_CLIENT_ID",{value:env.GOOGLE_CLIENT_ID}]])',
    'Reflect.set.apply(Reflect,[config,...["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Reflect.set.call(Reflect,...[config,"GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])',
    'URLSearchParams.prototype.set.call(params,...["wmsAuthSign",token])',
    'Object.defineProperty(...[config,"GOOGLE_CLIENT_ID",{value:env.GOOGLE_CLIENT_ID}])',
    'Reflect.set(...[config,"GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])',
    'config.set(...["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])',
    'config.setAttribute(...["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])',
    'config.set(...runtimeArgs)',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('the bundle credential scan inspects standard protected key-value carriers', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{value:"hardcoded"})',
    'Object.defineProperty(config,"BOOTSTRAP_OWNER_EMAIL",{value:env.email||"owner@example.com"})',
    'Reflect.defineProperty(config,"OPENAI_SITES_SOURCE_TOKEN",{value:condition?env.token:"hardcoded"})',
    'globalThis.Reflect.defineProperty(config,"wmsAuthSign",{value:"abc123"})',
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{[condition?"value":"other"]:"hardcoded"})',
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{get(){return "hardcoded"}})',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries(Object.entries({GOOGLE_CLIENT_ID:"hardcoded"}))',
    'Object.fromEntries([[flag?"GOOGLE_CLIENT_ID":"other","hardcoded"]])',
    'Object.fromEntries([[flag&&"OPENAI_SITES_SOURCE_TOKEN","hardcoded"]])',
    'Object.fromEntries([[(flag?"GOOGLE_":"OTHER_")+"CLIENT_ID","hardcoded"]])',
    'Object.fromEntries([[`${flag?"GOOGLE_":"OTHER_"}CLIENT_ID`,"hardcoded"]])',
    'Object.fromEntries([[{toString(){return "GOOGLE_CLIENT_ID"}},"hardcoded"]])',
    'Object.fromEntries([[runtimePrefix+"CLIENT_ID","hardcoded"]])',
    'Object.fromEntries([[(runtimeKey+="CLIENT_ID"),"hardcoded"]])',
    'Object.fromEntries([[(runtimeKey-="x"),"hardcoded"]])',
    'Object.fromEntries([new Array("GOOGLE_CLIENT_ID","hardcoded")])',
    'Object.fromEntries([new Array(...["GOOGLE_CLIENT_ID","hardcoded"])])',
    'Object.fromEntries([Array.of("GOOGLE_CLIENT_ID","hardcoded")])',
    'Object.fromEntries([["OPENAI_SITES_SOURCE_TOKEN"].concat(["hardcoded"])])',
    'Object.fromEntries([runtimeTuple.concat(["GOOGLE_CLIENT_ID","hardcoded"])])',
    'Object.fromEntries([runtimeTuple.concat("GOOGLE_CLIENT_ID","hardcoded")])',
    'Object.fromEntries([runtimeTuple.concat(["GOOGLE_CLIENT_ID"],runtimeValues,["hardcoded"])])',
    'Object.fromEntries([flag?["GOOGLE_CLIENT_ID","hardcoded"]:["other","x"]])',
    'Object.fromEntries([(observe(),["GOOGLE_CLIENT_ID","hardcoded"])])',
    'Object.fromEntries([(entry=["GOOGLE_CLIENT_ID","hardcoded"],entry)])',
    'Object.fromEntries([flag&&["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries([...[["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries([[...["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",...env.values,"hardcoded"]])',
    'Object.fromEntries([[...env.parts,"GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries(Array.of(...[["GOOGLE_CLIENT_ID","hardcoded"]]))',
    'Object.fromEntries([...buildEntries()])',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].concat([["OTHER","x"]]))',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].slice())',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].sort())',
    'Object.fromEntries([["OPENAI_SITES_SOURCE_TOKEN","hardcoded"]].filter(Boolean))',
    'Object.fromEntries(wrap([["OPENAI_SITES_SOURCE_TOKEN",env.token||"hardcoded"]]))',
    'Object.fromEntries((function*(){yield ["GOOGLE_CLIENT_ID","hardcoded"]})())',
    'Object.fromEntries((function*(){yield ["GOOGLE_CLIENT_ID","hardcoded"]}).call(null))',
    'Object.fromEntries((function*(){yield ["GOOGLE_CLIENT_ID","hardcoded"]}).bind(null)())',
    'Object.fromEntries(Reflect.apply(function*(){yield ["GOOGLE_CLIENT_ID","hardcoded"]},null,[]))',
    'Object.fromEntries(buildEntries())',
    'Object.fromEntries(parts.map(()=>["GOOGLE_CLIENT_ID","hardcoded"]))',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].map(runtimeMapper))',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].map((entry)=>entry))',
    'Object.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]].map(([key,value])=>[key,value]))',
    'Object.fromEntries([1].map(function*(){yield "GOOGLE_CLIENT_ID";yield "hardcoded"}))',
    'Object.fromEntries(parts.map((part)=>{const entry=["GOOGLE_CLIENT_ID","hardcoded"];return entry}))',
    'Object.fromEntries([undefined].map((entry=["GOOGLE_CLIENT_ID","hardcoded"])=>entry))',
    'Object.fromEntries([{}].map(({entry=["OPENAI_SITES_SOURCE_TOKEN","hardcoded"]})=>entry))',
    'Object.fromEntries(entryTag`entries`)',
    'Object.fromEntries((function*(){yield ["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]})())',
    'Object.fromEntries((function*(){yield ["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]}).call(null))',
    'Object.fromEntries.call(Object,[["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries.apply(Object,[[["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries(...runtimeArgs,[["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries.call(Object,...runtimeArgs,[["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries.apply(Object,[...runtimeArgs,[["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries(...[[["GOOGLE_CLIENT_ID","hardcoded"]]].slice())',
    'Object.fromEntries.apply(Object,[...[[["GOOGLE_CLIENT_ID","hardcoded"]]].slice()])',
    'Reflect.apply(Object.fromEntries,Object,[[["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'globalThis.Reflect.apply(Object.fromEntries,Object,[[["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries.bind(Object)([["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries(new (class {*[Symbol.iterator](){yield ["GOOGLE_CLIENT_ID","hardcoded"]}})())',
    'Object.fromEntries([{*[Symbol.iterator](){yield "GOOGLE_CLIENT_ID";yield "hardcoded"}}])',
    'Object.fromEntries([{0:"GOOGLE_CLIENT_ID",1:"hardcoded",length:2,[Symbol.iterator]:Array.prototype[Symbol.iterator]}])',
    'Object.fromEntries([entryTag`ordinary`])',
    'Object.fromEntries([["ordinary","?wmsAuthSign=abc"]])',
    'new URLSearchParams([["wmsAuthSign","abc123"]])',
    'new URLSearchParams([[flag?"wmsAuthSign":"other","abc123"]])',
    'new URLSearchParams([[(flag?"wmsAuth":"other")+"Sign","abc123"]])',
    'new URLSearchParams([[{toString(){return "wmsAuthSign"}},"abc123"]])',
    'new URLSearchParams([[`${runtimePrefix}Sign`,"abc123"]])',
    'new URLSearchParams([[(runtimeKey||="wmsAuthSign"),"abc123"]])',
    'new URLSearchParams([Array.of("wmsAuthSign","abc123")])',
    'new URLSearchParams([Array.of(...["wmsAuthSign","abc123"])])',
    'new URLSearchParams([["wmsAuthSign","abc"]].concat([["other","x"]]))',
    'new URLSearchParams([runtimeTuple.concat(["wmsAuthSign","abc"])])',
    'new URLSearchParams([runtimeTuple.concat(["wmsAuthSign"],runtimeValues,["abc"])])',
    'new URLSearchParams([flag?["wmsAuthSign","abc"]:["other","x"]])',
    'new URLSearchParams([(entry=["wmsAuthSign","abc"])])',
    'new URLSearchParams([flag&&["wmsAuthSign","abc"]])',
    'new URLSearchParams([...[["wmsAuthSign","abc"]]])',
    'new URLSearchParams([[...["wmsAuthSign","abc"]]])',
    'new URLSearchParams([["wmsAuthSign",...env.values,"abc"]])',
    'new URLSearchParams([[...env.parts,"wmsAuthSign","abc"]])',
    'new URLSearchParams(Array(...[["wmsAuthSign","abc"]]))',
    'new URLSearchParams([...buildQuery()])',
    'new URLSearchParams({[flag?"GOOGLE_CLIENT_ID":"other"]:"hardcoded"})',
    'new URLSearchParams({[flag?"wmsAuthSign":"other"]:"abc"})',
    'new URLSearchParams({[flag&&"OPENAI_SITES_SOURCE_TOKEN"]:"hardcoded"})',
    'new URLSearchParams({[`${flag?"OPENAI_SITES_":"OTHER_"}SOURCE_TOKEN`]:"hardcoded"})',
    'new URLSearchParams({[{toString(){return "OPENAI_SITES_SOURCE_TOKEN"}}]:"hardcoded"})',
    'new URLSearchParams([["wmsAuthSign","abc"]].values())',
    'new URLSearchParams([["wmsAuthSign","abc"]].sort())',
    'new URLSearchParams((function*(){yield ["wmsAuthSign","abc123"]})())',
    'new URLSearchParams((function*(){yield ["wmsAuthSign","abc123"]}).apply(null))',
    'new URLSearchParams((function*(){yield ["wmsAuthSign","abc123"]}).bind(null)())',
    'new URLSearchParams(Reflect.apply(function*(){yield ["wmsAuthSign","abc123"]},null,[]))',
    'new URLSearchParams(buildQuery())',
    'new URLSearchParams(parts.map(()=>["wmsAuthSign","abc123"]))',
    'new URLSearchParams([["wmsAuthSign","abc123"]].map(runtimeMapper))',
    'new URLSearchParams([["wmsAuthSign","abc123"]].map((entry)=>entry))',
    'new URLSearchParams([["wmsAuthSign","abc123"]].map(([key,value])=>[key,value]))',
    'new URLSearchParams([1].map(function*(){yield "wmsAuthSign";yield "abc123"}))',
    'new URLSearchParams(parts.map((part)=>{const entry=["wmsAuthSign","abc123"];return entry}))',
    'new URLSearchParams([[undefined,undefined]].map(([key="wmsAuthSign",value="abc123"])=>[key,value]))',
    'new URLSearchParams(entryTag`entries`)',
    'new URLSearchParams((function*(){yield ["wmsAuthSign",token]})())',
    'new URLSearchParams((function*(){yield ["wmsAuthSign",token]}).apply(null))',
    'new URLSearchParams(new (class {*[Symbol.iterator](){yield ["wmsAuthSign","abc123"]}})())',
    'new URLSearchParams([{*[Symbol.iterator](){yield "wmsAuthSign";yield "abc123"}}])',
    'new URLSearchParams([entryTag`ordinary`])',
    'new URLSearchParams({*[Symbol.iterator](){yield ["BOOTSTRAP_OWNER_EMAIL","owner@example.com"]}})',
    'new URLSearchParams({*[Symbol["iterator"]](){yield ["wmsAuthSign","abc123"]}})',
    'new URLSearchParams({*[globalThis.Symbol.iterator](){yield ["OPENAI_SITES_SOURCE_TOKEN","hardcoded"]}})',
    'new URLSearchParams({*[Symbol.iterator](){yield ["BOOTSTRAP_OWNER_EMAIL",env.email]}})',
    'new URLSearchParams({*[Symbol["iterator"]](){yield ["wmsAuthSign",token]}})',
    'new URLSearchParams({*[globalThis.Symbol.iterator](){yield ["OPENAI_SITES_SOURCE_TOKEN",env.token]}})',
    'new URLSearchParams({get [Symbol.iterator](){return function*(){yield ["wmsAuthSign","abc"]}}})',
    'Object.fromEntries({get [Symbol.iterator](){return function*(){yield ["GOOGLE_CLIENT_ID","hardcoded"]}}})',
    'new URLSearchParams({[Symbol.iterator](){return {next(){return {done:false,value:["wmsAuthSign","abc"]}}}}})',
    'new URLSearchParams(wrap([["BOOTSTRAP_OWNER_EMAIL",condition?env.email:"owner@example.com"]]))',
    'new URLSearchParams("wmsAuthSign=abc123")',
    'new URLSearchParams("GOOGLE_CLIENT_ID=hardcoded")',
    'new URLSearchParams("BOOTSTRAP_OWNER_EMAIL=owner@example.com")',
    'new URLSearchParams("OPENAI_SITES_SOURCE_TOKEN=hardcoded")',
    'new URLSearchParams(...["GOOGLE_CLIENT_ID=hardcoded"])',
    'new URLSearchParams(...["GOOGLE_CLIENT_ID=hardcoded"].slice())',
    'Reflect.construct(URLSearchParams,[[["wmsAuthSign","abc"]]])',
    'Reflect.apply(URLSearchParams,null,[[["wmsAuthSign","abc"]]])',
    'URLSearchParams.bind(null)([["wmsAuthSign","abc"]])',
    'new URLSearchParams(flag?"GOOGLE_CLIENT_ID=hardcoded":"other=x")',
    'new URLSearchParams("GOOGLE_CLIENT_ID="+(flag?env.ID:"hardcoded"))',
    'new URLSearchParams("BOOTSTRAP_OWNER_EMAIL="+(env.email||"owner@example.com"))',
    'new URLSearchParams(flag?"wmsAuthSign=abc":"other=x")',
    'new URLSearchParams("wmsAuthSign="+(flag?token:"abc"))',
    'new URLSearchParams(`GOOGLE_CLIENT_ID=${flag?env.ID:"hardcoded"}`)',
    'new URLSearchParams("wmsAuth%53ign="+(flag?token:"abc"))',
    'new URLSearchParams("other="+x+"&OPENAI_SITES_SOURCE_TOKEN="+(flag?env.token:"hardcoded"))',
    'new URLSearchParams("GOOGLE_CLIENT_ID=".concat("hardcoded"))',
    'new URLSearchParams("BOOTSTRAP_OWNER_EMAIL=".concat("","owner@example.com"))',
    'new URLSearchParams(["OPENAI_SITES_SOURCE_TOKEN=","hardcoded"].join(""))',
    'new URLSearchParams(["GOOGLE_","CLIENT_ID=hardcoded"].join(""))',
    'new URLSearchParams("GOOGLE_".concat("CLIENT_ID=hardcoded"))',
    'new URLSearchParams("GOOGLE_CLIENT_ID=".concat(null))',
    'new URLSearchParams(["GOOGLE_","CLIENT_ID=",flag?env.ID:"hardcoded"].join(""))',
    'new URLSearchParams(["GOOGLE_CLIENT_ID=",""].join("hardcoded"))',
    'new URLSearchParams(["wmsAuthSign=",""].join("abc"))',
    'new URLSearchParams(["BOOTSTRAP_OWNER_EMAIL=",""].join())',
    'new URLSearchParams(["GOOGLE_CLIENT_ID=",""].join(null))',
    'new URLSearchParams("GOOGLE_CLIENT_ID=hardcoded".slice(0))',
    'new URLSearchParams("wmsAuthSign=abc".toString())',
    'new URLSearchParams("BOOTSTRAP_OWNER_EMAIL=owner@example.com".replace("owner","owner"))',
    'new URLSearchParams(runtimePrefix+"GOOGLE_CLIENT_ID=hardcoded")',
    'new URLSearchParams(`${runtimePrefix}GOOGLE_CLIENT_ID=hardcoded`)',
    'new URLSearchParams(runtimePrefix+"GOOGLE_"+"CLIENT_ID=hardcoded")',
    'new URLSearchParams(runtimePrefix+"&GOOGLE_"+"CLIENT_ID=hardcoded")',
    'new URLSearchParams(`${runtimePrefix}GOOGLE_${""}CLIENT_ID=hardcoded`)',
    'new URLSearchParams(runtimePrefix+"wmsAuth"+"Sign=abc")',
    'new URLSearchParams(runtimePrefix+"OPENAI_SITES_"+"SOURCE_TOKEN=hardcoded")',
    'new URLSearchParams((flag?"GOOGLE_":"OTHER_")+"CLIENT_ID=hardcoded")',
    'new URLSearchParams((flag?"wmsAuth":"other")+"Sign=abc")',
    'new URLSearchParams((flag?"OPENAI_SITES_":"OTHER_")+"SOURCE_TOKEN=hardcoded")',
    'new URLSearchParams((flag?"GOO".concat("GLE_"):"OTHER_")+"CLIENT_ID=hardcoded")',
    'new URLSearchParams((flag?["GOO","GLE_"].join(""):"OTHER_")+"CLIENT_ID=hardcoded")',
    'new URLSearchParams((flag?"GOO":"wmsAuth")+"Sign=abc")',
    'new URLSearchParams((flag?"wms":"GOOGLE_")+"CLIENT_ID=hardcoded")',
    'Object.fromEntries([["ordinary",class {method(){return ["GOOGLE_CLIENT_ID","hardcoded"]}}]])',
    'new URLSearchParams([["ordinary","?wmsAuthSign=abc"]])',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{value:env.GOOGLE_CLIENT_ID})',
    'Reflect.defineProperty(config,"OPENAI_SITES_SOURCE_TOKEN",{value:env.sourceToken})',
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{[condition?"value":"other"]:env.GOOGLE_CLIENT_ID})',
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",{get:runtimeGetter})',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries([[flag?"GOOGLE_CLIENT_ID":"other",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries([[flag&&"OPENAI_SITES_SOURCE_TOKEN",env.token]])',
    'Object.fromEntries([[(flag?"GOOGLE_":"OTHER_")+"CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries([[`${flag?"GOOGLE_":"OTHER_"}CLIENT_ID`,env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries([[runtimeKey,"hardcoded"]])',
    'Object.fromEntries([[(runtimeKey="ordinary"),"hardcoded"]])',
    'Object.fromEntries([[null,"hardcoded"]])',
    'Object.fromEntries([new Array("GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID)])',
    'Object.fromEntries([new Array(...["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID])])',
    'Object.fromEntries([Array.of("GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID)])',
    'Object.fromEntries([["OPENAI_SITES_SOURCE_TOKEN"].concat([env.token])])',
    'Object.fromEntries([runtimeTuple.concat(["GOOGLE_CLIENT_ID",env.ID])])',
    'Object.fromEntries([runtimeTuple.concat("GOOGLE_CLIENT_ID",env.ID)])',
    'Object.fromEntries([runtimeTuple.concat(["GOOGLE_CLIENT_ID"],runtimeValues)])',
    'Object.fromEntries([flag?["GOOGLE_CLIENT_ID",env.ID]:["other","x"]])',
    'Object.fromEntries([(observe(),["GOOGLE_CLIENT_ID",env.ID])])',
    'Object.fromEntries([(entry=["GOOGLE_CLIENT_ID",env.ID],entry)])',
    'Object.fromEntries([flag&&["GOOGLE_CLIENT_ID",env.ID]])',
    'Object.fromEntries([...[["GOOGLE_CLIENT_ID",env.ID]]])',
    'Object.fromEntries([[...["GOOGLE_CLIENT_ID",env.ID]]])',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",...env.values]])',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",...env.values,env.ID]])',
    'Object.fromEntries(Array.of(...[["GOOGLE_CLIENT_ID",env.ID]]))',
    'Object.fromEntries([...entries])',
    'Object.fromEntries([entry])',
    'Object.fromEntries([()=>["GOOGLE_CLIENT_ID","hardcoded"]])',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]].concat([["OTHER","x"]]))',
    'Object.fromEntries([["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]].slice())',
    'Object.fromEntries([["OPENAI_SITES_SOURCE_TOKEN",env.token]].filter(Boolean))',
    'Object.fromEntries.call(Object,[["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries.apply(Object,[[["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]]])',
    'Object.fromEntries(...runtimeArgs,[["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries.call(Object,...runtimeArgs,[["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]])',
    'Object.fromEntries.apply(Object,[...runtimeArgs,[["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID]]])',
    'Object.fromEntries(...env.args)',
    'Reflect.apply(Object.fromEntries,Object,[env.entries])',
    'globalThis.Reflect.apply(Object.fromEntries,Object,[env.entries])',
    'Object.fromEntries.bind(Object)(env.entries)',
    'Object.fromEntries([["?wmsAuthSign=","abc"]])',
    'Object.fromEntries.apply(Object,[[["?wmsAuthSign=","abc"]]])',
    'new URLSearchParams([["wmsAuthSign",token]])',
    'new URLSearchParams([[flag?"wmsAuthSign":"other",token]])',
    'new URLSearchParams([[(flag?"wmsAuth":"other")+"Sign",token]])',
    'new URLSearchParams([[env.key,"abc123"]])',
    'new URLSearchParams([[(runtimeKey="ordinary"),"abc123"]])',
    'new URLSearchParams([[null,"abc123"]])',
    'new URLSearchParams([["wmsAuthSign=","abc123"]])',
    'new URLSearchParams([["?wmsAuthSign=","abc123"]])',
    'new URLSearchParams({"&wmsAuthSign=":"abc123"})',
    'new URLSearchParams(new Map([["?wmsAuthSign=","abc123"]]))',
    'new URLSearchParams(Array.of(["?wmsAuthSign=","abc123"]).slice())',
    'new URLSearchParams(Object.entries({"?wmsAuthSign=":"abc123"}))',
    'new URLSearchParams(parts.map(()=>["?wmsAuthSign=","abc123"]))',
    'Reflect.construct(URLSearchParams,[[["?wmsAuthSign=","abc123"]]])',
    'URLSearchParams.bind(null)([["?wmsAuthSign=","abc123"]])',
    'new URLSearchParams([["wmsAuth%53ign=","abc123"]])',
    'new URLSearchParams([["GOOGLE_CLIENT_ID=","hardcoded"]])',
    'new URLSearchParams([["OPENAI_SITES_SOURCE_TOKEN=","hardcoded"]])',
    'new URLSearchParams(Array.of(["GOOGLE_CLIENT_ID=","hardcoded"]))',
    'new URLSearchParams([["wmsAuthSign=","abc123"]].slice())',
    'new URLSearchParams([["wmsAuthSign=","abc123"]].sort())',
    'new URLSearchParams([Array.of("wmsAuthSign",token)])',
    'new URLSearchParams([Array.of(...["wmsAuthSign",token])])',
    'new URLSearchParams([["wmsAuthSign",token]].concat([["other","x"]]))',
    'new URLSearchParams([runtimeTuple.concat(["wmsAuthSign",token])])',
    'new URLSearchParams([runtimeTuple.concat(["wmsAuthSign"],runtimeValues)])',
    'new URLSearchParams([flag?["wmsAuthSign",token]:["other","x"]])',
    'new URLSearchParams([(entry=["wmsAuthSign",token])])',
    'new URLSearchParams([flag&&["wmsAuthSign",token]])',
    'new URLSearchParams([...[["wmsAuthSign",token]]])',
    'new URLSearchParams([[...["wmsAuthSign",token]]])',
    'new URLSearchParams([["wmsAuthSign",...env.values]])',
    'new URLSearchParams([["wmsAuthSign",...env.values,token]])',
    'new URLSearchParams(Array(...[["wmsAuthSign",token]]))',
    'new URLSearchParams([...env.entries])',
    'new URLSearchParams([entry])',
    'new URLSearchParams([function inert(){return ["wmsAuthSign","abc123"]}])',
    'new URLSearchParams({[flag?"GOOGLE_CLIENT_ID":"other"]:env.ID})',
    'new URLSearchParams({[flag?"wmsAuthSign":"other"]:token})',
    'new URLSearchParams({[flag&&"OPENAI_SITES_SOURCE_TOKEN"]:env.token})',
    'new URLSearchParams({[`${flag?"OPENAI_SITES_":"OTHER_"}SOURCE_TOKEN`]:env.token})',
    'new URLSearchParams({[runtimeKey]:"hardcoded"})',
    'new URLSearchParams({[null]:"hardcoded"})',
    'new URLSearchParams({"GOOGLE_CLIENT_ID=":"hardcoded"})',
    'new URLSearchParams({"OPENAI_SITES_SOURCE_TOKEN=":"hardcoded"})',
    'config.set("?wmsAuthSign=","abc123")',
    'Reflect.set.call(Reflect,config,"?wmsAuthSign=","abc123")',
    'Object.defineProperty.apply(Object,[config,"?wmsAuthSign=",{value:"abc123"}])',
    'new URLSearchParams(Object.entries({"wmsAuthSign=":"abc123"}).sort())',
    'new URLSearchParams([["wmsAuthSign",token]].values())',
    'Object.defineProperty(config,"GOOGLE_CLIENT_ID",descriptor)',
    'Object.fromEntries(entries)',
    'Object.fromEntries(parts.map((part)=>[part.type,part.value]))',
    'Object.fromEntries(parts.map(runtimeMapper))',
    'Object.fromEntries(parts.map((entry)=>entry))',
    'Object.fromEntries(Object.entries(records).map(([key,value])=>[key,value]))',
    'Object.fromEntries(Object.entries(records).sort(([a],[b])=>Number(a)-Number(b)))',
    'Object.fromEntries(env.entries)',
    'new URLSearchParams(query)',
    'new URLSearchParams(parts.map((part)=>[part.type,part.value]))',
    'new URLSearchParams(parts.map(runtimeMapper))',
    'new URLSearchParams(parts.map((entry)=>entry))',
    'new URLSearchParams(env.query)',
    'new URLSearchParams("GOOGLE_CLIENT_ID="+env.ID)',
    'new URLSearchParams("wmsAuthSign="+token)',
    'new URLSearchParams(`GOOGLE_CLIENT_ID=${env.ID}`)',
    'new URLSearchParams("wmsAuth%53ign="+token)',
    'new URLSearchParams("other="+x+"&OPENAI_SITES_SOURCE_TOKEN="+env.token)',
    'new URLSearchParams(...["GOOGLE_CLIENT_ID="+env.ID])',
    'new URLSearchParams(...env.args)',
    'Reflect.construct(URLSearchParams,[env.query])',
    'Reflect.apply(URLSearchParams,null,[env.query])',
    'URLSearchParams.bind(null)(env.query)',
    'new URLSearchParams("GOOGLE_CLIENT_ID=".concat(env.ID))',
    'new URLSearchParams("BOOTSTRAP_OWNER_EMAIL=".concat("",env.email))',
    'new URLSearchParams(["OPENAI_SITES_SOURCE_TOKEN=",env.token].join(""))',
    'new URLSearchParams(["GOOGLE_","CLIENT_ID=",env.ID].join(""))',
    'new URLSearchParams("GOOGLE_".concat("CLIENT_ID=",env.ID))',
    'new URLSearchParams(["GOOGLE_CLIENT_ID=",env.ID].join(""))',
    'new URLSearchParams(["GOOGLE_CLIENT_ID=",""].join(separator))',
    'Object.defineProperty(config,"OTHER",{value:"hardcoded"})',
    'Object.fromEntries([["OTHER","hardcoded"]])',
    'new URLSearchParams([["other","abc123"]])',
    'new URLSearchParams("other=abc123")',
    'new URLSearchParams(runtimePrefix+"ordinary=x")',
    'new URLSearchParams(`${runtimePrefix}ordinary=x`)',
    'new URLSearchParams(runtimePrefix+"GOOGLE_"+"CLIENT_ID="+env.ID)',
    'new URLSearchParams(`${runtimePrefix}GOOGLE_${""}CLIENT_ID=${env.ID}`)',
    'new URLSearchParams(runtimePrefix+"wmsAuth"+"Sign="+token)',
    'new URLSearchParams(runtimePrefix+"OPENAI_SITES_"+"SOURCE_TOKEN="+env.token)',
    'new URLSearchParams((flag?"ordinary":"other")+"=x")',
    'new URLSearchParams(flag?"GOOGLE_":"ordinary=x")',
    'new URLSearchParams(flag?"wmsAuth":"ordinary=x")',
    'new URLSearchParams(flag?"OPENAI_SITES_":"ordinary=x")',
    'new URLSearchParams(flag?"GOO".concat("GLE_"):"ordinary=x")',
    'new URLSearchParams(flag?["GOO","GLE_"].join(""):"ordinary=x")',
    'custom.fromEntries([["GOOGLE_CLIENT_ID","hardcoded"]])',
    'new CustomSearchParams([["wmsAuthSign","abc123"]])',
    'new custom.URLSearchParams([["wmsAuthSign","abc123"]])',
    'Object.fromEntries([["ordinary",()=>["GOOGLE_CLIENT_ID","hardcoded"]]])',
    'Object.fromEntries([["ordinary",function inert(){return ["OPENAI_SITES_SOURCE_TOKEN","hardcoded"]}]])',
    'Object.fromEntries([["ordinary",{next:"page-2"}]])',
    'Object.fromEntries([["ordinary",{[Symbol.iterator]:env.iterator}]])',
    'new URLSearchParams([["ordinary",{next:env.next}]])',
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
    'GOOGLE_CLIENT_ID=([token]=["hardcoded"],token)',
    'GOOGLE_CLIENT_ID=({x:token}={x:"hardcoded"},token)',
    'config.set("GOOGLE_CLIENT_ID",([env.ID]=["hardcoded"],env.ID))',
    'GOOGLE_CLIENT_ID=([token="hardcoded"]=env.ids,token)',
    'GOOGLE_CLIENT_ID=({x:token="hardcoded"}=env.obj,token)',
    'GOOGLE_CLIENT_ID=({x:token}={x:env.ID,x:"hardcoded"},token)',
    'GOOGLE_CLIENT_ID=({x:token}={x:env.ID,...{x:"hardcoded"}},token)',
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
    'GOOGLE_CLIENT_ID=([token]=[env.ID],token)',
    'GOOGLE_CLIENT_ID=({x:token}={x:env.ID},token)',
    'config.set("GOOGLE_CLIENT_ID",([env.ID]=[config.ID],env.ID))',
    'GOOGLE_CLIENT_ID=([token]=env.ids,token)',
    'GOOGLE_CLIENT_ID=({x:token}=env.obj,token)',
    'GOOGLE_CLIENT_ID=({x:token}={x:"hardcoded",x:env.ID},token)',
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
    'obj["?wmsAuth"+"Sign=abc"].set("ordinary","x")',
    'obj["?wmsAuth"+"Sign=abc"].append("ordinary","x")',
    'obj["?wmsAuth"+"Sign=abc"].setAttribute("ordinary","x")',
    'Reflect.apply(config.set,env["?wmsAuth"+"Sign=abc"],["ordinary","x"])',
    'config.set.call(env["?wmsAuth"+"Sign=abc"],"ordinary","x")',
    'Object.defineProperty.call(env["?wmsAuth"+"Sign=abc"],config,"ordinary",{value:"x"})',
    'Object.fromEntries.call(env["?wmsAuth"+"Sign=abc"],[["ordinary","x"]])',
    'Reflect.construct(URLSearchParams,[[["ordinary","x"]]],env["?wmsAuth"+"Sign=abc"])',
    '(build("?wmsAuth","Sign=abc"),config.set)("ordinary","x")',
    'new URLSearchParams(entries[(env["?wmsAuth"+"Sign=abc"],"slice")]())',
    'Object.fromEntries(entries[(env["?wmsAuth"+"Sign=abc"],"map")](runtimeMapper))',
    'new URLSearchParams(entries[(env["?wmsAuth"+"Sign=abc"],"concat")]([]))',
    'Object.fromEntries[(env["?wmsAuth"+"Sign=abc"],"bind")](Object)([["ordinary","x"]])',
    'URLSearchParams[(env["?wmsAuth"+"Sign=abc"],"bind")](null)([["ordinary","x"]])',
    'config.set[(env["?wmsAuth"+"Sign=abc"],"bind")](config)("ordinary","x")',
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
    'obj[method].set("ordinary","x")',
    'Reflect.apply(config.set,env.context,["ordinary","x"])',
    'config.set.call(env.context,"ordinary","x")',
    'Object.defineProperty.call(env.context,config,"ordinary",{value:"x"})',
    'Object.fromEntries.call(env.context,[["ordinary","x"]])',
    'Reflect.construct(URLSearchParams,[[["ordinary","x"]]],env.Constructor)',
    '(observe(),config.set)("ordinary","x")',
    'new URLSearchParams(entries[(env.method,"slice")]())',
    'Object.fromEntries(entries[(env.method,"map")](runtimeMapper))',
    'new URLSearchParams(entries[(env.method,"concat")]([]))',
    'Object.fromEntries[(env.method,"bind")](Object)([["ordinary","x"]])',
    'URLSearchParams[(env.method,"bind")](null)([["ordinary","x"]])',
    'config.set[(env.method,"bind")](config)("ordinary","x")',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('static sequence results cannot hide evaluated signed-query operands', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'foo[(globalThis.leaked="?wmsAuth"+"Sign=abc","bar")]()',
    'foo[(send("?wmsAuth","Sign=abc"),"bar")]()',
    'foo[(globalThis.leaked=`?wmsAuth${"Sign=abc"}`,"bar")]()',
    'foo((globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'new Foo((globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'foo[((()=>send("?wmsAuth","Sign=abc")),"bar")]()',
    'new Foo((function inert(){return "?wmsAuth"+"Sign=abc"},"bar"))',
    'foo(true?(globalThis.leaked="?wmsAuth"+"Sign=abc","bar"):"x")',
    'foo(true&&(globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'foo(false||(globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'foo(false&&(globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'foo(true||(globalThis.leaked="?wmsAuth"+"Sign=abc","bar"))',
    'foo((class {static {send("?wmsAuth","Sign=abc")}},"bar"))',
    'foo((class extends send("?wmsAuth","Sign=abc") {},"bar"))',
    'foo((class {[(send("?wmsAuth","Sign=abc"),"x")](){}},"bar"))',
    'foo(`${(send("?wmsAuth","Sign=abc"),"x")}`)',
    'foo((send("?wmsAuth","Sign=abc"),"x")+"y")',
    'foo(`${true?"x":send("?wmsAuth","Sign=abc")}`)',
    'foo((true?"x":send("?wmsAuth","Sign=abc"))+"y")',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'false&&("?wmsAuthSign="+token)',
    'true||("?wmsAuthSign="+env.token)',
    '(()=>"?wmsAuthSign="+token)',
    'send("?wmsAuthSign="+runtimeToken)',
    'send(`?wmsAuthSign=${runtimeToken}`)',
    'send("?wmsAuthSign="+env.runtimeToken)',
    'foo(()=>"?wmsAuthSign="+runtimeToken)',
    'foo(class {static value=send("?wmsAuthSign="+runtimeToken)})',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('nested static producers preserve bounded signed-marker progress', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'build("?wmsAuth".concat(),"Sign=abc")',
    'build(["?wmsAuth"].join(""),"Sign=abc")',
    'build("?wmsAuth","Sign".concat("=abc"))',
    'build(new Query("?wmsAuth"),"Sign=abc")',
    'build("?wmsAuth",new Query("Sign=abc"))',
    'build(query`?wmsAuth`,"Sign=abc")',
    'build("?wmsAuth",query`Sign=abc`)',
    'build(runtimePrefix+"?wmsAuth","Sign=abc")',
    'build(`${runtimePrefix}?wmsAuth`,"Sign=abc")',
    'build("?%5","7msAuthSign=abc")',
    'build("?\\t%\\t5\\r7msAuth%53ign=\\n","abc")',
    '"?wmsAuthSign=&wmsAuthSign=abc"',
    '"?wmsAuthSign=".concat(null)',
    '["?wmsAuthSign=",""].join(null)',
    '["?wmsAuth",null,"Sign=abc"].join("")',
    '["?wmsAuth",undefined,"Sign=abc"].join("")',
  ]) {
    await t.test(text, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'build("?wmsAuth"+runtimeSuffix,"Sign=abc")',
    'build(`?wmsAuth${runtimeSuffix}`,"Sign=abc")',
    'build("?wmsAuthSign=".concat(runtimeToken),"ordinary")',
    'build("?%5",token,"7msAuthSign=abc")',
    '"?wmsAuthSign="',
    '"?wmsAuthSign=#fragment"',
    '["?wmsAuthSign=",null].join("")',
  ]) {
    await t.test(text, () => assert.equal(find(text), null));
  }
});

test('static undefined coercion respects lexical shadowing', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '"?wmsAuthSign=".concat(undefined)',
    '"?wmsAuthSign=".concat(void 0)',
    '"?wmsAuthSign=".concat(globalThis.undefined)',
  ]) {
    await t.test(`unshadowed: ${text}`, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'function f(undefined){return "?wmsAuthSign=".concat(undefined)}',
    '(undefined)=>"?wmsAuthSign=".concat(undefined)',
    'function f(){const undefined=token;return "?wmsAuthSign=".concat(undefined)}',
    'function f(){var undefined=token;return "?wmsAuthSign=".concat(undefined)}',
    'function f(){if(flag){let undefined=token;"?wmsAuthSign=".concat(undefined)}}',
    'function f(){let undefined=token;return ["?wmsAuthSign=",undefined].join("")}',
    'try{}catch(undefined){"?wmsAuthSign=".concat(undefined)}',
    'function f(globalThis){return "?wmsAuthSign=".concat(globalThis.undefined)}',
    'import undefined from "fixture";"?wmsAuthSign=".concat(undefined)',
  ]) {
    await t.test(`shadowed: ${text}`, () => assert.equal(find(text), null));
  }
});

test('join flattens known static spreads before inserting separators', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '["?wms",...[],"Sign=abc"].join("Auth")',
    '["?wms",...[...[]],"Sign=abc"].join("Auth")',
    '["?wms",...parts,"Sign=abc"].join("Auth")',
  ]) {
    await t.test(`static empty spread: ${text}`, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    '["?wms",...["x"],"Sign=abc"].join("Auth")',
    '["?wms",...[runtimeToken],"Sign=abc"].join("Auth")',
  ]) {
    await t.test(`nonempty/runtime spread: ${text}`, () => assert.equal(find(text), null));
  }
});

test('finite static slice and concat spreads preserve exact array elements', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    '["?wmsAuth","BLOCK"].slice(0,1).concat(["Sign=abc"]).join("")',
    '["?wmsAuth","BLOCK"].slice(0,1).join("")+"Sign=abc"',
    '["BLOCK","?wmsAuth","Sign=abc"].slice(-2).join("")',
    '["?wmsAuth","Sign=abc","BLOCK"].slice(0,-1).join("")',
    '["?wmsAuth","Sign=abc"].slice(-99,99).join("")',
    '["?wmsAuth","Sign=abc"].slice(undefined).join("")',
    '["?wmsAuth"].concat(...[["Sign=abc"]]).join("")',
    '["?wmsAuth"].concat(...[[...["Sign=abc"]]]).join("")',
    '[["?wmsAuth"],["Sign=abc"]].join("")',
    '[[["?wmsAuth"]],[["Sign=abc"]]].join("")',
    'Array.prototype.slice.call(["?wmsAuth","BLOCK"],0,1).concat(["Sign=abc"]).join("")',
    'Array.prototype.slice.apply(["?wmsAuth","BLOCK"],[0,1]).concat(["Sign=abc"]).join("")',
    'Array.prototype.slice.bind(["?wmsAuth","BLOCK"])(0,1).concat(["Sign=abc"]).join("")',
    'Reflect.apply(Array.prototype.slice,["?wmsAuth","BLOCK"],[0,1]).concat(["Sign=abc"]).join("")',
    'String(["?wmsAuth"])+String(["Sign=abc"])',
    'Array.of("?wmsAuth").concat(Array.of("Sign=abc")).join("")',
    '[["?wmsAuth"],["Sign=abc"]].flat().join("")',
    '["?wmsAuth","BLOCK"].slice(0,end).join("")+"Sign=abc"',
    'String(["?wmsAuth","BLOCK"].slice(0,end))+"Sign=abc"',
    'Array.prototype.join.bind(["?wmsAuth","Sign=abc"]).call(null,"")',
    'Array.prototype.join.bind(["?wmsAuth","Sign=abc"]).apply(null,[""])',
    'Reflect.apply(Array.prototype.join.bind(["?wmsAuth","Sign=abc"]),null,[""])',
    'String.prototype.concat.bind("?wmsAuth").call(null,"Sign=abc")',
    'Array.prototype.join.bind(["?wmsAuth","Sign=abc"]).bind(null)("")',
    '[["?wms"],,["Sign=abc"]].flat().join("Auth")',
    '[[["?wms"]],,[["Sign=abc"]]].flat(2).join("Auth")',
    '["?wms",,"Sign=abc"].flat(0).join("Auth")',
    '["?wms",,["Sign=abc"]].flat().join("Auth")',
    '[["?wms",,"Sign=abc"]].flat().join("Auth")',
    '({part:"?wmsAuth"}).part+"Sign=abc"',
    '["x","?wmsAuth"][1]+"Sign=abc"',
    '({part:["?wmsAuth"]}).part+"Sign=abc"',
    '[["?wmsAuth"]][0]+"Sign=abc"',
    '({a:{b:"?wmsAuth"}}).a.b+"Sign=abc"',
    '({a:[{b:["?wmsAuth"]}]}).a[0].b+"Sign=abc"',
    '({part:"?wmsAuth",...{}}).part+"Sign=abc"',
    '({part:"x",...{part:"?wmsAuth"}}).part+"Sign=abc"',
    '({a:{...{b:["?wmsAuth"]}}}).a.b+"Sign=abc"',
    '({part:"?wmsAuth",...runtimeObject}).part+"Sign=abc"',
    '({...runtimeObject,part:"?wmsAuth"}).part+"Sign=abc"',
    '({__proto__:{part:"?wmsAuth"}}).part+"Sign=abc"',
    '({"__proto__":{part:"?wmsAuth"}}).part+"Sign=abc"',
    '({__proto__:{__proto__:{part:"?wmsAuth"}}}).part+"Sign=abc"',
    '({__proto__:{part:"?wmsAuth"},...runtimeObject}).part+"Sign=abc"',
    '["x",...["?wmsAuth"]][1]+"Sign=abc"',
    '["x"].concat(["?wmsAuth"])[1]+"Sign=abc"',
    '["x","?wmsAuth"].slice(1)[0]+"Sign=abc"',
    'Array.of("x","?wmsAuth")[1]+"Sign=abc"',
    '[["?wmsAuth"]].flat()[0]+"Sign=abc"',
    '({get part(){return "?wmsAuth"}}).part+"Sign=abc"',
    '({part:"safe",get part(){return "?wmsAuth"}}).part+"Sign=abc"',
    '({part:["?wmsAuthSign=",token],get part(){return ["?wms","AuthSign=abc"]}}).part.join("")',
    '"?wmsAuthSign="+({get x(){if(flag)return token}}).x',
    '"?wmsAuthSign="+({get x(){while(flag)return token}}).x',
    '"?wmsAuthSign="+({get x(){if(false)return token}}).x',
    '["?wmsAuth",...runtimeArray].slice(0,1)[0]+"Sign=abc"',
    '["x",...runtimeArray,"?wmsAuth"].slice(-1)[0]+"Sign=abc"',
    '["?wmsAuth"].concat(runtimeArray).slice(0,1)[0]+"Sign=abc"',
    '[runtimeArray,"?wmsAuth"].flat().slice(-1)[0]+"Sign=abc"',
    '[["?wms","Auth"],...runtimeArray,["Sign=abc"]].slice(start,end).flat().join("")',
    '[...parts,"?wmsAuth"][0]+"Sign=abc"',
    '["x",...parts,"?wmsAuth"][1]+"Sign=abc"',
    '["x"].concat(runtimeArray,["?wmsAuth"])[1]+"Sign=abc"',
    '[runtimeArray,"?wmsAuth"].flat()[0]+"Sign=abc"',
    'Array.of(runtimeArray,"?wmsAuth").flat()[0]+"Sign=abc"',
    '({...[...parts,"?wmsAuth"]})["0"]+"Sign=abc"',
    'Array.prototype.join.call({0:"?wms",1:"Auth",2:"Sign=abc",length:3},"")',
    '["?wms","Sign=abc"].join(["Auth"])',
    '["?wms","Sign=abc"].join([["Auth"]])',
    '["?wms","Sign=abc"].join(Array.of("Auth"))',
    '["?wms","Sign=abc"].join(["Auth","BLOCK"].slice(0,1))',
    '["?wmsAuth"]+["Sign=abc"]',
    '`${["?wmsAuth"]}${["Sign=abc"]}`',
    '["?wmsAuth"]+"Sign=abc"',
    'String.prototype.concat.call("",["?wmsAuth"],["Sign=abc"])',
    '"?wms".concat(["Auth"],"Sign=abc")',
    'Array.prototype.join.apply(["?wmsAuthSign=",""],[,])',
    'Reflect.apply(Array.prototype.join,["?wmsAuthSign=",""],[,])',
    'String.prototype.concat.apply("?wmsAuthSign=",[,])',
    '["?wms"].concat(runtimeArray,["Auth","Sign=abc"]).join("")',
    'Array.prototype.concat.call(["?wms"],runtimeArray,["Auth","Sign=abc"]).join("")',
    '["?wms",runtimeArray,"Auth","Sign=abc"].flat().join("")',
  ]) {
    await t.test(`static: ${text}`, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    '["SAFE","?wmsAuth","Sign=abc"].slice(0,1).join("")',
    '["?wmsAuth","BLOCK","Sign=abc"].slice(1).join("")',
    '["?wmsAuth","Sign=abc"].slice(0,1).join("")',
    '["?wmsAuth","BLOCK"].slice(-1).join("")+"Sign=abc"',
    '["?wmsAuth"].concat(...[[token]]).join("")',
    '[["?wmsAuthSign="],[token]].join("")',
    'Array.prototype.slice.call(["SAFE","?wmsAuth","Sign=abc"],0,1).join("")',
    'String(["?wmsAuthSign="+token])',
    'Array.of("?wmsAuthSign=",token).join("")',
    '[["?wmsAuthSign="],[token]].flat().join("")',
    'runtimeParts.slice(0,end).join("")',
    'Array.prototype.join.bind(["?wmsAuthSign=",token]).call(null,"")',
    'String.prototype.concat.bind("?wmsAuthSign=").call(null,token)',
    '["?wms",,"Sign=abc"].slice().join("Auth")',
    '["?wms",,"Sign=abc"].concat([]).join("Auth")',
    '["?wms",...[,"Sign=abc"]].flat(0).join("Auth")',
    '({part:runtimePrefix}).part+"Sign=abc"',
    'parts[1]+"Sign=abc"',
    '({part:runtimeParts}).part+"Sign=abc"',
    'runtimeRoot.a.b+"Sign=abc"',
    '({a:runtimeRoot}).a.b+"Sign=abc"',
    '({part:[runtimePrefix],...{}}).part+"Sign=abc"',
    '({part:"x",...{part:[runtimePrefix]}}).part+"Sign=abc"',
    '({part:runtimePrefix,...runtimeObject}).part+"Sign=abc"',
    '({__proto__:{part:runtimePrefix}}).part+"Sign=abc"',
    '({__proto__:null}).part+"Sign=abc"',
    '({__proto__:runtimePrototype}).part+"Sign=abc"',
    '({["__proto__"]:{part:"?wmsAuth"}}).part+"Sign=abc"',
    '({...{__proto__:{part:"?wmsAuth"}}}).part+"Sign=abc"',
    '["x",...[runtimePrefix]][1]+"Sign=abc"',
    '["x"].concat([runtimePrefix])[1]+"Sign=abc"',
    '["x",runtimePrefix].slice(1)[0]+"Sign=abc"',
    'Array.of("x",runtimePrefix)[1]+"Sign=abc"',
    '[[runtimePrefix]].flat()[0]+"Sign=abc"',
    '({get part(){return runtimePrefix}}).part+"Sign=abc"',
    '({set part(value){}}).part+"Sign=abc"',
    '({part:"?wmsAuth",set part(value){}}).part+"Sign=abc"',
    '({get part(){return [runtimePrefix]}}).part.join("")',
    '"?wmsAuthSign="+({get x(){return token}}).x',
    '"?wmsAuthSign="+({get x(){if(flag)return token;return fallbackToken}}).x',
    '"?wmsAuthSign="+({get x(){if(false)return token;return fallbackToken}}).x',
    '["safe",...runtimeArray].slice(0,1)[0]+"Sign=abc"',
    '["x",...runtimeArray,runtimePrefix].slice(-1)[0]+"Sign=abc"',
    '["safe"].concat(runtimeArray).slice(0,1)[0]+"Sign=abc"',
    '[runtimeArray,runtimePrefix].flat().slice(-1)[0]+"Sign=abc"',
    '[[runtimePrefix],...runtimeArray,[runtimeSuffix]].slice(start,end).flat().join("")',
    '[...[runtimeToken],"?wmsAuth"][0]+"Sign=abc"',
    '["x",...[runtimeToken],"?wmsAuth"][1]+"Sign=abc"',
    '["x"].concat([runtimeToken],["?wmsAuth"])[1]+"Sign=abc"',
    '[[runtimeToken],"?wmsAuth"].flat()[0]+"Sign=abc"',
    'Array.of([runtimeToken],"?wmsAuth").flat()[0]+"Sign=abc"',
    '({...[... [runtimeToken],"?wmsAuth"]})["0"]+"Sign=abc"',
    'Array.prototype.join.call(runtimeArrayLike,"")',
    '["?wms","Sign=abc"].join([separator])',
    'runtimeParts+"Sign=abc"',
    '[runtimePrefix]+"Sign=abc"',
    '`${runtimeParts}Sign=abc`',
    '"?wmsAuthSign="+[token]',
    '["?wms"].concat([runtimeToken],["Auth","Sign=abc"]).join("")',
    'Array.prototype.concat.call(["?wms"],[runtimeToken],["Auth","Sign=abc"]).join("")',
    '["?wms",[runtimeToken],"Auth","Sign=abc"].flat().join("")',
  ]) {
    await t.test(`safe/runtime: ${text}`, () => assert.equal(find(text), null));
  }
});

test('finite standard join and concat invocation wrappers preserve static output', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'Array.prototype.join.call(["?wms","Sign=abc"],"Auth")',
    'Array.prototype.join.apply(["?wms","Sign=abc"],["Auth"])',
    'Array.prototype.join.bind(["?wms","Sign=abc"])("Auth")',
    'Reflect.apply(Array.prototype.join,["?wms","Sign=abc"],["Auth"])',
    'String.prototype.concat.call("?wmsAuth","Sign=abc")',
    'String.prototype.concat.apply("?wmsAuth",["Sign=abc"])',
    'String.prototype.concat.bind("?wmsAuth")("Sign=abc")',
    'Reflect.apply(String.prototype.concat,"?wmsAuth",["Sign=abc"])',
    '["?wmsAuth","Sign=abc"].slice().join("")',
    '["?wmsAuth"].concat(["Sign=abc"]).join("")',
    'Array.prototype.join.call(["?wmsAuth","Sign=abc"].slice(),"")',
  ]) {
    await t.test(`static: ${text}`, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'Array.prototype.join.call(["?wmsAuthSign=",token],"")',
    'Array.prototype.join.apply(["?wmsAuthSign=",token],[""])',
    'Array.prototype.join.bind(["?wmsAuthSign=",token])("")',
    'Reflect.apply(Array.prototype.join,["?wmsAuthSign=",token],[""])',
    'String.prototype.concat.call("?wmsAuthSign=",token)',
    'String.prototype.concat.apply("?wmsAuthSign=",[token])',
    'String.prototype.concat.bind("?wmsAuthSign=")(token)',
    'Reflect.apply(String.prototype.concat,"?wmsAuthSign=",[token])',
    'Array.prototype.join.call(["?wms","Sign=abc"],separator)',
    'Array.prototype.join.call(runtimeParts,"")',
    'String.prototype.concat.call(runtimePrefix,"Sign=abc")',
    '["?wmsAuthSign=",token].slice().join("")',
    '["?wmsAuthSign="].concat([token]).join("")',
    'runtimeParts.slice().join("")',
  ]) {
    await t.test(`runtime: ${text}`, () => assert.equal(find(text), null));
  }
});

test('semantic intrinsic exemptions require an unshadowed global root', async (t) => {
  const {findBundledRuntimeLiteral: find} = await import('../scripts/verify-sites-package.js');
  for (const text of [
    'function f(URLSearchParams){return new URLSearchParams("?wmsAuth","Sign=abc")}',
    'const URLSearchParams=Query;new URLSearchParams("?wmsAuth","Sign=abc")',
    'function f(Object){return Object.fromEntries("?wmsAuth","Sign=abc")}',
    'function f(Reflect){return Reflect.set("?wmsAuth","Sign=abc")}',
    'function f(Array){return Array.prototype.join.call(["?wms","Sign=abc"],"Auth")}',
    'function f(String){return String.prototype.concat.call("?wmsAuth","Sign=abc")}',
    'function f(Reflect){return Reflect.apply(Array.prototype.join,["?wmsAuth","Sign=abc"],[","])}',
    'function f(globalThis){return globalThis.Reflect.apply(Array.prototype.join,["?wmsAuth","Sign=abc"],[","])}',
    'function f(URLSearchParams=Custom,x=new URLSearchParams("?wmsAuth","Sign=abc")){}',
    'class C{static{var URLSearchParams=Custom;new URLSearchParams("?wmsAuth","Sign=abc")}}',
  ]) {
    await t.test(`shadowed: ${text}`, () => assert.notEqual(find(text), null));
  }
  for (const text of [
    'function f(URLSearchParams){return new URLSearchParams("?wmsAuthSign=",token)}',
    'function f(Object){return Object.fromEntries("?wmsAuthSign=",token)}',
    'new URLSearchParams([["?wmsAuthSign=","abc"]])',
    'Object.fromEntries([["?wmsAuthSign=","abc"]])',
    'config.set("?wmsAuthSign=","abc")',
    'Reflect.apply(Array.prototype.join,["?wmsAuth","Sign=abc"],[","])',
    'globalThis.Reflect.apply(Array.prototype.join,["?wmsAuth","Sign=abc"],[","])',
    'function f(x=new URLSearchParams("?wmsAuthSign=","abc")){var URLSearchParams=Custom}',
    'class C{static{var URLSearchParams=Custom}}new URLSearchParams("?wmsAuthSign=","abc")',
  ]) {
    await t.test(`runtime/structured: ${text}`, () => assert.equal(find(text), null));
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
    'config[condition ? "GOOGLE_CLIENT_ID" : "OTHER"]="hardcoded"',
    'config[(condition ? "wmsAuth" : "other") + "Sign"]="literal-token-value"',
    '({[condition ? "OPENAI_SITES_SOURCE_TOKEN" : "other"]:"sites-source-literal"})',
    'config[(0,"GOOGLE_CLIENT_ID")]="hardcoded"',
    'config[false || "GOOGLE_CLIENT_ID"]="hardcoded"',
    '({["wmsAuthSign"]:"literal-token-value"})',
    'config["OPENAI_SITES_SOURCE_TOKEN"] ??= "sites-source-literal"',
  ]) {
    await t.test(text, () => {
      assert.notEqual(verifier.findBundledRuntimeLiteral(text), null);
    });
  }
  for (const text of [
    'config[condition ? "GOOGLE_CLIENT_ID" : "OTHER"]=env.GOOGLE_CLIENT_ID',
    'config[(condition ? "wmsAuth" : "other") + "Sign"]=token',
    '({[condition ? "OPENAI_SITES_SOURCE_TOKEN" : "other"]:env.sourceToken})',
    'config[runtimeKey]="hardcoded"',
    'config[getKey()]="hardcoded"',
    '({[getKey()]:"hardcoded"})',
    'config[runtimePrefix+"ordinary"]="hardcoded"',
    '({[tag`ordinary-${suffix}`]:"hardcoded"})',
  ]) {
    await t.test(text, () => {
      assert.equal(verifier.findBundledRuntimeLiteral(text), null);
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
    'const url="https://example.test/x?wmsAuthSign="+(token+="abc")',
    'const url="https://example.test/x?wmsAuthSign="+(condition?token:otherToken)',
  ]) assert.equal(verifier.findBundledRuntimeLiteral(text), null);
  for (const text of [
    'const url="https://example.test/x?wmsAuthSign=abc"+token',
    'const url=`https://example.test/x?wmsAuthSign=abc${token}`',
    'const url=String("https://example.test/x?wmsAuthSign=abc")+token',
    'const url=(0,"https://example.test/x?wmsAuthSign=abc")+token',
    'const url=`${String("https://example.test/x?wmsAuthSign=abc")}${token}`',
    'const url="https://example.test/x?wmsAuthSign="+(condition?"abc":"def")',
    'const url="https://example.test/x?wmsAuthSign="+(token||"abc")',
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
    'const url="?wmsAuthSign=".concat("abc",token)',
    'const url=["?wmsAuthSign=","abc"].join("")',
    'new Query("?wmsAuthSign=","abc")',
    '`?wmsAuth${condition?"Sign=abc":"Other=x"}`',
    '`?wmsAuthSign${condition?"=abc":token}`',
    'base+"?wmsAuth"+(condition?"Sign=abc":"Other=x")',
    'base+"?wmsAuthSign"+(condition?"=abc":token)',
    'const url="?wmsAuth"+"Sign=abc"',
    'const url="?wmsAuthSign"+"=abc"',
    'base+"?wmsAuth"+"Sign=abc"+token',
    'base+"?wmsAuthSign"+"=abc"+token',
    'base+(condition?"?wmsAuth":"?x=")+"Sign=abc"',
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
    'base+"?wmsAuthSign=".concat(token)',
    'const url="?wmsAuthSign=".concat(token)',
    'new URL("?wmsAuthSign="+token,base)',
    'query`?wmsAuthSign=${token}`',
    'base+(condition?"?wmsAuth":"?x=")+"Sign="+token',
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
