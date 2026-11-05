// Thingy's pictures live at his home, thingy.thingelstad.xyz, whose
// character/latest/ is always the newest model. Each name is a still its
// manifest lists: a pose, or a pose and a face.
export function thingyStill(name: string): string {
  return `https://thingy.thingelstad.xyz/character/latest/poses/library-${name}.webp`;
}
