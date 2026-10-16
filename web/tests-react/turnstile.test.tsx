import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The sign-in click waits at most MAX_WAIT_MS for a Turnstile token, then
// sends the request without one (observe mode lets it through). It once
// waited two minutes whenever the widget asked for a checkbox.

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  delete window.turnstile;
  delete window.thingyTurnstileLoaded;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.turnstile;
});

function widgetThatNeverAnswers() {
  const options: Record<string, unknown>[] = [];
  window.turnstile = {
    render: (_el: HTMLElement, opts: Record<string, unknown>) => {
      options.push(opts);
      // The widget asks for a checkbox nobody ticks.
      const beforeInteractive = opts['before-interactive-callback'];
      if (typeof beforeInteractive === 'function') beforeInteractive();
      return 'widget-1';
    },
    reset: () => {}
  } as unknown as ThingyTurnstileApi;
  return options;
}

async function handle() {
  const { attachTurnstile, MAX_WAIT_MS } = await import('../src/shared/turnstile.ts');
  const slot = document.createElement('div');
  return { turnstile: attachTurnstile(() => slot, 'signin'), MAX_WAIT_MS };
}

async function settleWithin(promise: Promise<string>, ms: number) {
  let value: string | undefined;
  void promise.then((v) => (value = v));
  await vi.advanceTimersByTimeAsync(ms);
  return value;
}

test('an interactive challenge nobody answers sends without a token within the bound', async () => {
  widgetThatNeverAnswers();
  const { turnstile, MAX_WAIT_MS } = await handle();
  expect(MAX_WAIT_MS).toBeLessThanOrEqual(5000);
  const first = turnstile.tokenFor('reader@example.com');
  expect(await settleWithin(first, MAX_WAIT_MS - 100)).toBeUndefined();
  expect(await settleWithin(first, 200)).toBe('');
  // The next click (subscribe after check) does not wait again.
  expect(await settleWithin(turnstile.tokenFor('reader@example.com'), 0)).toBe('');
});

test('a Cloudflare script that never loads sends without a token within the bound', async () => {
  // The script tag is never added, so no network and no onload.
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node);
  const { turnstile, MAX_WAIT_MS } = await handle();
  expect(await settleWithin(turnstile.tokenFor('reader@example.com'), MAX_WAIT_MS + 100)).toBe('');
});

test('a token that arrives after a timeout is used by the next click', async () => {
  const options = widgetThatNeverAnswers();
  const { turnstile, MAX_WAIT_MS } = await handle();
  expect(await settleWithin(turnstile.tokenFor('reader@example.com'), MAX_WAIT_MS + 100)).toBe('');
  const callback = options[0].callback as (value: string) => void;
  callback('late-token');
  expect(await settleWithin(turnstile.tokenFor('reader@example.com'), 0)).toBe('late-token');
});

test('a token that arrives inside the bound is sent', async () => {
  const options = widgetThatNeverAnswers();
  const { turnstile } = await handle();
  const pending = turnstile.tokenFor('reader@example.com');
  await vi.advanceTimersByTimeAsync(500);
  (options[0].callback as (value: string) => void)('quick-token');
  expect(await settleWithin(pending, 0)).toBe('quick-token');
});
