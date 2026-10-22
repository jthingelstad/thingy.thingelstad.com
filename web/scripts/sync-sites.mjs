// Vendors the canonical list of Jamie's sites (thingelstad.com
// shared/sites.json) into contracts/sites.json, which the build renders as
// the sites strip on /, /about/, /connect/ and /connect/reference/
// (vite.page-data.ts), and the type the sites share (shared/tokens.css and
// shared/fonts/) byte for byte into public/shared/, served as /shared/.
// Mirrors www.thingelstad.com/scripts/sync-shared.sh and the Weekly Thing's
// scripts/sync-sites.mjs:
//
//   npm run sites:sync    copy from the sibling shared/
//   npm run sites:check   fail if any vendored copy is stale
//
// SITES_SOURCE overrides the source path (relative to web/); the shared type
// is read from the same directory. The default is ../shared/sites.json from
// the repo root; it is relative on purpose because the thingelstad.com repos
// move as a unit.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = resolve(webRoot, 'contracts/sites.json');
const siblingSource = '../../shared/sites.json';
const sharedPublicDir = resolve(webRoot, 'public/shared');

// The shared type: tokens.css and the fonts it names, as [source, target].
async function sharedTypeFiles(sharedDir) {
  const fonts = (await readdir(join(sharedDir, 'fonts'))).filter((name) => /\.(woff2|txt)$/.test(name)).sort();
  return [
    [join(sharedDir, 'tokens.css'), join(sharedPublicDir, 'tokens.css')],
    ...fonts.map((name) => [join(sharedDir, 'fonts', name), join(sharedPublicDir, 'fonts', name)])
  ];
}

async function syncSites({ check = false } = {}) {
  const source = resolve(webRoot, process.env.SITES_SOURCE || siblingSource);
  const content = await readFile(source, 'utf8');
  const data = JSON.parse(content);
  if (!Array.isArray(data.sites) || data.sites.length === 0) throw new Error(`${source} has no sites list.`);

  const typeFiles = await sharedTypeFiles(dirname(source));

  if (check) {
    const current = await readFile(targetPath, 'utf8').catch(() => '');
    if (current !== content) throw new Error('Vendored sites.json is stale. Run npm run sites:sync.');
    for (const [from, to] of typeFiles) {
      const [want, have] = await Promise.all([readFile(from), readFile(to).catch(() => null)]);
      if (!have || !want.equals(have))
        throw new Error(`Vendored ${relative(webRoot, to)} is stale. Run npm run sites:sync.`);
    }
    const wanted = new Set(typeFiles.map(([, to]) => to));
    const extra = (await readdir(join(sharedPublicDir, 'fonts')).catch(() => []))
      .map((name) => join(sharedPublicDir, 'fonts', name))
      .filter((path) => !wanted.has(path));
    if (extra.length > 0)
      throw new Error(`${relative(webRoot, extra[0])} is not in shared/fonts/. Run npm run sites:sync.`);
    process.stdout.write(`sites.json and the shared type match ${dirname(source)}.\n`);
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  await mkdir(join(sharedPublicDir, 'fonts'), { recursive: true });
  for (const [from, to] of typeFiles) await writeFile(to, await readFile(from));
  process.stdout.write(
    `Synced ${data.sites.length} sites and ${typeFiles.length} shared type files from ${dirname(source)}.\n`
  );
}

syncSites({ check: process.argv.includes('--check') }).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
