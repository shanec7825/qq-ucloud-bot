import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { AdminBridge, registerBridge } from './bridge.mjs';
import { ensureEngine } from './engine.mjs';
import { PLUGIN_MODULES, nativeConfigSchema } from './catalog.mjs';
import { createNativeConfigAdapter } from './native-config.mjs';

export let plugin_config_ui = [];
let deployment;
let native;
async function activity(active) {
  if (!deployment) return;
  const directory = join(deployment.projectRoot, 'data', 'napcat-modules'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, deployment.module + '.json'), JSON.stringify({ active }), { mode: 0o600 });
}
export function plugin_get_config(ctx) { return native.getConfig(); }
export function plugin_set_config(ctx, config) { return native.setConfig(config); }
export function plugin_config_controller(ctx, ui, initialConfig) { return native.controller(ui, initialConfig); }
export function plugin_on_config_change(ctx, ui, key, value, currentConfig) { return native.onConfigChange(ui, key, value, currentConfig); }
export async function plugin_cleanup() { await activity(false); }

export async function plugin_init(ctx) {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  const descriptor = JSON.parse(await readFile(join(folder, 'deployment.json'), 'utf8'));
  const pluginId = descriptor.pluginId;
  let { projectRoot, nodeBinary } = descriptor;
  if (descriptor.distribution === 1) {
    const shared = await import(pathToFileURL(join(dirname(folder), 'napcat-plugin-qq-agent/bootstrap.mjs')).href + new URL(import.meta.url).search);
    ({ projectRoot, nodeBinary } = await shared.preparePortable(folder));
  }
  const module = PLUGIN_MODULES.find(item => item.id === pluginId)?.module;
  if (!module) throw new Error('Unknown QQ Agent module');
  deployment = { projectRoot, module }; plugin_config_ui = nativeConfigSchema(pluginId);
  if (typeof projectRoot !== 'string') throw new Error('Missing QQ Agent project directory');
  try { await ensureEngine(projectRoot, nodeBinary); }
  catch { ctx.logger?.error?.('slyra 后台尚未就绪，请检查项目 data/napcat-engine.log 或运行 npm start。'); }
  const bridge = new AdminBridge(projectRoot);
  native = createNativeConfigAdapter({ module, bridge });
  registerBridge(ctx, bridge, native);
  ctx.router.static('/ui', 'webui');
  const pageTitles = { core:'chat', speech:'语音', github:'GitHub', drive:'云盘', ucloud:'ucloud', notices:'To Do' };
  ctx.router.page({ title: pageTitles[module], path: 'settings', htmlFile: 'webui/index.html', description: '插件设置' });

  await activity(true);
  ctx.logger?.info?.('模块配置已接入 NapCat 插件卡片。');
}
