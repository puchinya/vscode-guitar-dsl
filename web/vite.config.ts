import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url));
const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const webPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: '/',
  define: { __WEB_VERSION__: JSON.stringify(webPackage.version) },
  plugins: [
    {
      name: 'guitardsl-static-legal-pages-dev',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();
          const pathname = request.url?.split(/[?#]/u, 1)[0] ?? '/';
          const match = /^\/(licenses|privacy|terms)(?:\/(ja|en))?\/?$/u.exec(pathname);
          if (!match) return next();
          const filePath = `${publicRoot}${match[1]}/${match[2] ? `${match[2]}/` : ''}index.html`;
          try {
            const html = readFileSync(filePath);
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.setHeader('Content-Length', String(html.byteLength));
            if (request.method === 'HEAD') response.end();
            else response.end(html);
          } catch { next(); }
        });
      }
    },
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'pwa-512x512-maskable.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'GuitarDSL',
        short_name: 'GuitarDSL',
        description: 'Write GuitarDSL scores, preview them, and export PDFs.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f8fa',
        theme_color: '#f7f8fa',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,ttf,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/$/],
        runtimeCaching: [],
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true
      }
    })
  ],
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
