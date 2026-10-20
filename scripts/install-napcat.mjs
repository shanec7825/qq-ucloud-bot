import { mkdir, readFile, writeFile, copyFile, realpath, rename } from 'node:fs/promises';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { trustAgentPlugins } from '../napcat-plugin/local-trust.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const pluginRoot = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || join(projectRoot, 'tools/napcat/napcat/plugins/napcat-plugin-qq-agent'));
if (!['napcat-plugin-qq-agent', 'napcat-plugin-slyra'].includes(basename(pluginRoot))) throw new Error('目标目录必须为 napcat-plugin-qq-agent。');
const pluginsRoot = dirname(pluginRoot); let trustPatch;
if (process.argv.includes('--trust-local-plugin')) {
  const bundle = resolve(pluginsRoot, '../napcat.mjs'), source = await readFile(bundle, 'utf8');
  trustPatch = { bundle, source, updated: trustAgentPlugins(source) };
}
await mkdir(join(projectRoot, 'data/plugin-backups'), { recursive: true });
for (const id of ['napcat-plugin-slyra', 'napcat-plugin-slyra-monitor']) {
  const old = join(pluginsRoot, id); let actual;
  try { actual = await realpath(old); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const parent = await realpath(pluginsRoot), backupRoot = await realpath(join(projectRoot, 'data/plugin-backups'));
  if (actual !== join(parent, id)) throw new Error('旧插件路径包含目录重定向，未移动。');
  const backup = resolve(backupRoot, id + '-' + Date.now());
  if (!backup.startsWith(backupRoot + sep)) throw new Error('备份路径无效。');
  await rename(actual, backup);
}
const template = JSON.parse(await readFile(join(projectRoot, 'napcat-plugin/package.json'), 'utf8'));
for (const plugin of PLUGIN_MODULES) {
  const target = join(pluginsRoot, plugin.id); await mkdir(join(target, 'webui'), { recursive: true });
  for (const name of ['index.mjs', 'bridge.mjs', 'engine.mjs', 'catalog.mjs']) await copyFile(join(projectRoot, 'napcat-plugin', name), join(target, name));
  await writeFile(join(target, 'package.json'), JSON.stringify({ ...template, name: plugin.id, plugin: plugin.name, description: plugin.description }, null, 2));
  for (const name of ['app.js', 'style.css', 'napcat.css']) await copyFile(join(projectRoot, 'web', name), join(target, 'webui', name));
  const base = '/plugin/' + plugin.id + '/files/ui/';
  const html = (await readFile(join(projectRoot, 'web/index.html'), 'utf8')).replace('<body>', `<body data-napcat="true" data-plugin="${plugin.id}" data-module="${plugin.module}">`)
    .replace('href="/style.css"', `href="${base}style.css"`).replace('src="/app.js"', `src="${base}app.js"`)
    .replace('</head>', `<link rel="stylesheet" href="${base}napcat.css"></head>`);
  await writeFile(join(target, 'webui/index.html'), html);
  await writeFile(join(target, 'deployment.json'), JSON.stringify({ projectRoot, pluginId: plugin.id, nodeBinary: process.execPath }), { mode: 0o600 });
}
await writeFile(join(projectRoot, 'data/napcat-ui.json'), JSON.stringify({ origin: 'http://127.0.0.1:6099', managedModules: true }), { mode: 0o600 });
if (trustPatch && trustPatch.updated !== trustPatch.source) {
  try { await copyFile(trustPatch.bundle, join(projectRoot, 'data/napcat.before-slyra-trust.mjs'), constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await writeFile(trustPatch.bundle, trustPatch.updated);
}
console.log('已安装机器人核心、GitHub、Google Drive、UCloud、群通知整理；从各插件卡片打开配置。旧入口已备份，本机配置保留。');
