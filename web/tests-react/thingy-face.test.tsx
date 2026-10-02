import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThingyFace, type ThingyFaceMood } from '../src/react/components/ThingyFace.tsx';

afterEach(cleanup);

function face(container: HTMLElement) {
  const svg = container.querySelector('svg.thingy-face');
  if (!svg) throw new Error('no face rendered');
  return svg;
}

test('the default face is idle, decorative, and blinks', () => {
  const { container } = render(<ThingyFace />);
  const svg = face(container);
  expect(svg.getAttribute('data-mood')).toBe('idle');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('role')).toBeNull();
  expect(svg.classList.contains('thingy-face-animated')).toBe(true);
  expect(svg.querySelector('.thingy-face-blink')).not.toBeNull();
  expect(svg.querySelector('.thingy-face-scan')).toBeNull();
});

test('each mood draws its own features on the dark screen', () => {
  const draws: Record<ThingyFaceMood, (svg: Element) => void> = {
    idle: (svg) => expect(svg.querySelectorAll('.thingy-face-blink path')).toHaveLength(2),
    thinking: (svg) => expect(svg.querySelectorAll('.thingy-face-scan circle')).toHaveLength(2),
    'found-it': (svg) => {
      // A wink: one arched eye, one flat stroke, and the wide smile.
      expect(svg.querySelectorAll('path')).toHaveLength(3);
      expect(svg.querySelector('.thingy-face-blink')).toBeNull();
    },
    oops: (svg) => {
      const peach = [...svg.querySelectorAll('circle')].filter(
        (node) =>
          node.getAttribute('fill') === 'var(--thingy-oops)' || node.getAttribute('stroke') === 'var(--thingy-oops)'
      );
      expect(peach).toHaveLength(3);
    }
  };
  for (const mood of Object.keys(draws) as ThingyFaceMood[]) {
    const { container, unmount } = render(<ThingyFace mood={mood} />);
    const svg = face(container);
    expect(svg.getAttribute('data-mood')).toBe(mood);
    // Bezel and screen: the cream ring with the ink outline, then the screen.
    const [bezel, screenRect] = svg.querySelectorAll('rect');
    expect(bezel.getAttribute('fill')).toBe('var(--thingy-bezel)');
    expect(bezel.getAttribute('stroke')).toBe('var(--thingy-ink)');
    expect(screenRect.getAttribute('fill')).toBe('var(--thingy-screen)');
    draws[mood](svg);
    unmount();
  }
});

test('a labelled face is an image with that name', () => {
  render(<ThingyFace mood="oops" label="Thingy hit a snag" />);
  const img = screen.getByRole('img', { name: 'Thingy hit a snag' });
  expect(img.getAttribute('aria-hidden')).toBeNull();
});

test('size sets the width and keeps the face proportions', () => {
  const { container } = render(<ThingyFace size={116} />);
  const svg = face(container);
  expect(svg.getAttribute('width')).toBe('116');
  expect(svg.getAttribute('height')).toBe('92');
  expect(svg.getAttribute('viewBox')).toBe('0 0 116 92');
});

test('animated={false} draws the mood without motion', () => {
  const { container } = render(<ThingyFace mood="thinking" animated={false} />);
  expect(face(container).classList.contains('thingy-face-animated')).toBe(false);
});

test('the face motion is CSS only and stops under reduced motion', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/thingy-components.css'), 'utf8');
  expect(css).toMatch(/\.thingy-face-animated \.thingy-face-blink\s*{[^}]*animation: thingy-face-blink/);
  expect(css).toMatch(/\.thingy-face-animated \.thingy-face-scan\s*{[^}]*animation: thingy-face-scan/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toMatch(/\.thingy-face \*\s*{\s*animation: none;/);
});
