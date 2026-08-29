import assert from 'node:assert/strict';
import test from 'node:test';
import { postJsonRequest as postJson } from '../src/shared/thingy-http.ts';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}

test('postJson validates and returns a successful response', async () => {
  global.window = { clearTimeout, setTimeout, fetch: async () => jsonResponse({ ok: true }) };
  const data = await postJson({ baseUrl: 'https://api.example', path: '/feedback' });
  assert.equal(data.ok, true);
});

test('postJson throws with status, requestId, and body on HTTP errors', async () => {
  global.window = {
    clearTimeout,
    setTimeout,
    fetch: async () =>
      jsonResponse({ error: 'Not a subscriber.', code: 'subscriber_required', request_id: 'req-3' }, { status: 403 })
  };
  await assert.rejects(postJson({ baseUrl: 'https://api.example', path: '/auth' }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.data?.code, 'subscriber_required');
    assert.match(error.message, /Not a subscriber/);
    return true;
  });
});

test('postJson prefers the header request id unless told otherwise', async () => {
  const body = { error: 'Nope.', request_id: 'body-id' };
  global.window = {
    clearTimeout,
    setTimeout,
    fetch: async () => jsonResponse(body, { status: 500, headers: { 'x-request-id': 'header-id' } })
  };
  await assert.rejects(postJson({ baseUrl: 'https://api.example', path: '/auth' }), (error) => {
    assert.equal(error.requestId, 'header-id');
    return true;
  });
  global.window.fetch = async () => jsonResponse(body, { status: 500, headers: { 'x-request-id': 'header-id' } });
  await assert.rejects(
    postJson({ baseUrl: 'https://api.example', path: '/auth', requestIdSource: 'data' }),
    (error) => {
      assert.equal(error.requestId, 'body-id');
      return true;
    }
  );
});

test('postJson times out and reports the friendly abort message', async () => {
  global.window = {
    clearTimeout,
    setTimeout,
    fetch: (_url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      })
  };
  await assert.rejects(
    postJson({ baseUrl: 'https://api.example', path: '/auth', timeoutMs: 20, abortMessage: 'Too slow, sorry.' }),
    /Too slow, sorry/
  );
});

test('postJson requires a configured base URL', async () => {
  await assert.rejects(postJson({ baseUrl: '', missingMessage: 'Not connected yet.' }), /Not connected yet/);
});
