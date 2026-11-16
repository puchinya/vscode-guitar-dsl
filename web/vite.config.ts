import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [
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
