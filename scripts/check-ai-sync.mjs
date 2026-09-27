// Read-only AI asset synchronization gate (npm run check:ai).
// Fails when the packaged Skill reference differs from the canonical syntax spec, the Skill name does not
// match its directory, a contributed AI path is missing, the language model tool contract drifted, the
// Skill / instructions do not describe the accompaniment tools, the new-score workflow lost its discovery
// metadata, its validate -> analyze -> apply -> validate order or its distinct-new-target binding, the Skill does
// not link its supporting resources or allows a sample fallback, the minimal-intent planning policy drifted, an AI asset /
// tool description mentions an excluded integration, or the accompaniment code imports one. It never repairs anything.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CANONICAL_SYNTAX_SPEC = 'docs/specs/guitardsl-syntax.md';
export const SKILL_REFERENCE = 'ai/skills/guitardsl-language/references/guitardsl-syntax.md';
export const INSTRUCTIONS_PATH = 'ai/instructions/guitardsl.instructions.md';
export const SKILL_PATH = 'ai/skills/guitardsl-language/SKILL.md';
/** Authored accompaniment guide the Skill points to (not generated, not a spec copy). */
export const ACCOMPANIMENT_GUIDE = 'ai/skills/guitardsl-language/references/accompaniment.md';
export const INSTRUCTIONS_APPLY_TO = '**/*.{guitardsl,gdsl}';

/** The exact tool contract (extension spec §8.3): tool name -> prompt reference name. */
export const EXPECTED_TOOLS = Object.freeze({
  guitardsl_validate_dsl: 'guitardslValidate',
  guitardsl_analyze_playability: 'guitardslPlayability',
  guitardsl_apply_capo: 'guitardslApplyCapo',
  guitardsl_apply_beginner_mode: 'guitardslApplyBeginner',
  guitardsl_apply_transpose: 'guitardslTranspose',
  guitardsl_analyze_accompaniment: 'guitardslAccompaniment',
  guitardsl_apply_accompaniment: 'guitardslApplyAccompaniment'
});

/** Tools the Skill and the instructions must both name (the accompaniment workflow, spec §8.2). */
export const WORKFLOW_TOOLS = Object.freeze(['guitardsl_analyze_accompaniment', 'guitardsl_apply_accompaniment']);

/**
 * New-score workflow (extension spec §8.2): each asset keeps a section starting at its marker, and that section
 * names the tools in this order. Checked with ordered markers, not byte-for-byte prose.
 */
export const NEW_SCORE_SECTIONS = Object.freeze({
  [INSTRUCTIONS_PATH]: '## New GuitarDSL score workflow',
  [SKILL_PATH]: 'New score from scratch',
  [ACCOMPANIMENT_GUIDE]: '## New score from scratch'
});
export const NEW_SCORE_WORKFLOW_ORDER = Object.freeze(['guitardsl_validate_dsl', 'guitardsl_analyze_accompaniment', 'guitardsl_apply_accompaniment', 'guitardsl_validate_dsl']);
/** Phrases every new-score section keeps: draft first, no hand-written D/U, no manual fallback after a tool failure. */
export const NEW_SCORE_SECTION_MARKERS = Object.freeze([/structural draft/i, /D\/U/, /\b(do not|never) fall back to (manual|hand-written)\b|\bno manual fallback\b/i]);
/** Phrases both accompaniment tool modelDescriptions keep, in this order. */
export const NEW_SCORE_TOOL_MARKERS = Object.freeze(['New score', 'structural draft', 'not handwritten']);

