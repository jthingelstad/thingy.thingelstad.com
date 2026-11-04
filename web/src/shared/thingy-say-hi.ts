// "Say hi to Thingy": each tap hops the mascot and cycles the speech
// bubble (an aria-live region, so the new line is announced). Without
// JavaScript the bubble keeps its first line and the press still hops
// through CSS :active. The 3D Thingy (thingy-3d.ts) answers too: its component
// reports a press that did not turn him as thingy-tap, and he jumps and spins,
// either way and to a different height each time, with a new face for a moment.
// Under reduced motion he stays put and only the face and the bubble change.
const LINES = [
  'Ask me about coffee, kubb, or two decades of links.',
  'Hi! Pull up a chair.',
  'Polka dots. Obviously.',
  'Go on, ask me something.'
];

// What a tap may bring to his face. The other faces mean something the moment
// has not earned: found-it a real find, oops a failure (persona/THINGY.md).
const TAP_FACES = ['delighted', 'curious', 'idle'];
const RESTING_FACE = 'original';
const FACE_HOLD_MS = 4000;
const HOP_LOWEST = 0.08;
const HOP_HIGHEST = 0.32;

type ThingyCharacter = HTMLElement & {
  hop?: (options: { height: number; direction: 1 | -1 }) => void;
};

export function wireSayHi(root: ParentNode = document, random: () => number = Math.random) {
  const button = root.querySelector<HTMLButtonElement>('.thingy-home-hi');
  const bubble = root.querySelector<HTMLElement>('.thingy-home-bubble');
  if (!button || !bubble) return;
  let index = 0;
  let faceTimer: ReturnType<typeof setTimeout> | undefined;
  const nextLine = () => {
    index = (index + 1) % LINES.length;
    bubble.textContent = LINES[index];
  };
  const hop = (mascot: Element) => {
    mascot.classList.remove('is-hopping');
    // Restart the hop on a quick second tap.
    void (mascot as HTMLElement).offsetWidth;
    mascot.classList.add('is-hopping');
  };
  const answerTap = (character: ThingyCharacter) => {
    character.hop?.({
      height: character.offsetHeight * (HOP_LOWEST + random() * (HOP_HIGHEST - HOP_LOWEST)),
      direction: random() < 0.5 ? -1 : 1
    });
    const faces = TAP_FACES.filter((face) => face !== character.getAttribute('face'));
    character.setAttribute('face', faces[Math.floor(random() * faces.length)]);
    clearTimeout(faceTimer);
    faceTimer = setTimeout(() => character.setAttribute('face', RESTING_FACE), FACE_HOLD_MS);
  };
  button.addEventListener('click', () => {
    nextLine();
    hop(button);
  });
  button.addEventListener('animationend', () => button.classList.remove('is-hopping'));
  root.addEventListener('thingy-tap', (event) => {
    nextLine();
    answerTap(event.target as ThingyCharacter);
  });
}
