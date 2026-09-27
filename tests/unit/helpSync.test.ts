import * as assert from 'assert';
import * as path from 'path';

// The Help sync library is ESM (.mjs) shared by scripts/generate-help.mjs and scripts/check-help-sync.mjs.
const load = () => import('../../scripts/help-sync-lib.mjs');
const ROOT = path.resolve(__dirname, '../..');

const SYNTAX = [
  '# Syntax',
  '',
  '## 1. Overview',
  'GuitarDSL is a text DSL.',
  '',
  '---',
  '',
  '## 2. Chords',
  '```text',
  '## not a heading inside a fence',
  '```',
  'Chord text.',
  ''
].join('\n');

const EXTENSION = [
  '# Extension',
  '',
  '## 3. Commands',
  '',
  '| コマンドID | タイトル |',
  '|---|---|',
  '| `guitardsl.alpha` | Alpha |',
  '| `guitardsl.beta` | Beta |',
  '',
  '### 3.1 `guitardsl.alpha`',
  '### 3.2 `guitardsl.beta`（実験的）',
  '',
  '### 3.3 設定仕様 (Configuration)',
  '| 設定キー | 型 |',
  '|---|---|',
  '| `guitardsl.gamma` | `boolean` |',
  '',
  '## 4A. Chord Editor',
  'Editor text.',
  '',
  '## 5A. Diagnostics',
  'Diagnostics text.',
  ''
].join('\n');

const PKG = {
  contributes: {
    commands: [
      { command: 'guitardsl.alpha', title: '%command.alpha.title%' },
      { command: 'guitardsl.beta', title: '%command.beta.title%' }
    ],
    configuration: {
      properties: { 'guitardsl.gamma': { type: 'boolean', default: true, description: '%config.gamma.description%' } }
    }
  }
};

const NLS = {
  en: { 'command.alpha.title': 'Alpha EN', 'command.beta.title': 'Beta | EN', 'config.gamma.description': 'Gamma EN' },
  ja: { 'command.alpha.title': 'アルファ', 'command.beta.title': 'ベータ', 'config.gamma.description': 'ガンマ' }
};

const ABOUT_JA = '# ヘルプ\n<!-- help-sources: syntax:1 extension:3 -->\n\n概要\n\n## エディタ\n<!-- help-sources: extension:4A -->\n\n本文';
const ABOUT_EN = '# Help\r\n<!-- help-sources: syntax:1 extension:3 -->\r\n\r\nAbout\r\n\r\n## Editor\r\n<!-- help-sources: extension:4A -->\r\n\r\nBody';

async function fixture() {
  const lib = await load();
  const specTexts: Record<string, string | undefined> = { syntax: SYNTAX, extension: EXTENSION };
  const digest = (src: string, id: string) => lib.sectionDigest(lib.extractSections(specTexts[src]!).sections.get(id));
  const manifest: any = {
    sources: { syntax: 'docs/specs/syntax.md', extension: 'docs/specs/extension.md' },
    pages: [{ id: 'about' }, { id: 'language' }],
    coverage: [
      { source: 'syntax', section: '1', helpPage: 'about', reviewedSourceSha256: digest('syntax', '1') },
      { source: 'syntax', section: '2', helpPage: 'language', reviewedSourceSha256: digest('syntax', '2') },
      { source: 'extension', section: '3', helpPage: 'about', reviewedSourceSha256: digest('extension', '3') },
      { source: 'extension', section: '4A', helpPage: 'about', reviewedSourceSha256: digest('extension', '4A') }
    ],
    excludedSections: [{ source: 'extension', section: '5A', reason: 'Not user-facing in this fixture.' }]
  };
  const pageFiles: Record<string, string | undefined> = {
    'ja/about': ABOUT_JA, 'ja/language': '## 言語\n<!-- help-sources: syntax:2 -->\n\n本文',
    'en/about': ABOUT_EN, 'en/language': '## Language\n<!-- help-sources: syntax:2 -->\n\nBody'
  };
  const inputs: any = { manifest, pkg: PKG, nls: NLS, specTexts, pageFiles, generatedFiles: {}, loadErrors: [] };
  inputs.generatedFiles = lib.renderAll(inputs);
  return { lib, inputs, manifest, specTexts, pageFiles };
}

