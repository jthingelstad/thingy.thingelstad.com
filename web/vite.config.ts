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
        // /chat-classic/ was the rollback route during the assistant-ui
        // migration; now a redirect stub to /chat/ (like /dispatch/).
        chatClassic: resolve(__dirname, 'chat-classic/index.html'),
        // The Dispatch surface was removed in 2026-08; /dispatch/ is a static
        // redirect stub (no JS entry) kept so old links land on /chat/.
        dispatch: resolve(__dirname, 'dispatch/index.html'),
        // /chat2/ was the assistant-ui preview route during the 2026-09-02
        // migration; stub keeps those links landing on /chat/.
        chat2: resolve(__dirname, 'chat2/index.html'),
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
