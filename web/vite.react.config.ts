// Second build pass: the React chat surface (assistant-ui) at /chat2/,
// emitted into the same _site as the main build (emptyOutDir off, its own
// assets dir so hashes can never collide). Run AFTER `vite build`.
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { SITE, htmlConfigPlugin, librarianProxy } from './vite.shared-config.ts';

export default defineConfig({
  publicDir: false,
  server: { proxy: librarianProxy, port: 8081 },
  preview: { proxy: librarianProxy, port: 8081 },
  define: {
    __THINGY_TINYLYTICS_ID__: JSON.stringify(SITE.tinylyticsId)
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  plugins: [react(), htmlConfigPlugin()],
  build: {
    outDir: '_site',
    emptyOutDir: false,
    assetsDir: 'r-assets',
    rollupOptions: {
      input: {
        chat2: resolve(__dirname, 'chat2/index.html')
      }
    }
  }
});
