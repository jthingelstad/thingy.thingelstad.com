import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const SITE = {
  title: 'Thingy',
  description: "Ask Thingy to find and synthesize writing from across Jamie Thingelstad's archive.",
  url: 'https://thingy.thingelstad.com',
  tinylyticsId: env('TINYLYTICS_SITE_UID', 'u5bRAyyJvMXUrz6zbTz5'),
  networkLinks: [
    {
      label: 'thingelstad.com',
      href: 'https://www.thingelstad.com/',
      key: 'thingelstad',
      aliases: ['thingelstad.com', 'www.thingelstad.com', 'blog', 'jamie']
    },
    {
      label: 'Weekly Thing',
      href: 'https://weekly.thingelstad.com/',
      key: 'weekly-thing',
      aliases: ['weekly thing', 'weekly.thingelstad.com', 'newsletter']
    },
    {
      label: 'Another Thing',
      href: 'https://another.thingelstad.com/',
      key: 'another-thing',
      aliases: ['another thing', 'another.thingelstad.com', 'podcast']
    }
  ]
};

function env(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required to build Thingy.`);
  return value;
}

function htmlConfigPlugin() {
  const librarianApiUrl = requiredEnv('LIBRARIAN_API_URL');
  const librarianStreamUrl = requiredEnv('LIBRARIAN_STREAM_URL');
  const tinylyticsId = SITE.tinylyticsId;
  return {
    name: 'thingy-html-config',
    transformIndexHtml(html) {
      const config = {
        librarianApiUrl,
        librarianStreamUrl,
        tinylyticsId,
        networkLinks: SITE.networkLinks
      };
      return html
        .replaceAll('__THINGY_TINYLYTICS_ID__', tinylyticsId)
        .replace('__THINGY_CHAT_CONFIG__', JSON.stringify(config))
        .replace('__THINGY_DISPATCH_CONFIG__', JSON.stringify({ librarianApiUrl }))
        .replace('__THINGY_SIGNIN_CONFIG__', JSON.stringify({ librarianApiUrl }));
    }
  };
}

export default defineConfig({
  publicDir: 'public',
  define: {
    __THINGY_TINYLYTICS_ID__: JSON.stringify(SITE.tinylyticsId)
  },
  plugins: [htmlConfigPlugin()],
  build: {
    outDir: '_site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        chat: resolve(__dirname, 'chat/index.html'),
        dispatch: resolve(__dirname, 'dispatch/index.html'),
        signin: resolve(__dirname, 'signin/index.html')
      }
    }
  }
});
