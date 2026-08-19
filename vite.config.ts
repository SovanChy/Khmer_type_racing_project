import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
 import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Default glob (js,css,html,ico,png,svg) misses the sqlite-wasm binary,
        // its worker/proxy scripts, the self-hosted Khmer font, and the corpus
        // JSON — all required for the app to work offline.
        globPatterns: ['**/*.{js,css,html,json,wasm,woff2,svg}'],
      },
      manifest: {
        name: 'Khmer NiDA Typing Trainer',
        short_name: 'NiDA Trainer',
        start_url: '/',
        display: 'standalone',
        lang: 'km',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],

  // sqlite-wasm finds its .wasm with `new URL('sqlite3.wasm', import.meta.url)`.
  // Pre-bundling rewrites that URL and the fetch 404s — typically only in the
  // production build, while dev appears fine.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },

  // The database worker is `type: 'module'`, so its bundle must be ESM too.
  worker: { format: 'es' },
});