const hasError = (errors: string[], ...parts: string[]) =>
  assert.ok(errors.some(e => parts.every(p => e.includes(p))), `expected an error containing ${JSON.stringify(parts)} in:\n${errors.join('\n')}`);

describe('Help sync: manifest and section coverage', () => {
  it('T001: a valid manifest passes every check', async () => {
    const { lib, inputs } = await fixture();
    assert.deepStrictEqual(lib.runAllChecks(inputs), []);
  });

  it('T001: malformed manifests, duplicate mappings, unknown sources/pages and empty reasons fail specifically', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    assert.deepStrictEqual(lib.validateManifest([], specTexts, pageFiles), ['manifest: must be a JSON object']);
    hasError(lib.validateManifest({ ...manifest, coverage: 'x' }, specTexts, pageFiles), 'manifest.coverage');

    const dup = structuredClone(manifest);
    dup.coverage.push({ ...dup.coverage[0], helpPage: 'language' });
    dup.pages.push({ id: 'about' });
    const dupErrors = lib.validateManifest(dup, specTexts, pageFiles);
    hasError(dupErrors, 'duplicate mapping', 'syntax §1');
    hasError(dupErrors, 'duplicate page id "about"');

    const bad = structuredClone(manifest);
    bad.coverage[0].source = 'nope';
    bad.coverage[1].helpPage = 'missing';
    bad.excludedSections[0].reason = '  ';
    const badErrors = lib.validateManifest(bad, specTexts, pageFiles);
    hasError(badErrors, 'unknown source id "nope"');
    hasError(badErrors, 'unknown helpPage "missing"');
    hasError(badErrors, 'excludedSections[0]', 'reason must be non-empty');
  });

  it('T001: a missing localized page source or spec file fails', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    hasError(lib.validateManifest(manifest, specTexts, { ...pageFiles, 'ja/language': undefined }), 'docs/help/ja/language.md');
    hasError(lib.validateManifest(manifest, { ...specTexts, syntax: undefined }, pageFiles), 'source "syntax"', 'file not found');
  });

  it('T002: a newly added numbered syntax section is rejected until it is classified', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const grown = { ...specTexts, syntax: SYNTAX + '\n## 19. New Feature\nSomething new.\n' };
    hasError(lib.validateManifest(manifest, grown, pageFiles), 'syntax §19', 'New Feature', 'not covered');
  });

  it('T002: an unnumbered top-level section cannot be classified', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const grown = { ...specTexts, syntax: SYNTAX + '\n## Appendix\ntext\n' };
    hasError(lib.validateManifest(manifest, grown, pageFiles), 'unnumbered top-level section', 'Appendix');
  });

  it('T003: alphanumeric extension sections (4A, 5A) are parsed by heading text and must be classified', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    assert.deepStrictEqual([...lib.extractSections(EXTENSION).sections.keys()], ['3', '4A', '5A']);
    const partial = structuredClone(manifest);
    partial.excludedSections = [];
    hasError(lib.validateManifest(partial, specTexts, pageFiles), 'extension §5A', 'not covered');
  });

  it('headings inside code fences are not sections', async () => {
    const { lib } = await fixture();
    assert.deepStrictEqual([...lib.extractSections(SYNTAX).sections.keys()], ['1', '2']);
  });

  it('T004: changing a covered section fails with the exact source and section', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const changed = { ...specTexts, syntax: SYNTAX.replace('Chord text.', 'Chord text changed.') };
    const errors = lib.validateManifest(manifest, changed, pageFiles);
    assert.strictEqual(errors.length, 1);
    hasError(errors, 'syntax §2', 'changed since the Help was reviewed', 'language.md');
  });

  it('T004: whitespace-only edits at line ends and trailing rules do not change the digest', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const cosmetic = { ...specTexts, syntax: SYNTAX.replace('Chord text.', 'Chord text.   ').replace(/\n/g, '\r\n') };
    assert.deepStrictEqual(lib.validateManifest(manifest, cosmetic, pageFiles), []);
  });

  it('T005: a mapping to a deleted or renumbered section fails', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const removed = { ...specTexts, syntax: SYNTAX.replace('## 2. Chords', '## 3. Chords') };
    const errors = lib.validateManifest(manifest, removed, pageFiles);
    hasError(errors, 'syntax §2 does not exist');
    hasError(errors, 'syntax §3', 'not covered');
  });
});

