import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AdminBridge, registerBridge } from './bridge.mjs';
import { ensureEngine } from './engine.mjs';

export async function plugin_init(ctx) {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  const { projectRoot, pluginId, nodeBinary } = JSON.parse(await readFile(join(folder, 'deployment.json'), 'utf8'));
  if (typeof projectRoot !== 'string') throw new Error('Missing slyra project directory');
  try { await ensureEngine(projectRoot, nodeBinary); }
  catch { ctx.logger?.error?.('slyra 后台尚未就绪，请检查项目 data/napcat-engine.log 或运行 npm start。'); }
  registerBridge(ctx, new AdminBridge(projectRoot));
  ctx.router.static('/ui', 'webui');
  const monitor = pluginId === 'napcat-plugin-slyra-monitor';
  ctx.router.page({ path: 'settings', title: monitor ? '群通知整理' : 'slyra 设置', htmlFile: 'webui/index.html', description: monitor ? '只读监测、重要信息与私聊汇报' : '模型、连接、群组与记忆' });
  ctx.logger?.info?.('slyra 配置页面已接入 NapCat。');
}
