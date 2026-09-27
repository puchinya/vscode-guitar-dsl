// Read-only AI asset synchronization gate (npm run check:ai).
// Fails when the packaged Skill reference differs from the canonical syntax spec, the Skill name does not
// match its directory, a contributed AI path is missing, the language model tool contract drifted, or an
// AI asset / tool description mentions an excluded integration. It never repairs anything.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CANONICAL_SYNTAX_SPEC = 'docs/specs/guitardsl-syntax.md';
export const SKILL_REFERENCE = 'ai/skills/guitardsl-language/references/guitardsl-syntax.md';
export const INSTRUCTIONS_PATH = 'ai/instructions/guitardsl.instructions.md';
export const SKILL_PATH = 'ai/skills/guitardsl-language/SKILL.md';
export const INSTRUCTIONS_APPLY_TO = '**/*.{guitardsl,gdsl}';

/** The exact tool contract (extension spec §8.3): tool name -> prompt reference name. */
export const EXPECTED_TOOLS = Object.freeze({
  guitardsl_validate_dsl: 'guitardslValidate',
  guitardsl_analyze_playability: 'guitardslPlayability',
  guitardsl_apply_capo: 'guitardslApplyCapo',
  guitardsl_apply_beginner_mode: 'guitardslApplyBeginner',
  guitardsl_apply_transpose: 'guitardslTranspose'
});

/** Identifiers of integrations that must never be advertised to the Agent. */
export const EXCLUDED_IDENTIFIERS = Object.freeze(['Gemini', 'gemini', 'transcribeYouTube', '@google/genai', 'src/transcription']);

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Parses a leading `---` YAML frontmatter block into flat `key: value` string pairs (quotes stripped). */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return undefined;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

/** Runs every check against the repository rooted at `root`; returns the list of problems (empty = in sync). */
export function checkAiSync(root) {
  const errors = [];
  const read = rel => {
    const path = join(root, rel);
    return existsSync(path) ? readFileSync(path) : undefined;
  };

  let pkg;
  try {
    pkg = JSON.parse(read('package.json')?.toString('utf8') ?? '');
  } catch (err) {
    return [`package.json: cannot be parsed (${err.message})`];
  }
  const contributes = pkg.contributes ?? {};

  // 1. Packaged syntax reference is a byte-for-byte copy of the canonical spec.
  const canonical = read(CANONICAL_SYNTAX_SPEC);
  const reference = read(SKILL_REFERENCE);
  if (!canonical) errors.push(`${CANONICAL_SYNTAX_SPEC}: missing`);
  else if (!reference) errors.push(`${SKILL_REFERENCE}: missing (run npm run generate:ai)`);
  else if (!canonical.equals(reference)) errors.push(`${SKILL_REFERENCE}: differs from ${CANONICAL_SYNTAX_SPEC} (run npm run generate:ai; never edit the copy by hand)`);

  // 2. Contributed instruction / Skill paths exist and are the expected ones.
  const contributedPaths = key => (Array.isArray(contributes[key]) ? contributes[key] : []).map(e => String(e?.path ?? '').replace(/^\.\//, ''));
  const instructionPaths = contributedPaths('chatInstructions');
  const skillPaths = contributedPaths('chatSkills');
  if (instructionPaths.join('\n') !== INSTRUCTIONS_PATH) errors.push(`package.json: contributes.chatInstructions must be exactly [{ "path": "./${INSTRUCTIONS_PATH}" }]`);
  if (skillPaths.join('\n') !== SKILL_PATH) errors.push(`package.json: contributes.chatSkills must be exactly [{ "path": "./${SKILL_PATH}" }]`);
  for (const rel of [...instructionPaths, ...skillPaths]) {
    if (!read(rel)) errors.push(`${rel}: contributed path does not exist`);
  }

  // 3. Skill frontmatter name matches its directory; instructions target only GuitarDSL files.
  for (const rel of skillPaths) {
    const text = read(rel)?.toString('utf8');
    if (text === undefined) continue;
    const name = parseFrontmatter(text)?.name;
    const dirName = basename(dirname(rel));
    if (name !== dirName) errors.push(`${rel}: frontmatter name "${name ?? ''}" must match its directory "${dirName}"`);
  }
  for (const rel of instructionPaths) {
    const text = read(rel)?.toString('utf8');
    if (text === undefined) continue;
    const applyTo = parseFrontmatter(text)?.applyTo;
    if (applyTo !== INSTRUCTIONS_APPLY_TO) errors.push(`${rel}: applyTo must be '${INSTRUCTIONS_APPLY_TO}' (found '${applyTo ?? ''}')`);
  }

  // 4. Exactly the five contract tools, reference names and activation events.
  const tools = Array.isArray(contributes.languageModelTools) ? contributes.languageModelTools : [];
  const actual = new Map();
  for (const tool of tools) {
    if (actual.has(tool?.name)) errors.push(`package.json: languageModelTools "${tool?.name}" is declared more than once`);
    actual.set(tool?.name, tool);
  }
  const expectedNames = Object.keys(EXPECTED_TOOLS);
  for (const name of actual.keys()) {
    if (!expectedNames.includes(name)) errors.push(`package.json: unexpected languageModelTools "${name}"`);
  }
  const activationEvents = Array.isArray(pkg.activationEvents) ? pkg.activationEvents : [];
  for (const [name, referenceName] of Object.entries(EXPECTED_TOOLS)) {
    const tool = actual.get(name);
    if (!tool) {
      errors.push(`package.json: languageModelTools "${name}" is missing`);
    } else {
      if (tool.toolReferenceName !== referenceName) errors.push(`package.json: languageModelTools "${name}" toolReferenceName must be "${referenceName}"`);
      if (tool.canBeReferencedInPrompt !== true) errors.push(`package.json: languageModelTools "${name}" must set canBeReferencedInPrompt: true`);
    }
    if (!activationEvents.includes(`onLanguageModelTool:${name}`)) errors.push(`package.json: activationEvents is missing "onLanguageModelTool:${name}"`);
  }
  for (const event of activationEvents) {
    const name = /^onLanguageModelTool:(.*)$/.exec(event)?.[1];
    if (name !== undefined && !expectedNames.includes(name)) errors.push(`package.json: unexpected activation event "${event}"`);
  }

  // 5. No excluded integration identifier in AI assets or tool descriptions.
  const scanned = listFiles(join(root, 'ai')).map(path => [relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8')]);
  for (const tool of tools) scanned.push([`package.json languageModelTools "${tool?.name}"`, JSON.stringify(tool)]);
  for (const [label, text] of scanned) {
    for (const id of EXCLUDED_IDENTIFIERS) {
      if (text.includes(id)) errors.push(`${label}: contains excluded identifier "${id}"`);
    }
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = checkAiSync(root);
  if (errors.length) {
    console.error(`check:ai: ${errors.length} problem(s) found:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('check:ai: AI assets are in sync with docs/specs and package.json');
}