/** New-score target identity (spec §8.2): a distinct new document, no reuse of an open score, every step pinned to it. */
const DISTINCT_NEW_TARGET = /\bdistinct new GuitarDSL document\b/i;
const NO_EXISTING_REUSE = /\b(never|do not) reuse (an?|the) (active|existing)\b/i;
const PINNED_TARGET = /\bpin(ned)?\b/i;
export const NEW_SCORE_TARGET_MARKERS = Object.freeze({
  [INSTRUCTIONS_PATH]: [DISTINCT_NEW_TARGET, NO_EXISTING_REUSE, PINNED_TARGET, /\bsame new target\b/i, /\btarget-less validate\/analyze\b/i],
  [SKILL_PATH]: [DISTINCT_NEW_TARGET, NO_EXISTING_REUSE, PINNED_TARGET],
  [ACCOMPANIMENT_GUIDE]: [DISTINCT_NEW_TARGET, NO_EXISTING_REUSE, PINNED_TARGET, /\bsame exact document\b/i]
});
/** The Skill limits its current-file (no-argument) resolution rule to existing scores. */
export const SKILL_EXISTING_ONLY = /existing-score tasks only; never for a new\/create request/;
/** Target-binding phrases each tool modelDescription keeps. */
export const NEW_SCORE_TARGET_TOOL_MARKERS = Object.freeze({
  guitardsl_validate_dsl: [/\bNew\/create-song workflow\b/, /\bdo not use the fallback resolution to select an existing score\b/],
  guitardsl_analyze_accompaniment: [/\balready-created new target\b/, /\bdo not search for another open score\b/],
  guitardsl_apply_accompaniment: [/\bsame new document used by validation\/analyze\b/]
});

/** Supporting resources SKILL.md must reference as Markdown relative links (a code span alone is not resolvable). */
export const SKILL_RESOURCE_LINKS = Object.freeze(['./references/guitardsl-syntax.md', './references/accompaniment.md']);
/** No substitute specification from existing scores / samples, and a missing resource is reported (spec §8.2). */
export const NO_SAMPLE_FALLBACK_MARKERS = Object.freeze({
  [SKILL_PATH]: [/\bsamples?\b[^.]*\bsubstitute specification\b/i, /\breport the missing resource\b/i],
  [INSTRUCTIONS_PATH]: [/\bexisting GuitarDSL files or samples\b/i, /\bdo not substitute an existing score\/sample\b/i, /\breport the unavailable Skill resource\b/i]
});

/** Minimal-intent planning policy (spec §8.2): where it lives, and the phrases each place keeps. */
export const MINIMAL_INTENT_SECTION = '## Keep intent plans minimal';
export const MINIMAL_INTENT_MARKERS = Object.freeze({
  [ACCOMPANIMENT_GUIDE]: [
    /`subdivision: auto`/, /\boptional hard constraints, not defaults\b/i, /\bdo not browse presets family by family\b/i,
    /\bmany compatible candidates is normal\b/i, /\blet the deterministic engine choose\b/i, /\bheadroom for the finale\b/i,
    /\bdo not add `transitions` at every boundary\b/i, /\bone primary candidate and at most one fallback\b/i,
    /\bretry once with minimal intent\b/i, /\bnever relax a constraint the user asked for\b/i
  ],
  [INSTRUCTIONS_PATH]: [/\bkeep the intent broad\b/i, /`subdivision: auto`/, /\bomit optional hard constraints\b/i, /\bdo not browse family preset lists\b/i, /\bheadroom for the finale\b/i]
});
export const MINIMAL_INTENT_TOOL_MARKERS = Object.freeze({
  guitardsl_analyze_accompaniment: [/\bcall whole-score analysis once\b/, /\bdo not request sectionIndex\+family merely to browse presets\b/],
  guitardsl_apply_accompaniment: [/\bprefer subdivision auto\b/, /\bomit optional hard constraints\b/]
});

/** Accompaniment / AI tool sources that must stay independent of the excluded integrations. */
export const ISOLATED_SOURCES = Object.freeze(['src/accompaniment.ts', 'src/strummingPatterns.ts', 'src/strummingCodeLens.ts', 'src/ai/tools.ts']);
export const EXCLUDED_IMPORTS = Object.freeze(['@google/genai', '/transcription', 'audioMir', 'audio-mir']);

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

/** True when every marker occurs in `text`, each after the end of the previous one. */
export function hasOrderedMarkers(text, markers) {
  let from = 0;
  for (const marker of markers) {
    const at = text.indexOf(marker, from);
    if (at < 0) return false;
    from = at + marker.length;
  }
  return true;
}

