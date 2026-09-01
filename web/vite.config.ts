import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
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

function env(name: string, fallback = '') {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function requiredEnv(name: string) {
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
    hash =
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || hash;
  } catch (error) {
    /* not a git checkout */
  }
  const date = new Date().toISOString().slice(0, 10);
  return hash ? `${hash} · ${date}` : 'dev';
}

function htmlConfigPlugin(): Plugin {
  const librarianApiUrl = requiredEnv('LIBRARIAN_API_URL');
  const librarianStreamUrl = requiredEnv('LIBRARIAN_STREAM_URL');
  const tinylyticsId = SITE.tinylyticsId;
  return {
    name: 'thingy-html-config',
    transformIndexHtml(html: string) {
      const config = {
        librarianApiUrl,
        librarianStreamUrl,
        tinylyticsId,
        networkLinks: SITE.networkLinks,
        buildId: buildId()
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      // Production uses same-origin '/api' paths, which need no connect-src
      // entry beyond 'self'; absolute URLs (local dev against the live
      // backend) still get their origins allow-listed.
      const connectSrc = Array.from(
        new Set(
          [librarianApiUrl, librarianStreamUrl]
            .filter((value) => value.startsWith('http'))
            .map((value) => new URL(value).origin)
        )
      ).join(' ');
      return html
        .replaceAll('__THINGY_TINYLYTICS_ID__', tinylyticsId)
        .replaceAll('__THINGY_CONNECT_SRC__', connectSrc)
        .replace('__THINGY_CHAT_CONFIG__', encode(config))
        .replace('__THINGY_SIGNIN_CONFIG__', encode({ librarianApiUrl }));
    }
  };
}

// Local dev against the live Librarian with same-origin '/api' URLs: the dev
// and preview servers proxy /api to the API, stripping the prefix the way
// CloudFront does in production. Cookie sign-in works because the proxy makes
// everything same-origin on localhost (a trustworthy context, so the Secure
// cookie is accepted). Cookie-authenticated calls additionally need the
// X-Thingy-Origin marker: export THINGY_WEB_ORIGIN_TOKEN (librarian .env) and
// the proxy stamps it; without it, sign-in still works but cookie calls 401.
const librarianProxy = {
  // /tools lives only on the stream Lambda; the librarian custom domain does
  // not route it (in production the thingy distribution does, as /api/tools).
  '/api/tools': {
    target: env('THINGY_DEV_STREAM_ORIGIN', 'https://jcvud66qqpq53frvno5stoqntm0zqntw.lambda-url.us-east-1.on.aws'),
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
    headers: env('THINGY_WEB_ORIGIN_TOKEN') ? { 'X-Thingy-Origin': env('THINGY_WEB_ORIGIN_TOKEN') } : undefined
  },
  '/api': {
    target: env('THINGY_DEV_API_ORIGIN', 'https://librarian.thingelstad.com'),
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
    headers: env('THINGY_WEB_ORIGIN_TOKEN') ? { 'X-Thingy-Origin': env('THINGY_WEB_ORIGIN_TOKEN') } : undefined
  }
};

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
        connect: resolve(__dirname, 'connect/index.html'),
        about: resolve(__dirname, 'about/index.html')
      }
    }
  }
});
