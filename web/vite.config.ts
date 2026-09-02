import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { SITE, htmlConfigPlugin, librarianProxy } from './vite.shared-config.ts';

export default defineConfig({
  publicDir: 'public',
  server: { proxy: librarianProxy },
  preview: { proxy: librarianProxy },
  define: {
    __THINGY_TINYLYTICS_ID__: JSON.stringify(SITE.tinylyticsId)
  },
  plugins: [preact(), htmlConfigPlugin()],
  build: {
    outDir: '_site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        chat: resolve(__dirname, 'chat/index.html'),
        // The Dispatch surface was removed in 2026-08; /dispatch/ is a static
        // redirect stub (no JS entry) kept so old links land on /chat/.
        dispatch: resolve(__dirname, 'dispatch/index.html'),
        signin: resolve(__dirname, 'signin/index.html'),
        // Public shared-conversation page; every /c/<token> URL serves this
        // one shell (CloudFront function rewrite) and the page reads the
        // token from the path.
        share: resolve(__dirname, 'c/index.html'),
        connect: resolve(__dirname, 'connect/index.html'),
        about: resolve(__dirname, 'about/index.html')
      }
    }
  }
});