describe('Help sync: topic ownership (feature removal)', () => {
  it('A removed spec section whose Help prose is left behind fails (orphaned topic)', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    // Feature removed from the spec and from the manifest, but the Help prose is kept.
    const removedSpec = { ...specTexts, syntax: SYNTAX.slice(0, SYNTAX.indexOf('## 2. Chords')) };
    const removedManifest = structuredClone(manifest);
    removedManifest.coverage = removedManifest.coverage.filter((c: any) => !(c.source === 'syntax' && c.section === '2'));
    const errors = lib.validateManifest(removedManifest, removedSpec, pageFiles);
    hasError(errors, 'docs/help/ja/language.md', 'syntax §2', 'obsolete Help prose');
    hasError(errors, 'docs/help/en/language.md', 'syntax §2', 'obsolete Help prose');
    // Deleting only the marker does not help: the heading is then unowned.
    const unmarked = { ...pageFiles, 'en/language': '## Language\n\nBody', 'ja/language': '## 言語\n\n本文' };
    hasError(lib.validateManifest(removedManifest, removedSpec, unmarked), 'docs/help/en/language.md', 'heading "Language"', 'no <!-- help-sources');
    // Removing the obsolete prose (and its heading) passes.
    const cleaned = { ...pageFiles, 'en/language': '## Language\n<!-- help-sources: syntax:1 -->\n\nOther', 'ja/language': '## 言語\n<!-- help-sources: syntax:1 -->\n\n他' };
    assert.deepStrictEqual(lib.validateManifest(removedManifest, removedSpec, cleaned), []);
  });

  it('the real repository fails when syntax §18 (note groups) is removed but its Help prose stays', async () => {
    const lib = await load();
    const inputs = lib.loadRepoInputs(ROOT);
    const spec: string = inputs.specTexts.syntax;
    inputs.specTexts.syntax = spec.slice(0, spec.indexOf('## 18.'));
    inputs.manifest.coverage = inputs.manifest.coverage.filter((c: any) => !(c.source === 'syntax' && c.section === '18'));
    const errors = lib.runAllChecks(inputs);
    for (const locale of ['ja', 'en']) {
      hasError(errors, `docs/help/${locale}/language.md`, 'syntax §18', 'obsolete Help prose');
      hasError(errors, `docs/help/${locale}/troubleshooting.md`, 'syntax §18', 'obsolete Help prose');
    }
  });

  it('markers referencing excluded sections, unclaimed coverage, locale mismatch and stray markers fail', async () => {
    const { lib, manifest, specTexts, pageFiles } = await fixture();
    const excludedRef = { ...pageFiles, 'en/language': '## Language\n<!-- help-sources: syntax:2 extension:5A -->\n\nBody' };
    const errors = lib.validateManifest(manifest, specTexts, excludedRef);
    hasError(errors, 'extension §5A', 'is excluded from Help');
    hasError(errors, 'page "language": ja and en claim different spec sections', 'only en: extension:5A');

    const unclaimed = { ...pageFiles, 'ja/about': ABOUT_JA.replace('extension:4A', 'syntax:1') };
    hasError(lib.validateManifest(manifest, specTexts, unclaimed), 'docs/help/ja/about.md', 'no heading claims extension §4A');

    const stray = { ...pageFiles, 'en/language': '## Language\n<!-- help-sources: syntax:2 -->\n\nBody\n<!-- help-sources: syntax:2 -->' };
    hasError(lib.validateManifest(manifest, specTexts, stray), 'docs/help/en/language.md', 'must directly follow a heading');

    const malformed = { ...pageFiles, 'en/language': '## Language\n<!-- help-sources: syntax -->\n\nBody' };
    hasError(lib.validateManifest(manifest, specTexts, malformed), 'malformed help-sources entry "syntax"');
  });

  it('headings inside code fences need no marker, and markers never reach the generated output', async () => {
    const { lib, inputs } = await fixture();
    const fenced = { ...inputs.pageFiles, 'en/language': '## Language\n<!-- help-sources: syntax:2 -->\n\n```text\n# not a heading\n```' };
    assert.deepStrictEqual(lib.validateManifest(inputs.manifest, inputs.specTexts, fenced), []);
    for (const text of Object.values(lib.renderAll(inputs)) as string[]) assert.ok(!text.includes('help-sources'));
  });
});

