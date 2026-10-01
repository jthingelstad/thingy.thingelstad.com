// Vendors the Librarian's published MCP surface (librarian-thing
// apps/librarian/contracts/mcp-surface.json + .sha256), which the build
// renders into /connect/reference/. Mirrors sync-contract.mjs:
//
//   npm run mcp-surface:sync            copy from librarian-thing main
//   npm run mcp-surface:sync -- --local copy from the sibling checkout
//   npm run mcp-surface:check           fail if the vendored copy is stale
//
// MCP_SURFACE_SOURCE overrides the source (a URL, or a path relative to
// web/). The sibling path is relative on purpose: the thingelstad.com repos
// move as a unit.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = resolve(webRoot, 'contracts/mcp-surface.json');
const checksumPath = resolve(webRoot, 'contracts/mcp-surface.sha256');
const remoteSource =
  'https://raw.githubusercontent.com/jthingelstad/librarian-thing/main/apps/librarian/contracts/mcp-surface.json';
const siblingSource = '../../librarian-thing/apps/librarian/contracts/mcp-surface.json';

async function readSource(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { headers: { 'user-agent': 'thingy-mcp-surface-sync' } });
    if (!response.ok) throw new Error(`Could not fetch ${source}: HTTP ${response.status}`);
    return response.text();
  }
  return readFile(resolve(webRoot, source), 'utf8');
}

async function syncMcpSurface({ check = false, local = false } = {}) {
  const source = process.env.MCP_SURFACE_SOURCE || (local ? siblingSource : remoteSource);
  const [content, checksumFile] = await Promise.all([
    readSource(source),
    readSource(source.replace(/\.json$/, '.sha256'))
  ]);
  const expected = checksumFile.trim().split(/\s+/)[0];
  if (createHash('sha256').update(content).digest('hex') !== expected)
    throw new Error('The Librarian MCP surface checksum does not match its artifact.');
  const surface = JSON.parse(content);
  const checksumLine = `${expected}  ${basename(targetPath)}\n`;

  if (check) {
    const [current, currentChecksum] = await Promise.all([
      readFile(targetPath, 'utf8').catch(() => ''),
      readFile(checksumPath, 'utf8').catch(() => '')
    ]);
    if (current !== content || currentChecksum !== checksumLine)
      throw new Error('Vendored Librarian MCP surface is stale. Run npm run mcp-surface:sync.');
    process.stdout.write(`MCP surface ${surface.server.version} matches the Librarian artifact.\n`);
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  await writeFile(checksumPath, checksumLine);
  process.stdout.write(`Synced Librarian MCP surface ${surface.server.version} from ${source}.\n`);
}

syncMcpSurface({ check: process.argv.includes('--check'), local: process.argv.includes('--local') }).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
