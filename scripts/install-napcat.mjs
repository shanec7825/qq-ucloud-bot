import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { trustSlyraPlugin } from '../napcat-plugin/local-trust.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const pluginRoot = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || join(projectRoot, 'tools/napcat/napcat/plugins/napcat-plugin-slyra'));
if (!pluginRoot.endsWith('napcat-plugin-slyra')) throw new Error('目标目录必须为 napcat-plugin-slyra。');
let trustPatch;
if (process.argv.includes('--trust-local-plugin')) {
  const bundle = resolve(pluginRoot, '../../napcat.mjs'), source = await readFile(bundle, 'utf8');
  trustPatch = { bundle, source, updated: trustSlyraPlugin(source) };
}
for (const pluginId of ['napcat-plugin-slyra', 'napcat-plugin-slyra-monitor']) {
  const target = resolve(pluginRoot, '..', pluginId), monitor = pluginId.endsWith('-monitor');
  await mkdir(join(target, 'webui'), { recursive: true });
  for (const name of ['index.mjs', 'bridge.mjs', 'engine.mjs']) await copyFile(join(projectRoot, 'napcat-plugin', name), join(target, name));
  const manifest = JSON.parse(await readFile(join(projectRoot, 'napcat-plugin/package.json'), 'utf8'));
  manifest.name = pluginId;
  if (monitor) { manifest.plugin = '群通知整理'; manifest.description = '只读整理历史消息、重要通知与私聊汇报'; }
  await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const name of ['app.js', 'style.css', 'napcat.css']) await copyFile(join(projectRoot, 'web', name), join(target, 'webui', name));
  const base = '/plugin/' + pluginId + '/files/ui/';
  const html = (await readFile(join(projectRoot, 'web', 'index.html'), 'utf8')).replace('<body>', `<body data-napcat="true" data-plugin="${pluginId}">`)
    .replace('href="/style.css"', `href="${base}style.css"`).replace('src="/app.js"', `src="${base}app.js"`)
    .replace('</head>', `<link rel="stylesheet" href="${base}napcat.css"></head>`);
  await writeFile(join(target, 'webui/index.html'), html);
  await writeFile(join(target, 'deployment.json'), JSON.stringify({ projectRoot, pluginId, nodeBinary: process.execPath }), { mode: 0o600 });
}
await mkdir(join(projectRoot, 'data'), { recursive: true });
await writeFile(join(projectRoot, 'data/napcat-ui.json'), JSON.stringify({ origin: 'http://127.0.0.1:6099' }), { mode: 0o600 });
if (trustPatch) {
  if (trustPatch.updated !== trustPatch.source) {
    try { await copyFile(trustPatch.bundle, join(projectRoot, 'data/napcat.before-slyra-trust.mjs'), constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await writeFile(trustPatch.bundle, trustPatch.updated);
    console.log('已为 slyra 设置与群通知整理两个插件添加精确信任项，保留其他插件限制与敏感词检查。');
  }
}
console.log('已安装 slyra 设置、群通知整理两个 NapCat 插件；启用后从扩展页面打开。');