/** The text from `marker` to the next `## ` heading (or the end); undefined when the marker is absent. */
export function sectionFrom(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return undefined;
  const rest = text.slice(start + marker.length);
  const end = rest.search(/^## /m);
  return marker + (end < 0 ? rest : rest.slice(0, end));
}

/** True when `text` has an inline Markdown link `[label](destination)` whose destination is exactly `destination`. */
export function hasMarkdownLinkTo(text, destination) {
  const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[[^\\]\\n]+\\]\\(\\s*<?${escaped}>?(?:\\s+"[^"]*")?\\s*\\)`).test(text);
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

  // 4. Exactly the seven contract tools, reference names and activation events.
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

  // 6. The Skill, its accompaniment guide and the instructions describe the accompaniment workflow tools.
  if (!read(SKILL_PATH)?.toString('utf8').includes('references/accompaniment.md')) errors.push(`${SKILL_PATH}: must point to references/accompaniment.md`);
  for (const rel of [SKILL_PATH, ACCOMPANIMENT_GUIDE, INSTRUCTIONS_PATH]) {
    const text = read(rel)?.toString('utf8');
    if (text === undefined) {
      errors.push(`${rel}: missing`);
      continue;
    }
    for (const name of WORKFLOW_TOOLS) {
      if (!text.includes(name)) errors.push(`${rel}: must reference ${name}`);
    }
  }

  // 7. New-score discovery: the instructions and the Skill are relevant to creating a new song before a file exists.
  const instructionsDescription = parseFrontmatter(read(INSTRUCTIONS_PATH)?.toString('utf8') ?? '')?.description ?? '';
  if (!instructionsDescription) errors.push(`${INSTRUCTIONS_PATH}: frontmatter needs a non-empty task-relevance description`);
  else if (!(/GuitarDSL/.test(instructionsDescription) && /\b(creat|compos)/i.test(instructionsDescription) && /\bnew (song|score)\b/i.test(instructionsDescription) && /\bbefore\b.*\bfile\b.*\b(exists|present)\b/i.test(instructionsDescription))) {
    errors.push(`${INSTRUCTIONS_PATH}: description must cover creating a new GuitarDSL song/score before a GuitarDSL file exists`);
  }
  const skillDescription = parseFrontmatter(read(SKILL_PATH)?.toString('utf8') ?? '')?.description ?? '';
  if (!(/GuitarDSL/.test(skillDescription) && /\bcreat/i.test(skillDescription) && /\bcompos/i.test(skillDescription) && /\bnew\b[^.]*\b(song|score)\b/i.test(skillDescription) && /\baccompaniment\b/i.test(skillDescription))) {
    errors.push(`${SKILL_PATH}: description must cover creating/composing a new GuitarDSL song or score and arranging its accompaniment`);
  }

  // 8. The new-score workflow is kept in all three assets, in order, and in both accompaniment tool descriptions.
  for (const [rel, marker] of Object.entries(NEW_SCORE_SECTIONS)) {
    const text = read(rel)?.toString('utf8');
    if (text === undefined) continue;
    const section = sectionFrom(text, marker);
    if (section === undefined) {
      errors.push(`${rel}: missing the new-score workflow "${marker}"`);
      continue;
    }
    if (!hasOrderedMarkers(section, NEW_SCORE_WORKFLOW_ORDER)) errors.push(`${rel}: new-score workflow must name ${NEW_SCORE_WORKFLOW_ORDER.join(' -> ')} in order`);
    for (const pattern of NEW_SCORE_SECTION_MARKERS) {
      if (!pattern.test(section)) errors.push(`${rel}: new-score workflow must keep ${pattern}`);
    }
  }
  if (!sectionFrom(read(SKILL_PATH)?.toString('utf8') ?? '', NEW_SCORE_SECTIONS[SKILL_PATH])?.includes('references/accompaniment.md')) {
    errors.push(`${SKILL_PATH}: new-score rule must point to references/accompaniment.md`);
  }
  for (const name of WORKFLOW_TOOLS) {
    const description = String(actual.get(name)?.modelDescription ?? '');
    if (!hasOrderedMarkers(description, NEW_SCORE_TOOL_MARKERS)) errors.push(`package.json: languageModelTools "${name}" modelDescription must keep the new-score guidance (${NEW_SCORE_TOOL_MARKERS.join(' -> ')})`);
  }

  // 9. New-score target identity: the new-score sections and the tool descriptions bind the workflow to a distinct new document.
  for (const [rel, patterns] of Object.entries(NEW_SCORE_TARGET_MARKERS)) {
    const section = sectionFrom(read(rel)?.toString('utf8') ?? '', NEW_SCORE_SECTIONS[rel]);
    if (section === undefined) continue; // reported by check 8
    for (const pattern of patterns) {
      if (!pattern.test(section)) errors.push(`${rel}: new-score target identity must keep ${pattern}`);
    }
  }
  if (!SKILL_EXISTING_ONLY.test(read(SKILL_PATH)?.toString('utf8') ?? '')) errors.push(`${SKILL_PATH}: the current-file resolution rule must be limited to existing-score tasks (${SKILL_EXISTING_ONLY})`);
  for (const [name, patterns] of Object.entries(NEW_SCORE_TARGET_TOOL_MARKERS)) {
    const description = String(actual.get(name)?.modelDescription ?? '');
    for (const pattern of patterns) {
      if (!pattern.test(description)) errors.push(`package.json: languageModelTools "${name}" modelDescription must keep the new-target binding ${pattern}`);
    }
  }

  // 10. The Skill links its supporting resources; neither asset allows existing scores / samples as a substitute specification.
  const skillText = read(SKILL_PATH)?.toString('utf8') ?? '';
  for (const destination of SKILL_RESOURCE_LINKS) {
    if (!hasMarkdownLinkTo(skillText, destination)) errors.push(`${SKILL_PATH}: must reference ${destination} with a Markdown relative link [label](${destination})`);
  }
  for (const [rel, patterns] of Object.entries(NO_SAMPLE_FALLBACK_MARKERS)) {
    const text = read(rel)?.toString('utf8') ?? '';
    for (const pattern of patterns) {
      if (!pattern.test(text)) errors.push(`${rel}: no-sample-fallback policy must keep ${pattern}`);
    }
  }

  // 11. Minimal-intent planning: broad intent, no preset browsing, engine choice, finale headroom, small transition / ending budgets.
  const minimalScopes = {
    [ACCOMPANIMENT_GUIDE]: sectionFrom(read(ACCOMPANIMENT_GUIDE)?.toString('utf8') ?? '', MINIMAL_INTENT_SECTION),
    [INSTRUCTIONS_PATH]: sectionFrom(read(INSTRUCTIONS_PATH)?.toString('utf8') ?? '', NEW_SCORE_SECTIONS[INSTRUCTIONS_PATH])
  };
  for (const [rel, patterns] of Object.entries(MINIMAL_INTENT_MARKERS)) {
    const scope = minimalScopes[rel];
    if (scope === undefined) {
      errors.push(`${rel}: missing the minimal-intent planning policy`);
      continue;
    }
    for (const pattern of patterns) {
      if (!pattern.test(scope)) errors.push(`${rel}: minimal-intent planning policy must keep ${pattern}`);
    }
  }
  for (const [name, patterns] of Object.entries(MINIMAL_INTENT_TOOL_MARKERS)) {
    const description = String(actual.get(name)?.modelDescription ?? '');
    for (const pattern of patterns) {
      if (!pattern.test(description)) errors.push(`package.json: languageModelTools "${name}" modelDescription must keep the minimal-intent guidance ${pattern}`);
    }
  }

  // 12. The accompaniment engine and the tool adapter import no excluded integration.
  for (const rel of ISOLATED_SOURCES) {
    const text = read(rel)?.toString('utf8');
    if (text === undefined) {
      errors.push(`${rel}: missing`);
      continue;
    }
    for (const spec of text.matchAll(/^\s*import\b[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (EXCLUDED_IMPORTS.some(id => spec[1].includes(id))) errors.push(`${rel}: imports excluded module "${spec[1]}"`);
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
