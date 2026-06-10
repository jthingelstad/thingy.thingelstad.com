import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

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

function buildId() {
  // Shown in the account menu so a reader (or Jamie) can tell which build
  // they're running. Prefer the checkout's git hash; in CI GITHUB_SHA is
  // also present but `git` works there too. Falls back to 'dev'.
  let hash = env('GITHUB_SHA').slice(0, 7);
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || hash;
  } catch (error) { /* not a git checkout */ }
  const date = new Date().toISOString().slice(0, 10);
  return hash ? `${hash} · ${date}` : 'dev';
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
        networkLinks: SITE.networkLinks,
        buildId: buildId()
      };
      return html
        .replaceAll('__THINGY_TINYLYTICS_ID__', tinylyticsId)
        .replace('__THINGY_CHAT_CONFIG__', JSON.stringify(config))
        .replace('__THINGY_DISPATCH_CONFIG__', JSON.stringify({ librarianApiUrl }))
        .replace('__THINGY_SIGNIN_CONFIG__', JSON.stringify({ librarianApiUrl }))
        .replace('__THINGY_DISCORD_CONFIG__', JSON.stringify({ librarianApiUrl }));
    }
  };
}

export default defineConfig({
  publicDir: 'public',
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
        dispatch: resolve(__dirname, 'dispatch/index.html'),
        discord: resolve(__dirname, 'discord/index.html'),
        signin: resolve(__dirname, 'signin/index.html')
      }
    }
  }
});
