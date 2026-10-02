// "Say hi to Thingy": each tap hops the mascot and cycles the speech
// bubble (an aria-live region, so the new line is announced). Without
// JavaScript the bubble keeps its first line and the press still hops
// through CSS :active.
const LINES = [
  'Ask me about coffee, kubb, or 25 years of links.',
  'Hi! Pull up a chair.',
  'Polka dots. Obviously.',
  'Go on, ask me something.'
];

export function wireSayHi(root: ParentNode = document) {
  const button = root.querySelector<HTMLButtonElement>('.thingy-home-hi');
  const bubble = root.querySelector<HTMLElement>('.thingy-home-bubble');
  if (!button || !bubble) return;
  let index = 0;
  button.addEventListener('click', () => {
    index = (index + 1) % LINES.length;
    bubble.textContent = LINES[index];
    button.classList.remove('is-hopping');
    // Restart the hop on a quick second tap.
    void button.offsetWidth;
    button.classList.add('is-hopping');
  });
  button.addEventListener('animationend', () => button.classList.remove('is-hopping'));
}
