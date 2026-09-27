// Shared, deterministic logic for the GuitarDSL Help generator and sync checker.
// Node built-ins only. Pure functions take already-loaded inputs so they can be
// unit-tested with in-memory fixtures; loadRepoInputs() is the only filesystem reader.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LOCALES = ['ja', 'en'];
export const GENERATED_FILES = {
  ja: 'media/help/guitardsl-help.ja.md',
  en: 'media/help/guitardsl-help.en.md'
};
export const GENERATED_HEADER =
  '<!-- GENERATED FILE. DO NOT EDIT. Source: docs/help/help-manifest.json + docs/help/{locale} + package metadata. Regenerate with: npm run generate:help -->';

const TOP_HEADING = /^## (.*)$/;
const NUMBERED = /^(\d+[A-Z]?)\.\s+(.+?)\s*$/;

/**
 * Split a spec into its top-level `##` sections. Numbered headings ("4A. ...")
 * are keyed by their number; unnumbered ones are reported as errors because
 * they cannot be classified by the manifest.
 */
export function extractSections(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections = new Map();
  const errors = [];
  let current = null;
  let inFence = false;
  const close = () => {
    if (!current) return;
    if (sections.has(current.id)) {
      errors.push(`duplicate section number "${current.id}"`);
    } else {
      sections.set(current.id, { id: current.id, title: current.title, body: current.lines.join('\n') });
    }
    current = null;
  };
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && TOP_HEADING.exec(line);
    if (m) {
      close();
      const num = NUMBERED.exec(m[1]);
      if (!num) {
        errors.push(`unnumbered top-level section "## ${m[1]}" cannot be classified`);
        continue;
      }
      current = { id: num[1], title: num[2], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  close();
  return { sections, errors };
}

/** Normalize section text before hashing: LF, no trailing spaces, no edge blank lines or `---` rules. */
export function normalizeSection(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && (lines[lines.length - 1] === '' || /^-{3,}$/.test(lines[lines.length - 1]))) lines.pop();
  return lines.join('\n') + '\n';
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sectionDigest(section) {
  return sha256(normalizeSection(section.body));
}

const isNonEmptyString = v => typeof v === 'string' && v.trim() !== '';

// Every heading of an authored Help page declares the spec sections its prose explains,
// on the line right after the heading: <!-- help-sources: syntax:17 extension:3 -->
// Markers are stripped from the generated output.
export const TOPIC_MARKER = /^<!-- help-sources:(.*)-->[ \t]*$/;
const MARKER_REF = /^([A-Za-z][A-Za-z0-9_-]*):(\d+[A-Z]?)$/;

/** Headings of one authored page with the source refs declared by their markers. */
export function extractPageTopics(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const topics = [];
  const errors = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const marker = TOPIC_MARKER.exec(line);
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (marker && !/^#{1,6}\s/.test(lines[i - 1] ?? '')) {
      errors.push(`line ${i + 1}: help-sources marker must directly follow a heading`);
    }
    if (!heading) continue;
    const next = TOPIC_MARKER.exec(lines[i + 1] ?? '');
    if (!next) {
      errors.push(`heading "${heading[2]}" (line ${i + 1}) has no <!-- help-sources: ... --> marker on the next line`);
      continue;
    }
    const refs = [];
    for (const token of next[1].trim().split(/\s+/).filter(Boolean)) {
      const m = MARKER_REF.exec(token);
      if (m) refs.push({ source: m[1], section: m[2] });
      else errors.push(`heading "${heading[2]}" (line ${i + 2}): malformed help-sources entry "${token}" (expected source:section)`);
    }
    if (refs.length === 0 && next[1].trim() === '') errors.push(`heading "${heading[2]}" (line ${i + 2}): help-sources marker lists no spec section`);
    topics.push({ heading: heading[2], line: i + 1, refs });
  }
  return { topics, errors };
}

/**
 * Topic ownership: every heading's prose must be owned by covered spec sections, every covered
 * section must be claimed on its Help page, and both locales must claim the same sections.
 * A removed or excluded section therefore cannot leave orphaned Help prose behind.
 */
function validateTopics(manifest, pageFiles) {
  const errors = [];
  const covered = new Map(); // "source:section" -> helpPage
  for (const c of manifest.coverage) {
    if (c && isNonEmptyString(c.source) && isNonEmptyString(c.section)) covered.set(`${c.source}:${c.section}`, c.helpPage);
  }
  const excluded = new Set(manifest.excludedSections.filter(e => e && isNonEmptyString(e.source)).map(e => `${e.source}:${e.section}`));
  const claimedByPage = {}; // `${locale}/${page}` -> Set(ref)
  for (const page of manifest.pages) {
    if (!page || !isNonEmptyString(page.id)) continue;
    for (const locale of LOCALES) {
      const key = `${locale}/${page.id}`;
      const text = pageFiles[key];
      if (text === undefined) continue;
      const file = `docs/help/${key}.md`;
      const { topics, errors: topicErrors } = extractPageTopics(text);
      topicErrors.forEach(e => errors.push(`${file}: ${e}`));
      const claimed = new Set();
      for (const t of topics) {
        for (const r of t.refs) {
          const ref = `${r.source}:${r.section}`;
          claimed.add(ref);
          if (!covered.has(ref)) {
            const why = excluded.has(ref) ? 'is excluded from Help' : 'is not covered by the manifest (removed or renumbered?)';
            errors.push(`${file}: heading "${t.heading}" explains ${r.source} §${r.section}, which ${why}: remove or rewrite this obsolete Help prose`);
          }
        }
      }
      claimedByPage[key] = claimed;
    }
  }
  for (const [ref, helpPage] of covered) {
    for (const locale of LOCALES) {
      const claimed = claimedByPage[`${locale}/${helpPage}`];
      if (claimed && !claimed.has(ref)) {
        const [src, sec] = ref.split(':');
        errors.push(`docs/help/${locale}/${helpPage}.md: no heading claims ${src} §${sec} (add "${ref}" to the help-sources marker of the heading that explains it)`);
      }
    }
  }
  for (const page of manifest.pages) {
    if (!page || !isNonEmptyString(page.id)) continue;
    const ja = claimedByPage[`ja/${page.id}`];
    const en = claimedByPage[`en/${page.id}`];
    if (!ja || !en) continue;
    const onlyJa = [...ja].filter(r => !en.has(r)).sort();
    const onlyEn = [...en].filter(r => !ja.has(r)).sort();
    if (onlyJa.length || onlyEn.length) {
      errors.push(`page "${page.id}": ja and en claim different spec sections (only ja: ${onlyJa.join(' ') || '-'}; only en: ${onlyEn.join(' ') || '-'})`);
    }
  }
  return errors;
}

/** True when `pages` is structurally usable for rendering. */
export function pagesAreRenderable(manifest) {
  return Array.isArray(manifest?.pages) && manifest.pages.every(p => p && isNonEmptyString(p.id));
}

/**
 * Validate manifest shape, references, coverage completeness and digests.
 * `specTexts` maps source id -> markdown text (undefined when the file is missing).
 * `pageFiles` maps `${locale}/${pageId}` -> page text (undefined when missing).
 */
export function validateManifest(manifest, specTexts, pageFiles) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest: must be a JSON object'];
  }
  const { sources, pages, coverage, excludedSections } = manifest;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) errors.push('manifest.sources: must be an object of sourceId -> path');
  if (!Array.isArray(pages) || pages.length === 0) errors.push('manifest.pages: must be a non-empty array');
  if (!Array.isArray(coverage)) errors.push('manifest.coverage: must be an array');
  if (!Array.isArray(excludedSections)) errors.push('manifest.excludedSections: must be an array');
  if (errors.length) return errors;

  const pageIds = new Set();
  pages.forEach((p, i) => {
    if (!p || !isNonEmptyString(p.id) || !/^[a-z][a-z0-9-]*$/.test(p.id)) {
      errors.push(`manifest.pages[${i}]: "id" must be a lowercase identifier`);
      return;
    }
    if (pageIds.has(p.id)) errors.push(`manifest.pages[${i}]: duplicate page id "${p.id}"`);
    pageIds.add(p.id);
    for (const locale of LOCALES) {
      const text = pageFiles[`${locale}/${p.id}`];
      if (text === undefined) errors.push(`page "${p.id}": missing source file docs/help/${locale}/${p.id}.md`);
      else if (text.trim() === '') errors.push(`page "${p.id}": docs/help/${locale}/${p.id}.md is empty`);
    }
  });

  const parsed = {};
  for (const [id, path] of Object.entries(sources)) {
    if (!isNonEmptyString(path)) {
      errors.push(`manifest.sources.${id}: path must be a non-empty string`);
      continue;
    }
    const text = specTexts[id];
    if (text === undefined) {
      errors.push(`source "${id}": file not found: ${path}`);
      continue;
    }
    const { sections, errors: sectionErrors } = extractSections(text);
    sectionErrors.forEach(e => errors.push(`source "${id}" (${path}): ${e}`));
    parsed[id] = sections;
  }

  const classified = new Map(); // "source§section" -> where
  const claim = (entry, where) => {
    const key = `${entry.source}§${entry.section}`;
    if (classified.has(key)) {
      errors.push(`${where}: duplicate mapping for ${entry.source} §${entry.section} (already in ${classified.get(key)})`);
      return false;
    }
    classified.set(key, where);
    return true;
  };
  const checkRef = (entry, where) => {
    if (!entry || !isNonEmptyString(entry.source) || !isNonEmptyString(entry.section)) {
      errors.push(`${where}: "source" and "section" must be non-empty strings`);
      return null;
    }
    if (!(entry.source in sources)) {
      errors.push(`${where}: unknown source id "${entry.source}"`);
      return null;
    }
    const sections = parsed[entry.source];
    if (!sections) return null;
    const section = sections.get(entry.section);
    if (!section) {
      errors.push(`${where}: ${entry.source} §${entry.section} does not exist (deleted or renumbered?) in ${sources[entry.source]}`);
      return null;
    }
    return section;
  };

  coverage.forEach((entry, i) => {
    const where = `manifest.coverage[${i}]`;
    const section = checkRef(entry, where);
    if (entry && isNonEmptyString(entry.source) && isNonEmptyString(entry.section)) claim(entry, where);
    if (!entry) return;
    if (!pageIds.has(entry.helpPage)) errors.push(`${where}: unknown helpPage "${entry.helpPage}"`);
    if (!/^[0-9a-f]{64}$/.test(entry.reviewedSourceSha256 ?? '')) {
      errors.push(`${where}: reviewedSourceSha256 must be a 64-character lowercase hex SHA-256`);
    } else if (section) {
      const actual = sectionDigest(section);
      if (actual !== entry.reviewedSourceSha256) {
        errors.push(
          `${entry.source} §${entry.section} (${section.title}) changed since the Help was reviewed: ` +
          `review docs/help/*/${entry.helpPage}.md against ${sources[entry.source]} §${entry.section}, ` +
          `then set reviewedSourceSha256 to ${actual}`
        );
      }
    }
  });

  excludedSections.forEach((entry, i) => {
    const where = `manifest.excludedSections[${i}]`;
    checkRef(entry, where);
    if (entry && isNonEmptyString(entry.source) && isNonEmptyString(entry.section)) claim(entry, where);
    if (!entry || !isNonEmptyString(entry.reason)) errors.push(`${where}: exclusion reason must be non-empty`);
  });

  for (const [id, sections] of Object.entries(parsed)) {
    for (const section of sections.values()) {
      if (!classified.has(`${id}§${section.id}`)) {
        errors.push(
          `${id} §${section.id} (${section.title}) in ${sources[id]} is not covered by any Help page: ` +
          `add a manifest.coverage entry (digest ${sectionDigest(section)}) or a manifest.excludedSections entry with a reason`
        );
      }
    }
  }
  errors.push(...validateTopics(manifest, pageFiles));
  return errors;
}

