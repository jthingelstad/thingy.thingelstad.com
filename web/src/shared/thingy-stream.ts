// @ts-check
import { DEFAULT_API_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS } from './thingy-timeouts.ts';
import {
  assertContractResponseVersion,
  contractRequestHeaders,
  looseApiError,
  validateStreamData
} from './thingy-contracts.ts';

function parseBlock(block: unknown): { eventName: string; data: ThingyStreamData } | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  String(block || '')
    .split('\n')
    .forEach((line) => {
      const clean = line.replace(/\r$/, '');
      if (!clean || clean.startsWith(':')) return;
      if (clean.startsWith('event:')) eventName = clean.slice(6).trim();
      if (clean.startsWith('data:')) dataLines.push(clean.slice(5).trimStart());
    });
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  try {
    return { eventName, data: validateStreamData(eventName, JSON.parse(raw)) };
  } catch (error) {
    const streamError = new Error('Something got garbled on the way from the archive. Ask again - it usually clears.');
    streamError.cause = error;
    streamError.raw = raw;
    throw streamError;
  }
}

async function read(response: Response, onEvent: (eventName: string, data: ThingyStreamData) => void | Promise<void>) {
  if (!response || !response.body) throw new Error('The archive line went quiet. Ask again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function consume(rawBlock: string) {
    const parsed = parseBlock(rawBlock);
    if (!parsed) return;
    await onEvent(parsed.eventName, parsed.data);
  }

  // The request timeout only covers time-to-first-byte: it is cleared when
  // headers arrive. Without a per-chunk deadline, a stream that goes silent
  // mid-answer hangs reader.read() forever and locks the composer. Race
  // each read against a rolling idle timer instead.
  async function readWithIdleDeadline(): Promise<ReadableStreamReadResult<Uint8Array>> {
    let idleTimer = 0;
    const idle = new Promise<never>((_, reject) => {
      idleTimer = window.setTimeout(() => {
        // Reject BEFORE cancelling: cancel() resolves the pending read()
        // with done:true, and if that settles first the race ends cleanly
        // instead of surfacing the timeout.
        reject(new Error('Thingy went quiet mid-answer. Ask again - it usually clears.'));
        reader.cancel().catch(() => {});
      }, STREAM_IDLE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([reader.read(), idle]);
    } finally {
      window.clearTimeout(idleTimer);
    }
  }

  while (true) {
    const { value, done } = await readWithIdleDeadline();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      if (block) await consume(block);
    }
  }
  buffer += decoder.decode();
  // A leftover block missing its \n\n terminator is a truncated stream
  // tail (connection cut mid-event - usually the large done payload). SSE
  // never dispatches an unterminated event; the answer already streamed,
  // so dropping the tail beats failing the whole turn over it.
  if (buffer.trim()) {
    let parsed: ReturnType<typeof parseBlock> = null;
    try {
      parsed = parseBlock(buffer);
    } catch {
      parsed = null;
    }
    if (parsed) await onEvent(parsed.eventName, parsed.data);
  }
}

async function postJsonStream(options: ThingyRequestOptions = {}): Promise<Response> {
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl)
    throw new Error(options.missingMessage || 'Thingy has not been connected to the archive stream API yet.');
  const controller = options.controller || new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_API_TIMEOUT_MS));
  const response = await fetch(`${baseUrl}${options.path || ''}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...contractRequestHeaders(),
      ...(options.headers || {})
    },
    body: JSON.stringify(options.payload || {}),
    signal: controller.signal
  })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(options.abortMessage || 'Thingy took too long on that one. Try again.');
      }
      throw error;
    })
    .finally(() => {
      window.clearTimeout(timeout);
    });
  assertContractResponseVersion(response);
  if (!response.ok || !response.body) {
    const requestId = response.headers.get('x-request-id') || '';
    const data = looseApiError(await response.json().catch(() => ({})));
    const message = data.error || "Thingy isn't answering right now. Try again in a minute.";
    const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
    error.requestId = requestId;
    error.status = response.status;
    // Without the body, isAuthError() can't see codes like session_expired
    // on stream failures, so auth errors never redirected to sign-in.
    error.data = data;
    throw error;
  }
  if (/application\/json/i.test(response.headers.get('content-type') || '')) {
    const data = looseApiError(await response.json().catch(() => ({})));
    const message =
      data.errorMessage || data.error || data.message || 'The archive sent back something unexpected. Ask again.';
    const error = new Error(message);
    error.data = data;
    throw error;
  }
  return response;
}

export { parseBlock, postJsonStream, read };
