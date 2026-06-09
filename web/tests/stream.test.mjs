import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlock, postJsonStream } from '../src/shared/thingy-stream.js';

test('parseBlock parses standard server-sent events', () => {
  assert.deepEqual(parseBlock('event: answer\ndata: {"answer":"hello"}'), {
    eventName: 'answer',
    data: { answer: 'hello' }
  });
});

test('postJsonStream surfaces JSON Lambda error bodies instead of treating them as empty streams', async () => {
  global.window = { clearTimeout, setTimeout };
  global.fetch = async () => new Response(JSON.stringify({
    errorType: 'Runtime.UserCodeSyntaxError',
    errorMessage: 'SyntaxError: missing export'
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  await assert.rejects(
    postJsonStream({ baseUrl: 'https://stream.example', path: '/chat' }),
    /missing export/
  );
});
