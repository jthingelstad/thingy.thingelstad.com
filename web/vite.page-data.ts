// Build-time data for the static pages (/, /about/, /connect/,
// /connect/reference/):
//
// - The sites strip. contracts/sites.json is a vendored copy of the
//   thingelstad.com shared/sites.json (scripts/sync-sites.mjs); the plugin
//   replaces a <!--sites-strip--> marker with the strip, so the pages carry
//   real links with no client JavaScript. The markup is the shared contract
//   in the thingelstad.com AGENTS.md ("The sites strip"): every site renders
//   it identically, so change it there first.
// - Jamie. The same file's owner block renders the footer h-card
//   (<!--owner-hcard-->) and the head's rel=me links (<!--rel-me-->), the
//   shared markup in the thingelstad.com AGENTS.md ("Jamie on every site").
//   Identity links point at the clean URL and never carry a ref.
// - Site facts. {{site.<id>.<field>}} prints a sites.json value (the family
//   tiles on the home page take their links and names from it).
// - The archive counts. content/archive-stats.json is the one source for
//   every number the static pages quote; templates write {{archive.<path>}}
//   and an unknown or leftover token fails the build instead of shipping.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { escapeHtml } from './vite.mcp-reference.ts';

export const SITES_STRIP_MARKER = '<!--sites-strip-->';
export const OWNER_HCARD_MARKER = '<!--owner-hcard-->';
export const REL_ME_MARKER = '<!--rel-me-->';
const THINGY_SITE_ID = 'thingy';
const TOKEN = /\{\{archive\.([a-z_.]+)\}\}/g;
const SITE_TOKEN = /\{\{site\.([a-z0-9-]+)\.([a-z_]+)\}\}/g;

export interface Site {
  id: string;
  name: string;
  short_name: string;
  strip_label: string;
  url: string;
  description: string;
  in_sites_strip: boolean;
}

export interface Owner {
  name: string;
  url: string;
  avatar: string;
  note: string;
  rel_me: string[];
}

export type ArchiveStats = Record<string, unknown>;

function loadSitesFile(root: string) {
  return JSON.parse(readFileSync(resolve(root, 'contracts/sites.json'), 'utf8')) as { owner: Owner; sites: Site[] };
}

export function loadSites(root: string): Site[] {
  return loadSitesFile(root).sites;
}

export function loadOwner(root: string): Owner {
  return loadSitesFile(root).owner;
}

export function stripSites(sites: Site[]): Site[] {
  return sites.filter((site) => site.in_sites_strip);
}

// Every site shows its strip_label, Thingy included; the current site
// differs only in its class and aria-current. Every link carries
// ?ref=sites-strip-<current site> so Tinylytics' Sources report on the
// destination shows which site's strip sent the visit.
export function renderSitesStrip(sites: Site[], currentId = THINGY_SITE_ID): string {
  const items = stripSites(sites).map((site) => {
    const current = site.id === currentId;
    const href = `${site.url}${site.url.includes('?') ? '&' : '?'}ref=sites-strip-${encodeURIComponent(currentId)}`;
    const itemClass = `sites-strip__item sites-strip__item--${escapeHtml(site.id)}${current ? ' sites-strip__item--current' : ''}`;
    return (
      `<li class="${itemClass}">` +
      `<a href="${escapeHtml(href)}" title="${escapeHtml(site.description)}"${current ? ' aria-current="true"' : ''}>` +
      `${escapeHtml(site.strip_label)}</a></li>`
    );
  });
  return (
    `<nav class="sites-strip" aria-label="Jamie's sites"><div class="sites-strip__inner">` +
    `<span class="sites-strip__label">Jamie's sites</span>` +
    `<ul class="sites-strip__list">${items.join('')}</ul></div></nav>`
  );
}

// The shared h-card: owner.avatar (the bird-on-the-hat photo, micro.blog's
// 200px copy) as a 28px round photo beside the name.
export function renderOwnerHcard(owner: Owner): string {
  return (
    `<a class="h-card" href="${escapeHtml(owner.url)}" rel="me author">` +
    `<img class="u-photo" src="${escapeHtml(owner.avatar)}" alt="" width="28" height="28">` +
    `<span class="p-name">${escapeHtml(owner.name)}</span>` +
    `<data class="p-note" value="${escapeHtml(owner.note)}"></data></a>`
  );
}

export function renderRelMe(owner: Owner): string {
  return owner.rel_me.map((url) => `<link rel="me" href="${escapeHtml(url)}">`).join('');
}

export function renderSiteTokens(html: string, sites: Site[]): string {
  return html.replace(SITE_TOKEN, (_match, id: string, field: string) => {
    const site = sites.find((entry) => entry.id === id) as Record<string, unknown> | undefined;
    const value = site?.[field];
    if (typeof value !== 'string') throw new Error(`sites.json has no ${field} for site ${id}`);
    return escapeHtml(value);
  });
}

// years is derived, not typed: the years from the blog's first year
// (blog.since, 2004) to the year of the counts (as_of).
export function loadArchiveStats(root: string): ArchiveStats {
  const stats = JSON.parse(readFileSync(resolve(root, 'content/archive-stats.json'), 'utf8')) as ArchiveStats;
  const since = (stats.blog as { since?: unknown } | undefined)?.since;
  const asOfYear = Number(String(stats.as_of || '').slice(0, 4));
  if (typeof since === 'number' && Number.isInteger(asOfYear) && asOfYear > since) stats.years = asOfYear - since;
  return stats;
}

function lookup(stats: ArchiveStats, path: string): unknown {
  let value: unknown = stats;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// Counts print with en-US grouping (10,444); years and issue numbers print
// bare (2017, WT353).
export function formatStat(path: string, value: unknown): string {
  if (typeof value === 'number') {
    const isBare = path === 'as_of' || path.endsWith('since') || path.endsWith('latest');
    return isBare ? String(value) : value.toLocaleString('en-US');
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
      if (out.includes(OWNER_HCARD_MARKER)) out = out.replace(OWNER_HCARD_MARKER, renderOwnerHcard(loadOwner(root)));
      if (out.includes(REL_ME_MARKER)) out = out.replace(REL_ME_MARKER, renderRelMe(loadOwner(root)));
      if (out.includes('{{site.')) out = renderSiteTokens(out, loadSites(root));
      if (out.includes('{{archive.')) out = renderArchiveStats(out, loadArchiveStats(root));
      if (out.includes('{{archive') || out.includes('{{site'))
        throw new Error('A {{...}} page-data token was left unrendered.');
      return out;
    }
  };
}
