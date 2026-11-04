// The static pages' small behaviours, run against the real page markup so
// the module and the HTML hooks cannot drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { COPIED_MS, wireCopyButtons } from '../src/shared/thingy-copy-buttons.ts';
import { mountThingy3D } from '../src/shared/thingy-3d.ts';
import { wireSayHi } from '../src/shared/thingy-say-hi.ts';

function loadBody(page: string) {
  const html = readFileSync(resolve(__dirname, '..', page), 'utf8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
  // Drop the boot script: the test wires the module itself.
  document.body.innerHTML = body.slice(body.indexOf('>') + 1).replace(/<script[^>]*><\/script>/g, '');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
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
  wireSayHi(document.querySelector('main')!);
  button.click();
  expect(bubble.textContent).not.toBe(first);
  expect(button.classList.contains('is-hopping')).toBe(true);
  button.dispatchEvent(new Event('animationend'));
  expect(button.classList.contains('is-hopping')).toBe(false);
  for (let i = 0; i < 3; i += 1) button.click();
  expect(bubble.textContent).toBe(first);
});

function tappable3D(hop = vi.fn()) {
  loadBody('index.html');
  const character = Object.assign(document.createElement('thingy-character'), { hop });
  character.setAttribute('face', 'original');
  document.querySelector('.thingy-home-hi')!.after(character);
  return { character, hop, tap: () => character.dispatchEvent(new CustomEvent('thingy-tap', { bubbles: true, composed: true })) };
}

test('a tap on the 3D Thingy says hi and hops him, not the hidden still', () => {
  const { character, hop, tap } = tappable3D();
  const bubble = document.querySelector<HTMLElement>('.thingy-home-bubble')!;
  const first = bubble.textContent?.trim();
  wireSayHi(document.querySelector('main')!);
  tap();
  expect(bubble.textContent).not.toBe(first);
  expect(hop).toHaveBeenCalledOnce();
  expect(character.classList.contains('is-hopping')).toBe(false);
  expect(document.querySelector('.thingy-home-hi.is-hopping')).toBeNull();
});

test('each tap spins him either way, to a height from low to high', () => {
  const { character, hop, tap } = tappable3D();
  vi.spyOn(character, 'offsetHeight', 'get').mockReturnValue(400);
  const rolls = [0, 0.25, 0, 1 - Number.EPSILON, 0.75, 0];
  wireSayHi(document.querySelector('main')!, () => rolls.shift() ?? 0);
  tap();
  tap();
  expect(hop.mock.calls[0][0].direction).toBe(-1);
  expect(hop.mock.calls[0][0].height).toBeCloseTo(32);
  expect(hop.mock.calls[1][0].direction).toBe(1);
  expect(hop.mock.calls[1][0].height).toBeCloseTo(128);
});

test('a tap changes his face, never to the same one, and it comes back', () => {
  vi.useFakeTimers();
  const { character, tap } = tappable3D();
  wireSayHi(document.querySelector('main')!);
  let last = character.getAttribute('face');
  for (let i = 0; i < 20; i += 1) {
    tap();
    const face = character.getAttribute('face');
    expect(['delighted', 'curious', 'idle']).toContain(face);
    expect(face).not.toBe(last);
    last = face;
  }
  vi.advanceTimersByTime(3999);
  expect(character.getAttribute('face')).toBe(last);
  vi.advanceTimersByTime(1);
  expect(character.getAttribute('face')).toBe('original');
  vi.useRealTimers();
});

test('a component without hop still changes face', () => {
  loadBody('index.html');
  const character = document.createElement('thingy-character');
  document.querySelector('.thingy-home-hi')!.after(character);
  wireSayHi(document.querySelector('main')!);
  character.dispatchEvent(new CustomEvent('thingy-tap', { bubbles: true, composed: true }));
  expect(character.getAttribute('face')).toBeTruthy();
});

function withWebGL() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext);
}

async function settle() {
  await vi.advanceTimersByTimeAsync(2000);
}

test('the 3D Thingy mounts over his still and takes over when ready', async () => {
  loadBody('index.html');
  withWebGL();
  const load = vi.fn(async () => ({}));
  mountThingy3D(document, load);
  await settle();
  expect(load).toHaveBeenCalledOnce();
  const stage = document.querySelector('.thingy-home-stage')!;
  const character = stage.querySelector('thingy-character')!;
  expect(character.previousElementSibling?.classList.contains('thingy-home-hi')).toBe(true);
  expect(character.getAttribute('version')).toBe('latest');
  expect(character.getAttribute('zoom')).toBe('off');
  expect(character.getAttribute('poster')).toBe(stage.querySelector('.thingy-home-hi img')!.getAttribute('src'));
  expect(stage.classList.contains('is-3d')).toBe(false);
  character.dispatchEvent(new CustomEvent('thingy-ready'));
  expect(stage.classList.contains('is-3d')).toBe(true);
});

test('when the model fails he goes and the still stays', async () => {
  loadBody('index.html');
  withWebGL();
  mountThingy3D(document, async () => ({}));
  await settle();
  const stage = document.querySelector('.thingy-home-stage')!;
  stage.querySelector('thingy-character')!.dispatchEvent(new CustomEvent('thingy-fallback'));
  expect(stage.querySelector('thingy-character')).toBeNull();
  expect(stage.classList.contains('is-3d')).toBe(false);
});

test('the still stays with no WebGL, with Save-Data, or when the component will not load', async () => {
  loadBody('index.html');
  const load = vi.fn(async () => ({}));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  mountThingy3D(document, load);
  await settle();
  expect(load).not.toHaveBeenCalled();

  withWebGL();
  Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  mountThingy3D(document, load);
  await settle();
  expect(load).not.toHaveBeenCalled();
  Reflect.deleteProperty(navigator, 'connection');

  mountThingy3D(document, async () => {
    throw new Error('blocked');
  });
  await settle();
  expect(document.querySelector('thingy-character')).toBeNull();
});

test('the say-hi module does nothing on a page without the stage', () => {
  document.body.innerHTML = '<main></main>';
  expect(() => wireSayHi()).not.toThrow();
});