describe('Help sync: malformed manifests through runAllChecks', () => {
  const cases: [string, (m: any) => void, string][] = [
    ['pages: [null]', m => { m.pages = [null]; }, 'manifest.pages[0]'],
    ['pages entry without id', m => { m.pages = [{ id: 'about' }, {}]; }, 'manifest.pages[1]'],
    ['coverage: [null]', m => { m.coverage = [null]; }, 'manifest.coverage[0]'],
    ['excludedSections: [null]', m => { m.excludedSections = [null]; }, 'manifest.excludedSections[0]'],
    ['sources is an array', m => { m.sources = []; }, 'manifest.sources'],
    ['pages missing', m => { delete m.pages; }, 'manifest.pages']
  ];
  for (const [name, mutate, expected] of cases) {
    it(`T001: ${name} yields diagnostics instead of an exception`, async () => {
      const { lib, inputs } = await fixture();
      mutate(inputs.manifest);
      let errors: string[] = [];
      assert.doesNotThrow(() => { errors = lib.runAllChecks(inputs); });
      assert.ok(errors.length > 0);
      hasError(errors, expected);
    });
  }

  it('T001: a non-object manifest yields a diagnostic', async () => {
    const { lib, inputs } = await fixture();
    inputs.manifest = null;
    hasError(lib.runAllChecks(inputs), 'manifest: must be a JSON object');
  });
});

describe('Help sync: generation', () => {
  it('T006: generation is deterministic with LF and exactly one trailing newline', async () => {
    const { lib, inputs } = await fixture();
    const a = lib.renderAll(inputs);
    const b = lib.renderAll(structuredClone(inputs));
    assert.deepStrictEqual(a, b);
    for (const text of Object.values(a) as string[]) {
      assert.ok(text.startsWith(lib.GENERATED_HEADER));
      assert.ok(!text.includes('\r'));
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
    }
  });

  it('T007: a stale or missing generated file is reported by path', async () => {
    const { lib, inputs } = await fixture();
    const expected = lib.renderAll(inputs);
    const stale = { ...expected, [lib.GENERATED_FILES.ja]: expected[lib.GENERATED_FILES.ja] + 'edited by hand\n' };
    const errors = lib.checkGenerated(expected, stale);
    assert.strictEqual(errors.length, 1);
    hasError(errors, lib.GENERATED_FILES.ja, 'stale');
    hasError(lib.checkGenerated(expected, {}), lib.GENERATED_FILES.en, 'missing');
  });

  it('T008: every contributed command appears once with its localized title', async () => {
    const { lib, inputs } = await fixture();
    const ja = lib.renderHelp({ ...inputs, locale: 'ja' });
    const en = lib.renderHelp({ ...inputs, locale: 'en' });
    assert.ok(ja.includes('| アルファ | `guitardsl.alpha` |'));
    assert.ok(en.includes('| Beta \\| EN | `guitardsl.beta` |'), 'pipes in titles are escaped');
    for (const id of ['guitardsl.alpha', 'guitardsl.beta']) {
      assert.strictEqual(ja.split(`\`${id}\``).length - 1, 1);
    }
  });

  it('T009: every contributed setting appears with type, default and localized description', async () => {
    const { lib, inputs } = await fixture();
    assert.ok(lib.renderHelp({ ...inputs, locale: 'ja' }).includes('| `guitardsl.gamma` | `boolean` | `true` | ガンマ |'));
    assert.ok(lib.renderHelp({ ...inputs, locale: 'en' }).includes('| `guitardsl.gamma` | `boolean` | `true` | Gamma EN |'));
  });

  it('T008/T009: the real generated Help lists every command and setting from package.json', async () => {
    const lib = await load();
    const inputs = lib.loadRepoInputs(ROOT);
    const { commands, configs } = lib.extractPackageInventory(inputs.pkg);
    for (const locale of ['ja', 'en']) {
      const text = inputs.generatedFiles[lib.GENERATED_FILES[locale]];
      for (const c of commands) {
        const title = inputs.nls[locale][c.title.slice(1, -1)];
        assert.ok(text.includes(`| ${title} | \`${c.id}\` |`), `${locale}: ${c.id}`);
      }
      for (const c of configs) assert.ok(text.includes(`| \`${c.key}\` |`), `${locale}: ${c.key}`);
    }
    assert.ok(commands.some((c: any) => c.id === 'guitardsl.openHelp'));
  });
});

