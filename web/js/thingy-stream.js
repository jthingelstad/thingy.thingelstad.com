(function () {
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

  window.ThingyStream = { parseBlock, read };
}());
