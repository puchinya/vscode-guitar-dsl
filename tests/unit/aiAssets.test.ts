import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The AI sync gate is ESM (.mjs) shared by scripts/generate-ai-assets.mjs and npm run check:ai.
const load = () => import('../../scripts/check-ai-sync.mjs');
const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const TOOLS: Record<string, string> = {
  guitardsl_validate_dsl: 'guitardslValidate',
  guitardsl_analyze_playability: 'guitardslPlayability',
  guitardsl_apply_capo: 'guitardslApplyCapo',
  guitardsl_apply_beginner_mode: 'guitardslApplyBeginner',
  guitardsl_apply_transpose: 'guitardslTranspose',
  guitardsl_analyze_accompaniment: 'guitardslAccompaniment',
  guitardsl_apply_accompaniment: 'guitardslApplyAccompaniment'
};
const EXCLUDED = ['Gemini', 'gemini', 'transcribeYouTube', '@google/genai', 'src/transcription'];

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** Copies only the inputs checkAiSync reads into a temporary repository root. */
function makeFixtureRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guitardsl-ai-sync-'));
  const copy = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
  };
  copy('package.json');
  copy('docs/specs/guitardsl-syntax.md');
  for (const file of listFiles(path.join(ROOT, 'ai'))) copy(path.relative(ROOT, file));
  for (const rel of ['src/accompaniment.ts', 'src/strummingPatterns.ts', 'src/strummingCodeLens.ts', 'src/ai/tools.ts']) copy(rel);
  return tmp;
}

