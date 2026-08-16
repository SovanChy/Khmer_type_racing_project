import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // sqlite-wasm finds its .wasm with `new URL('sqlite3.wasm', import.meta.url)`.
  // Pre-bundling rewrites that URL and the fetch 404s — typically only in the
  // production build, while dev appears fine.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },

  // The database worker is `type: 'module'`, so its bundle must be ESM too.
  worker: { format: 'es' },
});
