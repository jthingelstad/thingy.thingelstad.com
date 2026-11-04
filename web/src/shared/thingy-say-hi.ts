// "Say hi to Thingy": each tap hops the mascot and cycles the speech
// bubble (an aria-live region, so the new line is announced). Without
// JavaScript the bubble keeps its first line and the press still hops
// through CSS :active. The 3D Thingy (thingy-3d.ts) answers the same way:
// its component reports a press that did not turn him as thingy-tap.
const LINES = [
  'Ask me about coffee, kubb, or two decades of links.',
  'Hi! Pull up a chair.',
  'Polka dots. Obviously.',
  'Go on, ask me something.'
];

export function wireSayHi(root: ParentNode = document) {
  const button = root.querySelector<HTMLButtonElement>('.thingy-home-hi');
  const bubble = root.querySelector<HTMLElement>('.thingy-home-bubble');
  if (!button || !bubble) return;
  let index = 0;
  const hop = (mascot: Element) => {
    mascot.classList.remove('is-hopping');
    // Restart the hop on a quick second tap.
    void (mascot as HTMLElement).offsetWidth;
    mascot.classList.add('is-hopping');
  };
  const sayHi = (mascot: Element) => {
    index = (index + 1) % LINES.length;
    bubble.textContent = LINES[index];
    hop(mascot);
  };
  button.addEventListener('click', () => sayHi(button));
  button.addEventListener('animationend', () => button.classList.remove('is-hopping'));
  root.addEventListener('thingy-tap', (event) => sayHi(event.target as Element));
  root.addEventListener('animationend', (event) => {
    const target = event.target as Element;
    if (target.localName === 'thingy-character') target.classList.remove('is-hopping');
  });
}