const nlsKey = value => {
  const m = typeof value === 'string' ? /^%(.+)%$/.exec(value) : null;
  return m ? m[1] : null;
};

/** Localize a manifest string ("%key%" or literal) with fallback to English, then to the raw value. */
function localize(value, locale, nls) {
  const key = nlsKey(value);
  if (!key) return value ?? '';
  return nls[locale]?.[key] ?? nls.en?.[key] ?? value;
}

/** Commands and settings contributed by package.json, in manifest order. */
export function extractPackageInventory(pkg) {
  const contributes = pkg.contributes ?? {};
  const commands = (contributes.commands ?? []).map(c => ({ id: c.command, title: c.title }));
  const configs = [];
  const configurations = Array.isArray(contributes.configuration) ? contributes.configuration : [contributes.configuration ?? {}];
  for (const conf of configurations) {
    for (const [key, prop] of Object.entries(conf.properties ?? {})) {
      configs.push({ key, type: prop.type, default: prop.default, description: prop.markdownDescription ?? prop.description });
    }
  }
  return { commands, configs };
}

const ID_IN_BACKTICKS = /`(guitardsl\.[A-Za-z0-9_.]+)`/g;

/**
 * Command IDs and setting keys documented in extension spec §3: the command table
 * (first header cell "コマンドID"), the `### 3.x` command subsection headings, and
 * the setting table (first header cell "設定キー").
 */
