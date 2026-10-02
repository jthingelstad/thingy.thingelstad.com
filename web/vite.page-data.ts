// Build-time data for the static pages (/, /about/, /connect/):
//
// - The sites strip. contracts/sites.json is a vendored copy of the
//   thingelstad.com shared/sites.json (scripts/sync-sites.mjs); the plugin
//   replaces a <!--sites-strip--> marker with the strip, so the pages carry
//   real links with no client JavaScript.
// - The archive counts. content/archive-stats.json is the one source for
//   every number the static pages quote; templates write {{archive.<path>}}
//   and an unknown or leftover token fails the build instead of shipping.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { escapeHtml } from './vite.mcp-reference.ts';

export const SITES_STRIP_MARKER = '<!--sites-strip-->';
const THINGY_SITE_ID = 'thingy';
const TOKEN = /\{\{archive\.([a-z_.]+)\}\}/g;

export interface Site {
  id: string;
  name: string;
  short_name: string;
  url: string;
  description: string;
  in_publishing_system: boolean;
}

export type ArchiveStats = Record<string, unknown>;

export function loadSites(root: string): Site[] {
  const data = JSON.parse(readFileSync(resolve(root, 'contracts/sites.json'), 'utf8')) as { sites: Site[] };
  return data.sites;
}

export function stripSites(sites: Site[]): Site[] {
  return sites.filter((site) => site.in_publishing_system);
}

export function renderSitesStrip(sites: Site[], currentId = THINGY_SITE_ID): string {
  const items = stripSites(sites).map((site) => {
    const current = site.id === currentId ? ' aria-current="true"' : '';
    return (
      `<li><a href="${escapeHtml(site.url)}"${current} title="${escapeHtml(site.description)}">` +
      `${escapeHtml(site.short_name)}</a></li>`
    );
  });
  return `<nav class="thingy-sites-strip" aria-label="Jamie's sites"><ul>${items.join('')}</ul></nav>`;
}

export function loadArchiveStats(root: string): ArchiveStats {
  return JSON.parse(readFileSync(resolve(root, 'content/archive-stats.json'), 'utf8')) as ArchiveStats;
}

function lookup(stats: ArchiveStats, path: string): unknown {
  let value: unknown = stats;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// Counts print with en-US grouping (10,444); years print bare (2017).
export function formatStat(path: string, value: unknown): string {
  if (typeof value === 'number') {
    const isYear = path === 'as_of' || path.endsWith('since');
    return isYear ? String(value) : value.toLocaleString('en-US');
  }
  if (typeof value === 'string') return escapeHtml(value);
  throw new Error(`archive-stats.json has no value at ${path}`);
}

export function renderArchiveStats(html: string, stats: ArchiveStats): string {
  return html.replace(TOKEN, (_match, path: string) => formatStat(path, lookup(stats, path)));
}

export function pageDataPlugin(root: string): Plugin {
  return {
    name: 'thingy-page-data',
    transformIndexHtml(html: string) {
      let out = html;
      if (out.includes(SITES_STRIP_MARKER)) out = out.replace(SITES_STRIP_MARKER, renderSitesStrip(loadSites(root)));
      if (out.includes('{{archive.')) out = renderArchiveStats(out, loadArchiveStats(root));
      if (out.includes('{{archive')) throw new Error('An {{archive...}} token was left unrendered.');
      return out;
    }
  };
}
