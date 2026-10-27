// Thingy serves the native Librarian backend. A static web deploy is never
// evidence of a corpus arrival. Compare verified backend metadata only.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ARTIFACTS = { 'artifacts/corpus.json': 'issue', 'artifacts/blog_corpus.json': 'post', 'artifacts/podcast_corpus.json': 'episode', 'artifacts/links_corpus.json': 'link' };
const instant = (value) => {
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!days || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().replace(/\.000Z$/, 'Z');
};
const holding = (snapshot, key) => {
  const item = snapshot?.artifacts?.[key];
  return snapshot?.version === 1 && snapshot.ok === true && item?.version_id && snapshot.corpus_versions?.[key] === item.version_id ? item : null;
};

export function servingReceipts(before, after, now, canonicalLink = null) {
  const at = instant(after?.checked_at);
  const priorAt = instant(before?.checked_at);
  if (!at || !priorAt || Date.parse(priorAt) > Date.parse(at) || !Number.isFinite(Date.parse(now)) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(after.checked_at) || at !== after.checked_at || Date.parse(at) > Date.parse(now)) return [];
  const entries = [];
  for (const [key, kind] of Object.entries(ARTIFACTS)) {
    const old = holding(before, key), next = holding(after, key);
    if (!old?.id || !next?.id || old.version_id === next.version_id || old.id === next.id) continue;
    let id, url;
    if (kind === 'issue' || kind === 'episode') {
      const prefix = kind === 'issue' ? 'wt-' : 'ep-';
      const a = String(old.id).match(new RegExp(`^${prefix}(\\d+)$`))?.[1], b = String(next.id).match(new RegExp(`^${prefix}(\\d+)$`))?.[1];
      if (!a || !b || BigInt(b) <= BigInt(a)) continue;
      id = b;
    } else {
      if (!instant(old.at) || !instant(next.at) || Date.parse(next.at) <= Date.parse(old.at)) continue;
      if (kind === 'post') {
        try {
          const u = new URL(next.url);
          if (u.origin !== 'https://www.thingelstad.com' || u.username || u.password || u.search || u.hash) continue;
          id = url = next.url;
        } catch { continue; }
      } else {
        if (canonicalLink?.kind !== 'link' || canonicalLink.origin !== 'pinboard' || canonicalLink.item?.id !== instant(next.at)) continue;
        id = canonicalLink.item.id;
      }
    }
    const detail = { system: 'thingy', kind, id, at, via: 'api-deploy', ...(url ? { url } : {}) };
    entries.push({ Source: 'thingy', DetailType: 'received', Detail: JSON.stringify(detail), Time: new Date(at) });
  }
  return entries;
}

export async function putServingReceipts(entries, bus, { send, warn = console.warn } = {}) {
  if (!bus || !entries.length) return 0;
  if (!send) {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const client = new EventBridgeClient({ region: 'us-east-1', maxAttempts: 2 });
    send = (entry) => client.send(new PutEventsCommand({ Entries: [entry] }), { abortSignal: AbortSignal.timeout(5000) });
  }
  let reported = 0;
  for (const entry of entries) {
    try {
      const result = await send({ ...entry, EventBusName: bus });
      if (result?.FailedEntryCount !== 0 || result.Entries?.length !== 1 || !result.Entries[0].EventId || result.Entries[0].ErrorCode) throw new Error('Not acknowledged');
      reported++;
    } catch { warn('::warning::A serving receipt was not acknowledged; the backend remains deployed.'); }
  }
  return reported;
}

async function main() {
  const before = JSON.parse(await fs.readFile(process.env.SYNC_BEFORE_FILE ?? 'evidence/sync-before.json', 'utf8'));
  const after = JSON.parse(await fs.readFile(process.env.SYNC_AFTER_FILE ?? 'evidence/sync-after.json', 'utf8'));
  let link = null;
  try {
    const response = await fetch('https://sync.thingelstad.xyz/receipts/link.json', { signal: AbortSignal.timeout(5000) });
    if (response.ok) link = await response.json();
  } catch { /* An unknown canonical stamp cannot produce a link receipt. */ }
  const entries = servingReceipts(before, after, new Date().toISOString(), link);
  const dry = process.env.SYNC_RECEIVED_DRY_RUN !== 'false' || !process.env.SYNC_RECEIVED_BUS;
  const reported = dry ? 0 : await putServingReceipts(entries, process.env.SYNC_RECEIVED_BUS);
  console.log(JSON.stringify({ dry_run: dry, eligible: entries.length, reported }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.warn('::warning::Serving metadata could not be verified; no arrival is claimed.'); });