describe('AI integration assets (Issue #80)', () => {
  it('T001 manifest: VS Code ^1.109.0, the seven tools exactly once, prompt-referenceable, unique references, activation events', () => {
    assert.strictEqual(pkg.engines.vscode, '^1.109.0');
    assert.strictEqual(pkg.devDependencies['@types/vscode'], '^1.109.0');
    const tools: any[] = pkg.contributes.languageModelTools;
    assert.deepStrictEqual(tools.map(t => t.name).sort(), Object.keys(TOOLS).sort());
    for (const tool of tools) {
      assert.strictEqual(tool.toolReferenceName, TOOLS[tool.name], tool.name);
      assert.strictEqual(tool.canBeReferencedInPrompt, true, tool.name);
      assert.ok(tool.inputSchema && tool.inputSchema.type === 'object', tool.name);
    }
    assert.strictEqual(new Set(tools.map(t => t.toolReferenceName)).size, tools.length);
    for (const name of Object.keys(TOOLS)) assert.ok(pkg.activationEvents.includes(`onLanguageModelTool:${name}`), name);
    assert.ok(pkg.activationEvents.includes('onLanguage:guitardsl'));
    assert.deepStrictEqual(pkg.contributes.chatInstructions, [{ path: './ai/instructions/guitardsl.instructions.md' }]);
    assert.deepStrictEqual(pkg.contributes.chatSkills, [{ path: './ai/skills/guitardsl-language/SKILL.md' }]);
    assert.strictEqual(pkg.extensionDependencies, undefined, 'no hard dependency on an AI extension');
  });

  it('T001 tool input schemas follow the contract ranges', () => {
    const schema = (name: string) => pkg.contributes.languageModelTools.find((t: any) => t.name === name).inputSchema;
    assert.deepStrictEqual(schema('guitardsl_apply_capo').required, ['targetCapo']);
    assert.deepStrictEqual([schema('guitardsl_apply_capo').properties.targetCapo.minimum, schema('guitardsl_apply_capo').properties.targetCapo.maximum], [0, 12]);
    assert.deepStrictEqual(schema('guitardsl_apply_beginner_mode').required, ['barrePolicy']);
    assert.deepStrictEqual(schema('guitardsl_apply_beginner_mode').properties.barrePolicy.enum, ['allow', 'forbid']);
    assert.deepStrictEqual(schema('guitardsl_apply_transpose').required, ['semitones', 'capoMode']);
    assert.deepStrictEqual(schema('guitardsl_apply_transpose').properties.capoMode.enum, ['keep', 'recommended', 'explicit']);
    assert.deepStrictEqual([schema('guitardsl_apply_transpose').properties.semitones.minimum, schema('guitardsl_apply_transpose').properties.semitones.maximum], [-11, 11]);
    for (const name of Object.keys(TOOLS)) assert.strictEqual(schema(name).properties.path.type, 'string');
    for (const name of ['guitardsl_apply_capo', 'guitardsl_apply_beginner_mode', 'guitardsl_apply_transpose', 'guitardsl_apply_accompaniment']) {
      assert.strictEqual(schema(name).properties.uri.type, 'string', `${name} takes a document uri`);
    }
    for (const name of ['guitardsl_validate_dsl', 'guitardsl_analyze_playability', 'guitardsl_analyze_accompaniment']) assert.strictEqual(schema(name).properties.uri, undefined);
    const analyze = schema('guitardsl_analyze_accompaniment');
    assert.strictEqual(analyze.properties.sectionIndex.minimum, 0);
    assert.strictEqual(analyze.properties.family.enum.length, 9);
    const apply = schema('guitardsl_apply_accompaniment');
    assert.deepStrictEqual(apply.required, ['plans']);
    assert.deepStrictEqual(apply.properties.plans.items.properties.mode.enum, ['intent', 'preset', 'grid', 'dsl']);
    assert.deepStrictEqual(apply.properties.plans.items.properties.directionPolicy.enum, ['physical', 'literal']);
    assert.strictEqual(apply.properties.transitions.items.properties.candidates.maxItems, 3);
    assert.strictEqual(apply.properties.ending.properties.candidates.maxItems, 3);
    assert.ok(!('D' in apply.properties.transitions.items.properties.candidates.items.properties.pattern.properties), 'structured candidates take no raw strokes');
  });

  it('T001 scripts: precompile generates Help and AI assets; npm test runs both checks before tests', () => {
    assert.strictEqual(pkg.scripts['generate:ai'], 'node scripts/generate-ai-assets.mjs');
    assert.strictEqual(pkg.scripts['check:ai'], 'node scripts/check-ai-sync.mjs');
    assert.ok(/generate:help/.test(pkg.scripts.precompile) && /generate:ai/.test(pkg.scripts.precompile));
    const test: string = pkg.scripts.test;
    assert.ok(test.indexOf('check:help') < test.indexOf('test:unit') && test.indexOf('check:ai') < test.indexOf('test:unit'));
  });

  it('T002 the repository is in sync; one changed byte in the generated reference fails; restoring passes', async () => {
    const { checkAiSync, SKILL_REFERENCE, CANONICAL_SYNTAX_SPEC } = await load();
    assert.deepStrictEqual(checkAiSync(ROOT), []);
    const root = makeFixtureRoot();
    try {
      const ref = path.join(root, SKILL_REFERENCE);
      const bytes = fs.readFileSync(ref);
      bytes[bytes.length - 2] = bytes[bytes.length - 2] ^ 0x01;
      fs.writeFileSync(ref, bytes);
      const errors = checkAiSync(root);
      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].includes('differs from'));
      fs.copyFileSync(path.join(root, CANONICAL_SYNTAX_SPEC), ref);
      assert.deepStrictEqual(checkAiSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('T002 the gate detects a Skill name mismatch, a missing contributed path and tool drift', async () => {
    const { checkAiSync, SKILL_PATH, INSTRUCTIONS_PATH } = await load();
    const root = makeFixtureRoot();
    try {
      const skill = path.join(root, SKILL_PATH);
      fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace('name: guitardsl-language', 'name: other'));
      fs.rmSync(path.join(root, INSTRUCTIONS_PATH));
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      manifest.contributes.languageModelTools[0].toolReferenceName = 'renamed';
      manifest.contributes.languageModelTools.push({ name: 'guitardsl_extra', toolReferenceName: 'extra', canBeReferencedInPrompt: true });
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
      const errors: string[] = checkAiSync(root);
      assert.ok(errors.some(e => e.includes('frontmatter name "other"')), errors.join('\n'));
      assert.ok(errors.some(e => e.includes('contributed path does not exist')), errors.join('\n'));
      assert.ok(errors.some(e => e.includes('toolReferenceName must be "guitardslValidate"')), errors.join('\n'));
      assert.ok(errors.some(e => e.includes('unexpected languageModelTools "guitardsl_extra"')), errors.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('T003 ai/** and the tool descriptions contain no excluded integration identifier', async () => {
    for (const file of listFiles(path.join(ROOT, 'ai'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const id of EXCLUDED) assert.ok(!text.includes(id), `${path.relative(ROOT, file)} contains ${id}`);
    }
    for (const tool of pkg.contributes.languageModelTools) {
      for (const id of EXCLUDED) assert.ok(!JSON.stringify(tool).includes(id), `${tool.name} mentions ${id}`);
    }
    const { checkAiSync, INSTRUCTIONS_PATH } = await load();
    const root = makeFixtureRoot();
    try {
      fs.appendFileSync(path.join(root, INSTRUCTIONS_PATH), '\nSee transcribeYouTube.\n');
      assert.ok(checkAiSync(root).some((e: string) => e.includes('excluded identifier "transcribeYouTube"')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('T017 the gate requires the accompaniment workflow in the Skill, its guide and the instructions', async () => {
    const { checkAiSync, ACCOMPANIMENT_GUIDE, INSTRUCTIONS_PATH } = await load();
    const root = makeFixtureRoot();
    try {
      const guide = path.join(root, ACCOMPANIMENT_GUIDE);
      fs.writeFileSync(guide, fs.readFileSync(guide, 'utf8').split('guitardsl_apply_accompaniment').join('the apply tool'));
      const instructions = path.join(root, INSTRUCTIONS_PATH);
      fs.writeFileSync(instructions, fs.readFileSync(instructions, 'utf8').split('guitardsl_analyze_accompaniment').join('the analyze tool'));
      const errors: string[] = checkAiSync(root);
      assert.ok(errors.some(e => e.includes(`${ACCOMPANIMENT_GUIDE}: must reference guitardsl_apply_accompaniment`)), errors.join('\n'));
      assert.ok(errors.some(e => e.includes(`${INSTRUCTIONS_PATH}: must reference guitardsl_analyze_accompaniment`)), errors.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('T033 the gate rejects an excluded import in the accompaniment engine or the tool adapter', async () => {
    const { checkAiSync } = await load();
    const root = makeFixtureRoot();
    try {
      const engine = path.join(root, 'src/accompaniment.ts');
      fs.writeFileSync(engine, `import { transcribeWithGemini } from './transcription/gemini';\n${fs.readFileSync(engine, 'utf8')}`);
      const tools = path.join(root, 'src/ai/tools.ts');
      fs.writeFileSync(tools, `import { GoogleGenAI } from '@google/genai';\n${fs.readFileSync(tools, 'utf8')}`);
      const errors: string[] = checkAiSync(root);
      assert.ok(errors.some(e => e.includes('src/accompaniment.ts: imports excluded module "./transcription/gemini"')), errors.join('\n'));
      assert.ok(errors.some(e => e.includes('src/ai/tools.ts: imports excluded module "@google/genai"')), errors.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('Skill is concise orchestration, not a copy of the spec; instructions target GuitarDSL files only', () => {
    const skill = fs.readFileSync(path.join(ROOT, 'ai/skills/guitardsl-language/SKILL.md'), 'utf8');
    const spec = fs.readFileSync(path.join(ROOT, 'docs/specs/guitardsl-syntax.md'), 'utf8');
    assert.ok(skill.length * 10 < spec.length, 'SKILL.md must stay much shorter than the spec');
    assert.ok(skill.includes('references/guitardsl-syntax.md'));
    assert.ok(skill.includes('guitardsl_validate_dsl'));
    assert.ok(skill.includes('references/accompaniment.md'));
    const guide = fs.readFileSync(path.join(ROOT, 'ai/skills/guitardsl-language/references/accompaniment.md'), 'utf8');
    assert.ok(guide.includes('directionPolicy') && /never choose `literal` on your own/i.test(guide), 'the guide forbids choosing literal autonomously');
    assert.ok(guide.includes('operation: adapt') && guide.includes('operation: replace'));
    assert.ok(guide.includes('@tempo: rit.'));
    const instructions = fs.readFileSync(path.join(ROOT, 'ai/instructions/guitardsl.instructions.md'), 'utf8');
    assert.ok(instructions.startsWith('---\n'));
    assert.ok(/^applyTo: '\*\*\/\*\.\{guitardsl,gdsl\}'$/m.test(instructions.split('\n---')[0]), 'applyTo stays GuitarDSL-only (never **)');
    assert.ok(instructions.includes('guitardsl_validate_dsl'));
  });

  it('packaging: .vscodeignore keeps ai/** and still excludes development sources', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/).map(l => l.trim());
    assert.ok(!ignore.some(l => l.startsWith('ai') || l === '**/*.md'), 'ai/** must not be excluded');
    for (const pattern of ['docs/**', 'scripts/**', 'src/**', 'tests/**']) assert.ok(ignore.includes(pattern), pattern);
  });
});

describe('AI integration assets: new-score workflow (Issue #104)', () => {
  /** Runs the gate on a fixture root after `mutate`, returning its problems. */
  async function gateAfter(mutate: (root: string) => void): Promise<string[]> {
    const { checkAiSync } = await load();
    const root = makeFixtureRoot();
    try {
      mutate(root);
      return checkAiSync(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  const edit = (root: string, rel: string, change: (text: string) => string) => {
    const file = path.join(root, rel);
    const before = fs.readFileSync(file, 'utf8');
    const after = change(before);
    assert.notStrictEqual(after, before, `the mutation must change ${rel}`);
    fs.writeFileSync(file, after);
  };
  const editTool = (root: string, name: string, change: (text: string) => string) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const tool = manifest.contributes.languageModelTools.find((t: any) => t.name === name);
    const before = tool.modelDescription;
    tool.modelDescription = change(before);
    assert.notStrictEqual(tool.modelDescription, before, `the mutation must change ${name}`);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  };
  const has = (errors: string[], text: string) => assert.ok(errors.some(e => e.includes(text)), `expected "${text}" in:\n${errors.join('\n')}`);

  it('the current assets pass and are discoverable for new-score creation', async () => {
    const { checkAiSync, parseFrontmatter, INSTRUCTIONS_PATH, SKILL_PATH } = await load();
    assert.deepStrictEqual(checkAiSync(ROOT), []);
    const instructions = parseFrontmatter(fs.readFileSync(path.join(ROOT, INSTRUCTIONS_PATH), 'utf8'));
    assert.strictEqual(instructions.name, 'GuitarDSL editing and creation');
    assert.strictEqual(instructions.applyTo, '**/*.{guitardsl,gdsl}');
    assert.ok(/new song before a GuitarDSL file exists/.test(instructions.description), instructions.description);
    const skill = parseFrontmatter(fs.readFileSync(path.join(ROOT, SKILL_PATH), 'utf8'));
    assert.strictEqual(skill.name, 'guitardsl-language');
    assert.ok(/creating or composing a new GuitarDSL song or score from scratch/.test(skill.description), skill.description);
  });

  it('deleting the instructions description fails', async () => {
    const { INSTRUCTIONS_PATH } = await load();
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => t.replace(/^description:.*\n/m, ''))), 'non-empty task-relevance description');
  });

  it('removing the new-score meaning from the descriptions fails', async () => {
    const { INSTRUCTIONS_PATH, SKILL_PATH } = await load();
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => t.replace(', including creating a new song before a GuitarDSL file exists', ''))), 'before a GuitarDSL file exists');
    has(await gateAfter(root => edit(root, SKILL_PATH, t => t.replace('when creating or composing a new GuitarDSL song or score from scratch, ', ''))), 'description must cover creating/composing');
  });

  it('removing the new-score workflow from the instructions, the Skill or the guide fails', async () => {
    const { INSTRUCTIONS_PATH, SKILL_PATH, ACCOMPANIMENT_GUIDE } = await load();
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => t.slice(0, t.indexOf('## New GuitarDSL score workflow')))), `${INSTRUCTIONS_PATH}: missing the new-score workflow`);
    has(await gateAfter(root => edit(root, SKILL_PATH, t => t.slice(0, t.indexOf('6. New score from scratch')))), `${SKILL_PATH}: missing the new-score workflow`);
    has(await gateAfter(root => edit(root, ACCOMPANIMENT_GUIDE, t => t.replace(/## New score from scratch[\s\S]*?(?=## Workflow)/, ''))), `${ACCOMPANIMENT_GUIDE}: missing the new-score workflow`);
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => t.replace('do not fall back to manual rhythm generation', 'write the rhythm yourself'))), `${INSTRUCTIONS_PATH}: new-score workflow must keep /fall ?back/i`);
    has(await gateAfter(root => edit(root, ACCOMPANIMENT_GUIDE, t => t.replace('1. Structural draft.', '1. Draft.'))), `${ACCOMPANIMENT_GUIDE}: new-score workflow must keep /structural draft/i`);
  });

  it('reordering or removing a validate -> analyze -> apply -> validate step fails', async () => {
    const { INSTRUCTIONS_PATH, SKILL_PATH, ACCOMPANIMENT_GUIDE } = await load();
    const swap = (t: string, from: string) => {
      const start = t.indexOf(from);
      const head = t.slice(0, start);
      const body = t.slice(start).replace('guitardsl_analyze_accompaniment', '\u0000').replace('guitardsl_apply_accompaniment', 'guitardsl_analyze_accompaniment').replace('\u0000', 'guitardsl_apply_accompaniment');
      return head + body;
    };
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => swap(t, '## New GuitarDSL score workflow'))), `${INSTRUCTIONS_PATH}: new-score workflow must name`);
    has(await gateAfter(root => edit(root, SKILL_PATH, t => swap(t, '6. New score from scratch'))), `${SKILL_PATH}: new-score workflow must name`);
    has(await gateAfter(root => edit(root, ACCOMPANIMENT_GUIDE, t => swap(t, '## New score from scratch'))), `${ACCOMPANIMENT_GUIDE}: new-score workflow must name`);
    // Dropping the final validation step.
    has(await gateAfter(root => edit(root, INSTRUCTIONS_PATH, t => t.replace('6. Run `guitardsl_validate_dsl` again and resolve unintended diagnostics.', '6. Done.'))), `${INSTRUCTIONS_PATH}: new-score workflow must name`);
    // Dropping the first validation step.
    has(await gateAfter(root => edit(root, ACCOMPANIMENT_GUIDE, t => t.replace('2. First validation. Run `guitardsl_validate_dsl`.', '2. First validation.'))), `${ACCOMPANIMENT_GUIDE}: new-score workflow must name`);
  });

  it('removing the new-score guidance from either accompaniment tool description fails', async () => {
    for (const name of ['guitardsl_analyze_accompaniment', 'guitardsl_apply_accompaniment']) {
      has(await gateAfter(root => editTool(root, name, d => d.slice(0, d.indexOf(' New score:')))), `languageModelTools "${name}" modelDescription must keep the new-score guidance`);
      has(await gateAfter(root => editTool(root, name, d => d.replace('they are not handwritten by the model', 'you may write them'))), `languageModelTools "${name}" modelDescription must keep the new-score guidance`);
    }
  });

  it('the new checks leave the seven-tool contract unchanged', async () => {
    const { EXPECTED_TOOLS } = await load();
    assert.deepStrictEqual(Object.keys(EXPECTED_TOOLS).sort(), Object.keys(TOOLS).sort());
    assert.deepStrictEqual(pkg.contributes.languageModelTools.map((t: any) => t.name).sort(), Object.keys(TOOLS).sort());
  });
});
