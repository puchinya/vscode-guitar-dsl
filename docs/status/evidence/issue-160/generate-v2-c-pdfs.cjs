const fs = require('node:fs/promises');
const path = require('node:path');

const evidenceDirectory = __dirname;
const repositoryRoot = path.resolve(evidenceDirectory, '../../../..');
const sampleDirectory = path.join(evidenceDirectory, 'v2-c-samples');
const outputDirectory = path.join(evidenceDirectory, 'v2-c-pdf');
const { parseGuitarDsl } = require(path.join(repositoryRoot, 'out/compiler'));
const { getBundledFontFiles, renderScorePdf } = require(path.join(repositoryRoot, 'out/pdf'));

const cases = [
  { sample: 'vocal-rhythm.guitardsl', name: 'vocal-rhythm-a4', pageSize: 'A4' },
  { sample: 'guitar-brace.guitardsl', name: 'guitar-brace-a4', pageSize: 'A4' },
  { sample: 'nested.guitardsl', name: 'nested-a4', pageSize: 'A4' },
  { sample: 'nested.guitardsl', name: 'nested-a5', pageSize: 'A5' }
];

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const fonts = getBundledFontFiles(repositoryRoot);
  for (const item of cases) {
    const source = await fs.readFile(path.join(sampleDirectory, item.sample), 'utf8');
    const score = parseGuitarDsl(source);
    const errors = score.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (errors.length > 0) throw new Error(`${item.sample} has parser errors: ${errors.map(error => error.message).join('; ')}`);
    const pdf = await renderScorePdf(source, item.pageSize, 'portrait', fonts);
    await fs.writeFile(path.join(outputDirectory, `${item.name}.pdf`), pdf);
  }
  console.log(`Generated ${cases.length} PDFs from ${sampleDirectory} into ${outputDirectory}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