describe('Help sync: package/spec parity and localization', () => {
  it('T010: command sets must match between package.json and the spec table and headings', async () => {
    const { lib } = await fixture();
    assert.deepStrictEqual(lib.checkParity(PKG, NLS, EXTENSION), []);
    const missingRow = EXTENSION.replace('| `guitardsl.beta` | Beta |\n', '');
    hasError(lib.checkParity(PKG, NLS, missingRow), 'command guitardsl.beta', 'command table');
    const extraPkg = structuredClone(PKG);
    extraPkg.contributes.commands.push({ command: 'guitardsl.delta', title: 'Delta' });
    const errors = lib.checkParity(extraPkg, NLS, EXTENSION);
    hasError(errors, 'command guitardsl.delta', 'missing from the docs/specs/extension.md §3 command table');
    hasError(errors, 'command guitardsl.delta', 'no docs/specs/extension.md §3 subsection heading');
  });

  it('T011: setting sets must match between package.json and the spec setting table', async () => {
    const { lib } = await fixture();
    const extraSpec = EXTENSION.replace('| `guitardsl.gamma` | `boolean` |', '| `guitardsl.gamma` | `boolean` |\n| `guitardsl.omega` | `string` |');
    hasError(lib.checkParity(PKG, NLS, extraSpec), 'setting guitardsl.omega', 'not contributed in package.json');
    const noSetting = structuredClone(PKG);
    (noSetting.contributes.configuration.properties as any) = {};
    hasError(lib.checkParity(noSetting, NLS, EXTENSION), 'setting guitardsl.gamma', 'not contributed');
  });

  it('T012: a missing Japanese or English contribution localization fails', async () => {
    const { lib } = await fixture();
    const ja: Record<string, string> = { ...NLS.ja };
    delete ja['command.beta.title'];
    hasError(lib.checkParity(PKG, { en: NLS.en, ja }, EXTENSION), 'command guitardsl.beta', 'package.nls.ja.json');
    const en: Record<string, string> = { ...NLS.en };
    delete en['config.gamma.description'];
    hasError(lib.checkParity(PKG, { en, ja: NLS.ja }, EXTENSION), 'setting guitardsl.gamma', 'package.nls.json');
  });

  it('T010/T011: the repository is in sync (spec, package.json, NLS, digests, generated files)', async () => {
    const lib = await load();
    assert.deepStrictEqual(lib.runAllChecks(lib.loadRepoInputs(ROOT)), []);
  });
});

describe('Help content scope', () => {
  it('T013: the language page covers syntax §17 (let) and §18 (note groups) in both locales', async () => {
    const lib = await load();
    const inputs = lib.loadRepoInputs(ROOT);
    for (const section of ['17', '18']) {
      const entry = inputs.manifest.coverage.find((c: any) => c.source === 'syntax' && c.section === section);
      assert.ok(entry, `syntax §${section} is covered`);
      assert.strictEqual(entry.helpPage, 'language');
    }
    for (const locale of ['ja', 'en']) {
      const page = inputs.pageFiles[`${locale}/language`];
      assert.ok(page.includes('let groove =') && page.includes('$groove'), `${locale}: let / $name`);
      assert.ok(page.includes('[c4,e4,g4]/4'), `${locale}: note groups`);
    }
  });

  it('T019: generated Help has no Web Player, playback-control or "no sound" sections', async () => {
    const lib = await load();
    const inputs = lib.loadRepoInputs(ROOT);
    for (const locale of ['ja', 'en']) {
      const text: string = inputs.generatedFiles[lib.GENERATED_FILES[locale]];
      const headings = text.split('\n').filter(l => /^#{1,6} /.test(l));
      for (const h of headings) {
        assert.ok(!/web ?player|webプレーヤー|playback control|再生コントロール|no sound|音が出ない|metronome|メトロノーム/i.test(h), `${locale}: forbidden heading "${h}"`);
      }
      assert.ok(!/guitardsl\.(play|playback|webPlayer)/i.test(text), `${locale}: no playback command IDs`);
    }
  });
});
