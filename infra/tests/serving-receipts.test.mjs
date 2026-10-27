import assert from 'node:assert/strict';
import { test } from 'node:test';
import { putServingReceipts, servingReceipts } from '../scripts/serving-receipts.mjs';

const key = 'artifacts/corpus.json';
const time = '2026-10-28T02:41:01Z';
const state = (version, id) => ({ version: 1, ok: true, checked_at: time, corpus_versions: { [key]: version }, artifacts: { [key]: { version_id: version, id, at: '2026-10-31', private_canary: 'never-copy' } } });

test('only a changed known native corpus identity becomes an exact serving receipt', () => {
  const old = state('v1', 'wt-354'), next = state('v2', 'wt-355');
  const entries = servingReceipts(old, next, time);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].Source, 'thingy');
  assert.equal(entries[0].DetailType, 'received');
  assert.deepEqual(JSON.parse(entries[0].Detail), { system: 'thingy', kind: 'issue', id: '355', at: time, via: 'api-deploy' });
  assert.doesNotMatch(JSON.stringify(entries), /never-copy|private_canary|corpus_versions/);
  for (const before of [null, { ...old, ok: false }, { ...old, artifacts: {} }, next]) assert.deepEqual(servingReceipts(before, next, time), []);
  assert.deepEqual(servingReceipts(old, { ...next, corpus_versions: { [key]: 'unserved-version' } }, time), []);
  assert.deepEqual(servingReceipts(old, state('v3', 'wt-353'), time), []);
  assert.deepEqual(servingReceipts(old, { ...next, checked_at: '2026-02-30T00:00:00Z' }, time), []);
});

test('a blog URL must be supplied by the artifact, and equal publication times are not absence proof', () => {
  const k = 'artifacts/blog_corpus.json';
  const make = (version, id, at, url) => ({ version: 1, ok: true, checked_at: time, corpus_versions: { [k]: version }, artifacts: { [k]: { version_id: version, id, at, url } } });
  const old = make('v1', 'blog-1', '2026-10-27T02:00:00Z');
  const next = make('v2', 'blog-2', '2026-10-28T02:00:00Z', 'https://www.thingelstad.com/2026/10/28/post.html');
  assert.equal(JSON.parse(servingReceipts(old, next, time)[0].Detail).id, next.artifacts[k].url);
  assert.deepEqual(servingReceipts(old, make('v2', 'blog-2', '2026-10-28T02:00:00Z'), time), []);
  assert.deepEqual(servingReceipts(old, make('v2', 'blog-2', old.artifacts[k].at, next.artifacts[k].url), time), []);
  assert.deepEqual(servingReceipts(old, make('v2', 'blog-2', next.artifacts[k].at, 'https://fixture-secret@www.thingelstad.com/x'), time), []);
});

test('sender is off by default and entry failures never claim a successful arrival', async () => {
  const entries = servingReceipts(state('v1', 'wt-354'), state('v2', 'wt-355'), time), sent = [], warnings = [];
  const send = async (entry) => { sent.push(entry); return { FailedEntryCount: 0, Entries: [{ EventId: 'fixture-event' }] }; };
  assert.equal(await putServingReceipts(entries, '', { send }), 0);
  assert.equal(sent.length, 0);
  assert.equal(await putServingReceipts(entries, 'fixture-bus', { send }), 1);
  assert.equal(sent[0].EventBusName, 'fixture-bus');
  assert.equal(await putServingReceipts(entries, 'fixture-bus', { send: async () => ({ FailedEntryCount: 1, Entries: [{ ErrorCode: 'private-error' }] }), warn: (w) => warnings.push(w) }), 0);
  assert.doesNotMatch(warnings.join(''), /private-error/);
});
