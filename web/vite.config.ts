import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      {
        find: /^@guitardsl\/(core|ui|document|pdf)\/(.+)$/,
        replacement: `${packagesRoot}$1/src/$2.ts`
      },
      {
        find: /^@guitardsl\/(core|ui|document|pdf)$/,
        replacement: `${packagesRoot}$1/src/index.ts`
      }
    ]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1'
  }
});
