import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode', 'pdfkit', 'svg-to-pdfkit'],
  outfile: 'out/extension.js',
  sourcemap: false,
  logLevel: 'info'
});
