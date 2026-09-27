// Generate the packaged Help (media/help/guitardsl-help.{ja,en}.md) from docs/help and package metadata.
// Writes only the generated files; never touches specs or authored Help sources.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRepoInputs, pagesAreRenderable, renderAll } from './help-sync-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = loadRepoInputs(root);
const problems = [...inputs.loadErrors];
if (!problems.length && !pagesAreRenderable(inputs.manifest)) problems.push('docs/help/help-manifest.json: "pages" must be an array of { "id": string }');
for (const [key, text] of Object.entries(inputs.pageFiles)) {
  if (text === undefined) problems.push(`docs/help/${key}.md: missing`);
}
if (problems.length) {
  for (const p of problems) console.error(`generate:help: ${p}`);
  process.exit(1);
}

for (const [rel, content] of Object.entries(renderAll(inputs))) {
  const path = join(root, rel);
  if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`generate:help: wrote ${rel}`);
}
