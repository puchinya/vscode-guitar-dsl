// Generate the packaged AI Skill reference (npm run generate:ai): a byte-for-byte copy of the canonical
// GuitarDSL syntax spec. Writes only the generated reference; never touches specs or authored AI assets.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SYNTAX_SPEC, SKILL_REFERENCE } from './check-ai-sync.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, CANONICAL_SYNTAX_SPEC);
const target = join(root, SKILL_REFERENCE);

if (!existsSync(source)) {
  console.error(`generate:ai: ${CANONICAL_SYNTAX_SPEC}: missing`);
  process.exit(1);
}
const content = readFileSync(source);
if (!existsSync(target) || !readFileSync(target).equals(content)) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`generate:ai: wrote ${SKILL_REFERENCE}`);
}
