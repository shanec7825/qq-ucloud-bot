import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const out = join(root, 'release', pkg.version), app = join(out, 'win-x64'); await mkdir(out, { recursive: true });
const payload = await readFile(join(app, 'backend.zip')), runtime = await readFile(join(app, 'runtime/node.exe'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), backend = unzipSync(payload);
if (Object.keys(backend).some(path => /^(?:data|tools)\//.test(path) || /(?:^|\/)\.env/.test(path))) throw new Error('插件后端包含个人配置。');
const manifest = JSON.parse(await readFile(join(root, 'napcat-plugin/package.json'), 'utf8')), bundle = {}, index = [], sums = [];
for (const plugin of PLUGIN_MODULES) {
  const files = {};
  for (const name of ['index.mjs', 'bridge.mjs', 'engine.mjs', 'catalog.mjs', 'bootstrap.mjs', 'native-config.mjs']) files[name] = new Uint8Array(await readFile(join(root, 'napcat-plugin', name)));
  files['package.json'] = Buffer.from(JSON.stringify({ ...manifest, name: plugin.id, plugin: plugin.name, description: plugin.description, version: pkg.version, homepage: 'https://github.com/shanec7825/qq-ucloud-bot', napcat: { ...manifest.napcat, tags: ['AI', '工具'] } }, null, 2));
  files['deployment.json'] = Buffer.from(JSON.stringify({ distribution: 1, pluginId: plugin.id }));
  files['README.md'] = new Uint8Array(await readFile(join(root, 'docs/PLUGIN-DISTRIBUTION.md')));
  if (plugin.module === 'core') {
    files['backend.zip'] = payload; files['runtime/node.exe'] = runtime;
    files['runtime/LICENSE-Node.txt'] = new Uint8Array(await readFile(join(app, 'runtime/LICENSE-Node.txt')));
    files['distribution.json'] = Buffer.from(JSON.stringify({ version: pkg.version, platform: 'win32-x64', backendSHA256: hash(payload), nodeSHA256: hash(runtime) }));
  }
  const bytes = zipSync(files, { level: 6 }), name = plugin.id + '.zip'; await writeFile(join(out, name), bytes); sums.push(hash(bytes) + '  ' + name);
  for (const [path, bytes] of Object.entries(files)) bundle[plugin.id + '/' + path] = bytes;
  index.push({ id: plugin.id, name: plugin.name, version: pkg.version, description: plugin.description, platform: 'windows-x64', requires: plugin.module === 'core' ? [] : ['napcat-plugin-qq-agent'], downloadUrl: `https://github.com/shanec7825/qq-ucloud-bot/releases/download/v${pkg.version}/${name}`, sha256: hash(bytes) });
}
const bundleName = `QQ-Agent-Plugins-${pkg.version}-win-x64.zip`, all = zipSync(bundle, { level: 6 }); await writeFile(join(out, bundleName), all); sums.push(hash(all) + '  ' + bundleName);
await writeFile(join(out, 'plugins.json'), JSON.stringify({ note: 'GitHub download manifest; not an official NapCat marketplace approval.', plugins: index }, null, 2));
const names = new Set(sums.map(line => line.split('  ')[1]));
const prior = (await readFile(join(out, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').filter(line => !names.has(line.split('  ')[1]));
await writeFile(join(out, 'SHA256SUMS.txt'), [...prior, ...sums].join('\n') + '\n');
console.log('已生成 5 个可独立下载的插件包、整套插件包与下载清单；不含个人配置和本机路径。');
