// The static pages' small behaviours, run against the real page markup so
// the module and the HTML hooks cannot drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { COPIED_MS, wireCopyButtons } from '../src/shared/thingy-copy-buttons.ts';
import { wireSayHi } from '../src/shared/thingy-say-hi.ts';

function loadBody(page: string) {
  const html = readFileSync(resolve(__dirname, '..', page), 'utf8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
  // Drop the boot script: the test wires the module itself.
  document.body.innerHTML = body.slice(body.indexOf('>') + 1).replace(/<script[^>]*><\/script>/g, '');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('without the clipboard API the Copy buttons stay hidden', () => {
  loadBody('connect/index.html');
  const stubs = [...document.querySelectorAll<HTMLElement>('.thingy-ticket-stub')];
  expect(stubs.length).toBeGreaterThan(0);
  expect(wireCopyButtons(document, null)).toBe(0);
  expect(stubs.every((stub) => stub.hidden)).toBe(true);
  expect(document.querySelector('.thingy-ticket.has-copy')).toBeNull();
});

test('a Copy press copies the code, says Copied! for two seconds and announces it', async () => {
  loadBody('connect/index.html');
  const writeText = vi.fn(async () => {});
  const tickets = document.querySelectorAll('.thingy-ticket');
  expect(wireCopyButtons(document, { writeText })).toBe(tickets.length);

  const ticket = tickets[0];
  const stub = ticket.querySelector<HTMLElement>('.thingy-ticket-stub')!;
  const button = ticket.querySelector<HTMLButtonElement>('.thingy-copy-btn')!;
  const label = button.querySelector('.thingy-copy-label')!;
  const status = document.getElementById('thingy-copy-status')!;
  expect(stub.hidden).toBe(false);
  expect(status.getAttribute('role')).toBe('status');

  button.click();
  await vi.waitFor(() => expect(label.textContent).toBe('Copied!'));
  expect(writeText).toHaveBeenCalledWith('https://librarian.thingelstad.com/mcp');
  expect(button.classList.contains('is-copied')).toBe(true);
  expect(status.textContent).toBe(`Copied ${button.dataset.copyWhat} to the clipboard`);

  vi.advanceTimersByTime(COPIED_MS);
  expect(label.textContent).toBe('Copy');
  expect(button.classList.contains('is-copied')).toBe(false);
  expect(status.textContent).toBe('');
});

test('a refused copy keeps the button and tells the reader to select the text', async () => {
  loadBody('connect/index.html');
  wireCopyButtons(document, { writeText: async () => Promise.reject(new Error('denied')) });
  const button = document.querySelector<HTMLButtonElement>('.thingy-copy-btn')!;
  const status = document.getElementById('thingy-copy-status')!;
  button.click();
  await vi.waitFor(() => expect(status.textContent).toBe('Could not copy. Select the text to copy it.'));
  expect(button.querySelector('.thingy-copy-label')!.textContent).toBe('Copy');
});

test('saying hi cycles the bubble and hops Thingy', () => {
  loadBody('index.html');
  const button = document.querySelector<HTMLButtonElement>('.thingy-home-hi')!;
  const bubble = document.querySelector<HTMLElement>('.thingy-home-bubble')!;
  expect(bubble.getAttribute('aria-live')).toBe('polite');
  const first = bubble.textContent?.trim();
  wireSayHi();
  button.click();
  expect(bubble.textContent).not.toBe(first);
  expect(button.classList.contains('is-hopping')).toBe(true);
  button.dispatchEvent(new Event('animationend'));
  expect(button.classList.contains('is-hopping')).toBe(false);
  for (let i = 0; i < 3; i += 1) button.click();
  expect(bubble.textContent).toBe(first);
});

test('the say-hi module does nothing on a page without the stage', () => {
  document.body.innerHTML = '<main></main>';
  expect(() => wireSayHi()).not.toThrow();
});
