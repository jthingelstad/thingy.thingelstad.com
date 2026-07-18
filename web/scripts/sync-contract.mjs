import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateContractClient } from './generate-contract-client.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = resolve(webRoot, 'contracts/librarian-api.v1.json');
const defaultSource =
  'https://raw.githubusercontent.com/jthingelstad/studio-thing/main/apps/librarian/contracts/librarian-api.v1.json';

async function readSource(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { headers: { 'user-agent': 'thingy-contract-sync' } });
    if (!response.ok) throw new Error(`Could not fetch ${source}: HTTP ${response.status}`);
    return response.text();
  }
  return readFile(resolve(webRoot, source), 'utf8');
}

function checksumSource(source) {
  return source.replace(/\.json$/, '.sha256');
}

async function syncContract({ check = false } = {}) {
  const source = process.env.LIBRARIAN_CONTRACT_SOURCE || defaultSource;
  const [content, checksumFile] = await Promise.all([readSource(source), readSource(checksumSource(source))]);
  const normalized = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
  const expectedChecksum = checksumFile.trim().split(/\s+/)[0];
  const actualChecksum = createHash('sha256').update(normalized).digest('hex');
  if (actualChecksum !== expectedChecksum)
    throw new Error('The Librarian contract checksum does not match its artifact.');

  if (check) {
    const current = await readFile(targetPath, 'utf8').catch(() => '');
    if (current !== normalized) throw new Error('Vendored Librarian contract is stale. Run npm run contract:sync.');
    await generateContractClient({ check: true });
    process.stdout.write(`Contract ${JSON.parse(normalized).version} matches Studio and generated client.\n`);
    return;
  }

  await writeFile(targetPath, normalized);
  await generateContractClient();
  process.stdout.write(`Synced Librarian contract ${JSON.parse(normalized).version} from ${source}.\n`);
}

syncContract({ check: process.argv.includes('--check') }).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
