import { formatTasks, readJSON } from './core.mjs';
import { SettingsStore } from './settings.mjs';
import { SecretVault } from './secret-vault.mjs';
import { BotRuntime } from './runtime.mjs';
import { startAdmin } from './admin-server.mjs';

async function main() {
  if (process.argv.includes('--demo')) {
    console.log(formatTasks([{ id: '1234567890123456789', title: '示例作业（模拟数据）', course: '计算机网络', type: 3, deadline: '2026-10-20 23:59:00' }])); return;
  }
  const store = new SettingsStore(); await store.load();
  const vault = new SecretVault(); await vault.load();
  const runtime = new BotRuntime(store, vault);
  if (process.argv.includes('--check')) { await runtime.sync(); console.log(await runtime.catalog.list()); return; }
  if (process.argv.includes('--ai-check')) { console.log(await runtime.ai('仅回复：连接成功', {})); return; }
  const port = Number(process.env.ADMIN_PORT || 6100);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ADMIN_PORT 必须为 1024–65535。');
  const admin = await startAdmin({ store, vault, runtime, port });
  try { await runtime.start(); } catch (error) { await admin.close(); throw error; }
  let stopped = false;
  const stop = async () => { if (stopped) return; stopped = true; runtime.stop(); await admin.close(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  const settings = store.get();
  console.log(`${settings.bot.name} 已启动；群里必须 @，模型：${settings.ai.backend === 'codex' ? settings.ai.model : settings.ai.apiModel || '待配置'}。`);
  const ui = await readJSON(new URL('../data/napcat-ui.json', import.meta.url), null);
  console.log(`配置入口：${ui?.origin ? ui.origin + '/webui/plugins' : admin.origin}；运行 npm run admin:open 打开。`);
}
main().catch(error => { console.error(error.code === 'EADDRINUSE' ? '管理台端口已占用，请检查已有进程或修改 ADMIN_PORT。' : error instanceof TypeError ? '网络或配置初始化失败，请检查连接。' : error.message); process.exitCode = 1; });