export function extractSpecInventory(extensionSpec) {
  const errors = [];
  const { sections } = extractSections(extensionSpec);
  const commandsSection = sections.get('3');
  if (!commandsSection) return { tableCommands: new Set(), headingCommands: new Set(), configs: new Set(), errors: ['extension spec: §3 (Commands) not found'] };
  const lines = commandsSection.body.split('\n');
  const tableCommands = new Set();
  const headingCommands = new Set();
  const configs = new Set();
  let table = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^###\s/.test(line)) {
      for (const m of line.matchAll(ID_IN_BACKTICKS)) headingCommands.add(m[1]);
    }
    if (!line.startsWith('|')) {
      table = null;
      continue;
    }
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
    if (table === null) {
      table = cells[0] === 'コマンドID' ? tableCommands : cells[0] === '設定キー' ? configs : undefined;
      continue;
    }
    if (!table || /^:?-+:?$/.test(cells[0])) continue;
    const m = /^`(guitardsl\.[A-Za-z0-9_.]+)`$/.exec(cells[0]);
    if (m) table.add(m[1]);
  }
  if (tableCommands.size === 0) errors.push('extension spec §3: command table (header "コマンドID") not found or empty');
  return { tableCommands, headingCommands, configs, errors };
}

const setDiff = (a, b) => [...a].filter(x => !b.has(x)).sort();

