function parseBlock(block) {
    let eventName = 'message';
    const dataLines = [];
    String(block || '').split('\n').forEach((line) => {
      const clean = line.replace(/\r$/, '');
      if (!clean || clean.startsWith(':')) return;
      if (clean.startsWith('event:')) eventName = clean.slice(6).trim();
      if (clean.startsWith('data:')) dataLines.push(clean.slice(5).trimStart());
    });
    if (!dataLines.length) return null;
    const raw = dataLines.join('\n');
    try {
      return { eventName, data: JSON.parse(raw) };
    } catch (error) {
      const streamError = new Error('Thingy sent a malformed stream event. Please try again.');
      streamError.cause = error;
      streamError.raw = raw;
      throw streamError;
    }
  }

async function read(response, onEvent) {
    if (!response || !response.body) throw new Error('Thingy did not return a stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    async function consume(rawBlock) {
      const parsed = parseBlock(rawBlock);
      if (!parsed) return;
      await onEvent(parsed.eventName, parsed.data);
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (block) await consume(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consume(buffer);
  }

async function postJsonStream(options = {}) {
    const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error(options.missingMessage || 'Thingy has not been connected to the archive stream API yet.');
    const controller = options.controller || new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), Number(options.timeoutMs || 60000));
    const response = await fetch(`${baseUrl}${options.path || ''}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(options.payload || {}),
      signal: controller.signal
    }).catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error(options.abortMessage || 'Thingy took too long to respond. Please try again.');
      }
      throw error;
    }).finally(() => {
      window.clearTimeout(timeout);
    });
    if (!response.ok || !response.body) {
      const requestId = response.headers.get('x-request-id') || '';
      const data = await response.json().catch(() => ({}));
      const message = data.error || 'Thingy is unavailable.';
      const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
      error.requestId = requestId;
      error.status = response.status;
      throw error;
    }
    return response;
  }

export { parseBlock, postJsonStream, read };
