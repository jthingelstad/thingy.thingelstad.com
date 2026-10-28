// Build-time /sitemap.xml. Each page's <lastmod> is the date its content
// last really changed: the newest commit that touched any file the page is
// made from (its HTML, the archive counts, and for the MCP reference the
// vendored surface and its renderer). Never the build time: Google ignores
// lastmod on a site where it is always "now". contracts/sites.json is left
// out on purpose: it feeds only the sites strip and footer chrome every
// page shares, and most of its syncs change nothing a page shows (Things 4
// Good joined the file, out of the strip, on 2026-10-25).
//
// The dates come from git history, so the build needs the full history. A
// shallow clone would date every page to its one commit, so the build fails
// there instead (CI checks out with fetch-depth: 0).

import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

const SITE_URL = 'https://thingy.thingelstad.com';
const ARCHIVE_STATS = 'content/archive-stats.json';

export interface SitemapPage {
  path: string;
  changefreq: string;
  priority: string;
  sources: string[];
}

export const SITEMAP_PAGES: SitemapPage[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0', sources: ['index.html', ARCHIVE_STATS] },
  { path: '/about/', changefreq: 'monthly', priority: '0.8', sources: ['about/index.html', ARCHIVE_STATS] },
  { path: '/connect/', changefreq: 'monthly', priority: '0.8', sources: ['connect/index.html', ARCHIVE_STATS] },
  {
    path: '/connect/reference/',
    changefreq: 'weekly',
    priority: '0.7',
    sources: ['connect/reference/index.html', 'contracts/mcp-surface.json', 'vite.mcp-reference.ts']
  }
];

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// The committer date (ISO 8601 with offset, a W3C datetime) of the newest
// commit that touched any of the files.
export function lastChanged(root: string, sources: string[]): string {
  if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('sitemap.xml: lastmod comes from git history, which a shallow clone lacks (fetch-depth: 0)');
  }
  const date = git(root, ['log', '-1', '--format=%cI', '--', ...sources]);
  if (!date) throw new Error(`sitemap.xml: no commit touches ${sources.join(', ')}`);
  return date;
}

export function renderSitemap(entries: Array<SitemapPage & { lastmod: string }>): string {
  const urls = entries.map((page) =>
    [
      '  <url>',
      `    <loc>${SITE_URL}${page.path}</loc>`,
      `    <lastmod>${page.lastmod}</lastmod>`,
      `    <changefreq>${page.changefreq}</changefreq>`,
      `    <priority>${page.priority}</priority>`,
      '  </url>'
    ].join('\n')
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n');
}

export function buildSitemap(root: string): string {
  return renderSitemap(SITEMAP_PAGES.map((page) => ({ ...page, lastmod: lastChanged(root, page.sources) })));
}

export function sitemapPlugin(root: string): Plugin {
  const build = () => buildSitemap(root);
  return {
    name: 'thingy-sitemap',
    configureServer(server) {
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(build());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: build() });
    }
  };
}
