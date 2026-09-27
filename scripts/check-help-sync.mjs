// Read-only Help synchronization gate (npm run check:help).
// Fails when spec sections, reviewed digests, command/setting parity, NLS or the
// generated media/help files are out of sync. It never repairs anything.
//   --print-digests  print the current digest of every spec section (for an intentional review refresh)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections, loadRepoInputs, runAllChecks, sectionDigest } from './help-sync-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = loadRepoInputs(root);

if (process.argv.includes('--print-digests')) {
  for (const [id, text] of Object.entries(inputs.specTexts)) {
    if (text === undefined) continue;
    for (const section of extractSections(text).sections.values()) {
      console.log(`${id}\t${section.id}\t${sectionDigest(section)}\t${section.title}`);
    }
  }
  process.exit(0);
}

const errors = runAllChecks(inputs);
if (errors.length) {
  console.error(`check:help: ${errors.length} problem(s) found (see docs/help/README.md):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('check:help: Help is in sync with docs/specs and package.json');
