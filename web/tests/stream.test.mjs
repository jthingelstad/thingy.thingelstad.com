import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlock, postJsonStream } from '../src/shared/thingy-stream.ts';

test('parseBlock parses standard server-sent events', () => {
  assert.deepEqual(parseBlock('event: answer\ndata: {"answer":"hello"}'), {
    eventName: 'answer',
    data: { answer: 'hello' }
  });
});

test('postJsonStream surfaces JSON Lambda error bodies instead of treating them as empty streams', async () => {
  global.window = { clearTimeout, setTimeout };
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        errorType: 'Runtime.UserCodeSyntaxError',
        errorMessage: 'SyntaxError: missing export'
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    );

  await assert.rejects(postJsonStream({ baseUrl: 'https://stream.example', path: '/chat' }), /missing export/);
});

test('postJsonStream attaches status, requestId, and error body on HTTP failures', async () => {
  global.window = { clearTimeout, setTimeout };
  global.fetch = async () =>
    new Response(JSON.stringify({ error: 'Session expired.', code: 'session_expired' }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-9' }
    });

  await assert.rejects(postJsonStream({ baseUrl: 'https://stream.example', path: '/chat' }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.requestId, 'req-9');
    // isAuthError reads error.data.code; dropping the body made stream auth
    // failures unrecoverable.
    assert.equal(error.data?.code, 'session_expired');
    return true;
  });
});

test('postJsonStream times out a request that never returns headers', async () => {
  global.window = { clearTimeout, setTimeout };
  global.fetch = (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    });

  await assert.rejects(
    postJsonStream({ baseUrl: 'https://stream.example', path: '/chat', timeoutMs: 20 }),
    /took too long/
  );
});

test('read surfaces the idle-timeout error when a stream goes silent mid-answer', async () => {
  global.window = { clearTimeout, setTimeout };
  const { read } = await import('../src/shared/thingy-stream.ts');
  const encoder = new TextEncoder();
  let pulls = 0;
  const silentBody = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(encoder.encode('event: meta\ndata: {"contract_version":"4.0.0"}\n\n'));
        return undefined;
      }
      // Never resolves again - simulates a black-holed connection.
      return new Promise(() => {});
    }
  });
  const events = [];
  const originalIdle = 75000;
  // Patch the idle deadline down for the test via a short monkey-patched timer:
  // read() uses STREAM_IDLE_TIMEOUT_MS internally, so instead drive the test
  // with real (but tiny) waits by intercepting setTimeout delays.
  global.window = {
    clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms === originalIdle ? 30 : ms)
  };
  await assert.rejects(
    read(new Response(silentBody), (eventName, data) => events.push([eventName, data])),
    /stopped responding mid-answer/
  );
  assert.deepEqual(events, [['meta', { contract_version: '4.0.0' }]]);
});
