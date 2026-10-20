import { validateWorkspace, loadDesktopEnvironment, DesktopService } from '../src/desktop-service.mjs';
const actions = new Set(['status', 'install', 'start', 'session', 'switch-account', 'stop-bot']);
try {
  const [action, workspace] = process.argv.slice(2); if (!actions.has(action)) throw new Error('未知桌面操作。');
  const root = await validateWorkspace(workspace); await loadDesktopEnvironment(root); const service = new DesktopService(root);
  let result;
  if (action === 'session') result = { credential: await service.session() };
  else result = await service[{ 'switch-account': 'switchAccount', 'stop-bot': 'stopBot' }[action] || action]();
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof TypeError ? '网络或本机组件连接未完成，请检查后台与网络。' : error.message })); process.exitCode = 1; }
