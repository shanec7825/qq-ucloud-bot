import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AdminBridge, registerBridge } from './bridge.mjs';
import { ensureEngine } from './engine.mjs';
import { PLUGIN_MODULES, nativeConfigSchema } from './catalog.mjs';

export let plugin_config_ui = [];
let deployment;
async function activity(active) {
  if (!deployment) return;
  const directory = join(deployment.projectRoot, 'data', 'napcat-modules'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, deployment.module + '.json'), JSON.stringify({ active }), { mode: 0o600 });
}
// The iframe saves through the authenticated bridge; the outer native dialog has no duplicate settings store.
export function plugin_get_config() { return {}; }
export function plugin_set_config() {}
export async function plugin_cleanup() { await activity(false); }

export async function plugin_init(ctx) {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  const { projectRoot, pluginId, nodeBinary } = JSON.parse(await readFile(join(folder, 'deployment.json'), 'utf8'));
  const module = PLUGIN_MODULES.find(item => item.id === pluginId)?.module;
  if (!module) throw new Error('Unknown QQ Agent module');
  deployment = { projectRoot, module }; plugin_config_ui = nativeConfigSchema(pluginId);
  if (typeof projectRoot !== 'string') throw new Error('Missing slyra project directory');
  try { await ensureEngine(projectRoot, nodeBinary); }
  catch { ctx.logger?.error?.('slyra 后台尚未就绪，请检查项目 data/napcat-engine.log 或运行 npm start。'); }
  registerBridge(ctx, new AdminBridge(projectRoot));
  ctx.router.static('/ui', 'webui');
  await activity(true);
  ctx.logger?.info?.('模块配置已接入 NapCat 插件卡片。');
}
