// Every still this site names has to exist at Thingy's home and be registered
// there, because the registration is what holds his next model to it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = 'https://thingy.thingelstad.xyz';
const SITE = 'https://thingy.thingelstad.com/';
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(html|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

function stillsNamedIn(source) {
  const direct = [...source.matchAll(/character\/latest\/poses\/([a-z-]+)\.webp/g)].map((m) => m[1]);
  const viaHelper = [...source.matchAll(/thingyStill\(['"]([a-z-]+)['"]\)/g)].map((m) => `librarian-${m[1]}`);
  return [...direct, ...viaHelper];
}

async function json(path) {
  const response = await fetch(`${HOME}${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

const sources = ['index.html', 'about', 'connect', 'public', 'src'].flatMap((name) => {
  const path = join(webRoot, name);
  return name.endsWith('.html') ? [path] : files(path);
});
const named = new Set(sources.flatMap((path) => stillsNamedIn(readFileSync(path, 'utf8'))));
if (!named.size) throw new Error('Found no stills, so this check has stopped reading the code');

const [manifest, { surfaces }] = await Promise.all([
  json('/character/latest/manifest.json'),
  json('/kit/surfaces.json')
]);
const published = new Set(
  Object.values(manifest.outfits).flatMap((outfit) => Object.values(outfit.stills ?? {}).map((still) => still.webp))
);
const registered = new Set(surfaces.find((surface) => surface.url === SITE)?.stills);

const problems = [...named].flatMap((still) => [
  ...(published.has(`poses/${still}.webp`) ? [] : [`${still} is not in the manifest's stills`]),
  ...(registered.has(still) ? [] : [`${still} is not in this site's entry in kit/surfaces.json`])
]);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${named.size} stills are published and registered at ${HOME}`);
