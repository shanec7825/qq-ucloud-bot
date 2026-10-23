import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { preparePortable } from '../napcat-plugin/bootstrap.mjs';

const windows = process.platform === 'win32' && process.arch === 'x64';
async function fixture(work) {
  const parent = fileURLToPath(new URL('../data/test-tmp/', import.meta.url)); await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, 'portable-')), core = join(folder, 'napcat-plugin-qq-agent'), workspace = join(core, 'data/workspace');
  await mkdir(join(workspace, 'data'), { recursive: true }); await mkdir(join(core, 'runtime'), { recursive: true });
  await writeFile(join(workspace, 'data/settings.json'), 'KEEP_USER_CONFIGURATION');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex'), binary = Buffer.from('not-executed-node-fixture');
  await writeFile(join(core, 'runtime/node.exe'), binary);
  async function payload(files) {
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])));
    await writeFile(join(core, 'backend.zip'), bytes); await writeFile(join(core, 'distribution.json'), JSON.stringify({ backendSHA256: digest(bytes), nodeSHA256: digest(binary) }));
  }
  try { await work({ core, workspace, payload }); }
  finally { const actual = await realpath(folder), base = await realpath(parent); if (!actual.startsWith(base + sep)) throw Error('unsafe test cleanup'); await rm(actual, { recursive: true, force: true }); }
}

test('portable extraction rejects traversal, aliases and protected data before overwriting user configuration', { skip: !windows }, () => fixture(async ({ core, workspace, payload }) => {
  for (const path of ['src/../data/settings.json', './data/settings.json', 'DATA/settings.json', 'data./settings.json', 'data /settings.json', '../outside.txt']) {
    await payload({ [path]: 'OVERWRITE' }); await assert.rejects(preparePortable(core), /Archive|relative|personal-data|escapes/);
    assert.equal(await readFile(join(workspace, 'data/settings.json'), 'utf8'), 'KEEP_USER_CONFIGURATION');
  }
}));

test('framework extraction updates code without the optional Archive module and preserves user data', { skip: !windows }, () => fixture(async ({ core, workspace, payload }) => {
  await payload({ 'src/main.mjs': 'version one' }); await preparePortable(core);
  assert.equal(await readFile(join(workspace, 'src/main.mjs'), 'utf8'), 'version one');
  await payload({ 'src/main.mjs': 'version two' }); await preparePortable(core);
  assert.equal(await readFile(join(workspace, 'src/main.mjs'), 'utf8'), 'version two');
  assert.equal(await readFile(join(workspace, 'data/settings.json'), 'utf8'), 'KEEP_USER_CONFIGURATION');
}));
