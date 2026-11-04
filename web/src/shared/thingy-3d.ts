// The home page's Thingy you can turn. The picture in the hero is a still of
// this same model from this same angle, so it stands in until the model is
// ready and stays when it is not: no JavaScript, no WebGL or Save-Data. Both
// come from thingy.thingelstad.xyz, his home, and follow the newest model there.
const COMPONENT = 'https://thingy.thingelstad.xyz/thingy.js';

function canDraw(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export function mountThingy3D(root: Document = document, load = () => import(/* @vite-ignore */ COMPONENT)) {
  const stage = root.querySelector<HTMLElement>('.thingy-home-stage');
  const button = stage?.querySelector<HTMLButtonElement>('.thingy-home-hi');
  const poster = button?.querySelector('img')?.getAttribute('src');
  if (!stage || !button || !poster || savingData() || !canDraw()) return;
  const start = async () => {
    try {
      await load();
    } catch {
      return;
    }
    const character = root.createElement('thingy-character');
    character.className = 'thingy-home-3d';
    for (const [name, value] of Object.entries({
      outfit: 'librarian',
      version: 'latest',
      // Hello, not present: people can turn him, and the present hand, seen from
      // his side, is one raised finger on the back of a closed hand.
      pose: 'hello',
      face: 'original',
      blink: 'on',
      zoom: 'off',
      poster,
      'view-label': 'Thingy. Arrow keys turn him, Enter says hi.'
    })) {
      character.setAttribute(name, value);
    }
    character.addEventListener('thingy-ready', () => stage.classList.add('is-3d'), { once: true });
    character.addEventListener('thingy-fallback', () => character.remove(), { once: true });
    button.after(character);
  };
  // After the page is up: the hero's still is what the reader sees first.
  const whenIdle = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => void start(), { timeout: 1500 });
    else setTimeout(() => void start(), 200);
  };
  if (root.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}
