import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { pluginBuildId, versionedPluginSource } from '../napcat-plugin/versioned-source.mjs';

test('plugin reload refreshes relative ESM dependencies in the same NapCat process', async () => {
  const parent = new URL('../data/test-tmp/', import.meta.url); await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('plugin-reload-', parent)));
  const entry = 'import { value } from "./dependency.mjs"; export { value };';
  try {
    for (const value of [1, 2]) {
      const dependency = `export const value = ${value};`, buildId = pluginBuildId([entry, dependency]);
      await writeFile(join(folder, 'dependency.mjs'), dependency);
      await writeFile(join(folder, 'index.mjs'), versionedPluginSource(entry, buildId));
      const loaded = await import(pathToFileURL(join(folder, 'index.mjs')).href + '?napcat=' + value);
      assert.equal(loaded.value, value);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('plugin build identity tracks all sources and leaves builtin and external imports alone', () => {
  const source = 'import x from "./webui/copy.mjs"; import fs from "node:fs"; export { x } from "./catalog.mjs";';
  const first = pluginBuildId([source, 'one']), second = pluginBuildId([source, 'two']);
  assert.notEqual(first, second);
  const output = versionedPluginSource(source, first);
  assert.ok(output.includes('./webui/copy.mjs?qlyra=' + first));
  assert.ok(output.includes('./catalog.mjs?qlyra=' + first));
  assert.ok(output.includes('from "node:fs"'));
  assert.throws(() => versionedPluginSource(source, '../bad'), /identity/);
});