/** Exact-set parity between package.json and the extension spec, plus NLS completeness. */
export function checkParity(pkg, nls, extensionSpec) {
  const errors = [];
  const inv = extractPackageInventory(pkg);
  const spec = extractSpecInventory(extensionSpec);
  errors.push(...spec.errors);
  const pkgCommands = new Set(inv.commands.map(c => c.id));
  const pkgConfigs = new Set(inv.configs.map(c => c.key));
  for (const id of setDiff(pkgCommands, spec.tableCommands)) errors.push(`command ${id}: contributed in package.json but missing from the docs/specs/extension.md §3 command table`);
  for (const id of setDiff(spec.tableCommands, pkgCommands)) errors.push(`command ${id}: listed in the docs/specs/extension.md §3 command table but not contributed in package.json`);
  for (const id of setDiff(pkgCommands, spec.headingCommands)) errors.push(`command ${id}: contributed in package.json but has no docs/specs/extension.md §3 subsection heading`);
  for (const id of setDiff(spec.headingCommands, pkgCommands)) errors.push(`command ${id}: has a docs/specs/extension.md §3 subsection heading but is not contributed in package.json`);
  for (const key of setDiff(pkgConfigs, spec.configs)) errors.push(`setting ${key}: contributed in package.json but missing from the docs/specs/extension.md §3.7 setting table`);
  for (const key of setDiff(spec.configs, pkgConfigs)) errors.push(`setting ${key}: listed in the docs/specs/extension.md §3.7 setting table but not contributed in package.json`);

  const required = [
    ...inv.commands.map(c => ({ owner: `command ${c.id}`, key: nlsKey(c.title) })),
    ...inv.configs.map(c => ({ owner: `setting ${c.key}`, key: nlsKey(c.description) }))
  ];
  for (const { owner, key } of required) {
    if (!key) continue;
    for (const [locale, file] of [['en', 'package.nls.json'], ['ja', 'package.nls.ja.json']]) {
      if (!isNonEmptyString(nls[locale]?.[key])) errors.push(`${owner}: localization key "${key}" missing from ${file}`);
    }
  }
  return errors;
}

const REFERENCE_TEXT = {
  ja: {
    commands: 'コマンド一覧',
    commandsIntro: 'コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）から実行できます。この一覧は `package.json` から自動生成されています。',
    commandHeader: '| コマンド | ID |',
    settings: '設定一覧',
    settingsIntro: 'VS Code の設定（`Ctrl+,` / `Cmd+,`）で変更できます。この一覧は `package.json` から自動生成されています。',
    settingHeader: '| 設定キー | 型 | 既定値 | 説明 |'
  },
  en: {
    commands: 'Command Reference',
    commandsIntro: 'Run these from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). This list is generated from `package.json`.',
    commandHeader: '| Command | ID |',
    settings: 'Settings Reference',
    settingsIntro: 'Change these in VS Code Settings (`Ctrl+,` / `Cmd+,`). This list is generated from `package.json`.',
    settingHeader: '| Setting | Type | Default | Description |'
  }
};

