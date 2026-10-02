// The mascot's screen face (Felt & Tangerine, 2026-10-01): a dark rounded
// screen in a cream bezel with an ink ring, mint eyes and smile. Drawn in
// SVG from the BrandKit board so it stays crisp from a 22px loader to a
// hero. Four moods:
//   idle      - arched eyes and a smile; blinks now and then
//   thinking  - two scanning dots and a flat mouth (the loader)
//   found-it  - a wink and a wide smile
//   oops      - peach dots and a small round mouth (errors)
// Motion is CSS only (thingy-components.css, .thingy-face-*) and stops
// under prefers-reduced-motion. No PixiJS, no confetti.

type ThingyFaceMood = 'idle' | 'thinking' | 'found-it' | 'oops';

// Geometry is the BrandKit face: a 110x86 bezel with a 3px ink ring, so
// the drawing is 116x92 and the screen inset sits at 9px.
const VIEW_W = 116;
const VIEW_H = 92;

const MINT = 'var(--thingy-mint)';
const OOPS = 'var(--thingy-oops)';

function Features({ mood }: { mood: ThingyFaceMood }) {
  switch (mood) {
    case 'thinking':
      return (
        <>
          <g className="thingy-face-scan">
            <circle cx="40.5" cy="38" r="5.5" fill={MINT} />
            <circle cx="75.5" cy="38" r="5.5" fill={MINT} />
          </g>
          <rect x="48" y="55.5" width="20" height="4" rx="2" fill={MINT} />
        </>
      );
    case 'found-it':
      return (
        <g fill="none" stroke={MINT} strokeWidth="4" strokeLinecap="round">
          <path d="M29 41a9 9 0 0 1 18 0" />
          <path d="M73 35h14" />
          <path d="M41 47q17 21 34 0" />
        </g>
      );
    case 'oops':
      return (
        <>
          <circle cx="40.5" cy="32" r="4.5" fill={OOPS} />
          <circle cx="75.5" cy="32" r="4.5" fill={OOPS} />
          <circle cx="58" cy="55.5" r="7" fill="none" stroke={OOPS} strokeWidth="4" />
        </>
      );
    default:
      return (
        <g fill="none" stroke={MINT} strokeWidth="4" strokeLinecap="round">
          <g className="thingy-face-blink">
            <path d="M27 42a9 9 0 0 1 18 0" />
            <path d="M71 42a9 9 0 0 1 18 0" />
          </g>
          <path d="M45 50q13 14 26 0" />
        </g>
      );
  }
}

export function ThingyFace({
  mood = 'idle',
  size = 40,
  label,
  animated = true,
  className = ''
}: {
  mood?: ThingyFaceMood;
  /** Rendered width in px; the height follows the face's proportions. */
  size?: number;
  /** Accessible name. Without one the face is decorative (aria-hidden). */
  label?: string;
  /** False draws the mood without its motion (e.g. a still avatar). */
  animated?: boolean;
  className?: string;
}) {
  const height = Math.round((size * VIEW_H) / VIEW_W);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      className={`thingy-face ${animated ? 'thingy-face-animated' : ''} ${className}`.trim()}
      data-mood={mood}
      width={size}
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      focusable="false"
      {...a11y}
    >
      <rect
        x="1.5"
        y="1.5"
        width={VIEW_W - 3}
        height={VIEW_H - 3}
        rx="31.5"
        fill="var(--thingy-bezel)"
        stroke="var(--thingy-ink)"
        strokeWidth="3"
      />
      <rect x="9" y="9" width={VIEW_W - 18} height={VIEW_H - 18} rx="24" fill="var(--thingy-screen)" />
      <Features mood={mood} />
    </svg>
  );
}

export type { ThingyFaceMood };