const cell = text => String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/** Render one locale's packaged Help document. Deterministic: LF, single trailing newline. */
export function renderHelp({ manifest, locale, pageFiles, pkg, nls }) {
  const t = REFERENCE_TEXT[locale];
  const inv = extractPackageInventory(pkg);
  const parts = [GENERATED_HEADER];
  for (const page of manifest.pages) {
    if (!page || !isNonEmptyString(page.id)) continue;
    const text = (pageFiles[`${locale}/${page.id}`] ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter(line => !TOPIC_MARKER.test(line))
      .join('\n')
      .trim();
    parts.push(text);
  }
  const commandRows = inv.commands.map(c => `| ${cell(localize(c.title, locale, nls))} | \`${c.id}\` |`);
  parts.push([`## ${t.commands}`, '', t.commandsIntro, '', t.commandHeader, '|---|---|', ...commandRows].join('\n'));
  const settingRows = inv.configs.map(c =>
    `| \`${c.key}\` | \`${cell(c.type ?? '')}\` | \`${cell(JSON.stringify(c.default))}\` | ${cell(localize(c.description, locale, nls))} |`
  );
  parts.push([`## ${t.settings}`, '', t.settingsIntro, '', t.settingHeader, '|---|---|---|---|', ...settingRows].join('\n'));
  return parts.join('\n\n') + '\n';
}

export function renderAll(inputs) {
  const out = {};
  for (const locale of LOCALES) out[GENERATED_FILES[locale]] = renderHelp({ ...inputs, locale });
  return out;
}

/** Compare committed generated files with the expected rendering. */
export function checkGenerated(expected, actualFiles) {
  const errors = [];
  for (const [path, content] of Object.entries(expected)) {
    const actual = actualFiles[path];
    if (actual === undefined) errors.push(`${path}: generated Help file is missing; run npm run generate:help`);
    else if (actual !== content) errors.push(`${path}: generated Help file is stale or was edited by hand; run npm run generate:help`);
  }
  return errors;
}

/** Run every check against loaded inputs. Returns a list of actionable error strings. */
export function runAllChecks(inputs) {
  const errors = [];
  if (inputs.loadErrors?.length) return inputs.loadErrors;
  const manifestErrors = validateManifest(inputs.manifest, inputs.specTexts, inputs.pageFiles);
  errors.push(...manifestErrors);
  const extensionSpec = inputs.specTexts.extension;
  if (extensionSpec === undefined) errors.push('manifest.sources.extension: the extension spec source is required for command/setting parity');
  else errors.push(...checkParity(inputs.pkg, inputs.nls, extensionSpec));
  // Only compare generated output when the manifest can be rendered; structural errors are already reported.
  if (pagesAreRenderable(inputs.manifest)) errors.push(...checkGenerated(renderAll(inputs), inputs.generatedFiles));
  return errors;
}

const readIfExists = path => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

function readJson(root, rel, loadErrors) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (e) {
    loadErrors.push(`${rel}: cannot read or parse JSON (${e.message})`);
    return undefined;
  }
}

/** Load every input the generator and checker need from the repository. */
export function loadRepoInputs(root) {
  const loadErrors = [];
  const manifest = readJson(root, 'docs/help/help-manifest.json', loadErrors);
  const pkg = readJson(root, 'package.json', loadErrors);
  const nls = { en: readJson(root, 'package.nls.json', loadErrors), ja: readJson(root, 'package.nls.ja.json', loadErrors) };
  const specTexts = {};
  const pageFiles = {};
  if (manifest && typeof manifest === 'object') {
    for (const [id, rel] of Object.entries(manifest.sources ?? {})) {
      if (typeof rel === 'string') specTexts[id] = readIfExists(join(root, rel));
    }
    for (const page of Array.isArray(manifest.pages) ? manifest.pages : []) {
      if (typeof page?.id !== 'string') continue;
      for (const locale of LOCALES) pageFiles[`${locale}/${page.id}`] = readIfExists(join(root, 'docs/help', locale, `${page.id}.md`));
    }
  }
  const generatedFiles = {};
  for (const rel of Object.values(GENERATED_FILES)) generatedFiles[rel] = readIfExists(join(root, rel));
  return { manifest, pkg, nls, specTexts, pageFiles, generatedFiles, loadErrors };
}
