import { validateWorkspace, loadDesktopEnvironment, DesktopService } from '../src/desktop-service.mjs';
const actions = new Set(['status', 'install', 'start', 'session', 'switch-account', 'stop-bot', 'stop-conflict', 'trim-ports']);
const progress = payload => { try { process.stderr.write('PROGRESS ' + JSON.stringify(payload) + '\n'); } catch { /* stderr 不可用时忽略，进度只做展示。 */ } };
try {
  const [action, workspace] = process.argv.slice(2); if (!actions.has(action)) throw new Error('未知桌面操作。');
  const root = await validateWorkspace(workspace); await loadDesktopEnvironment(root); const service = new DesktopService(root, { progress });
  let result;
  if (action === 'session') result = { credential: await service.session() };
  else result = await service[{ 'switch-account': 'switchAccount', 'stop-bot': 'stopBot', 'stop-conflict': 'stopConflict', 'trim-ports': 'trimPorts' }[action] || action]();
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof TypeError ? '网络或本机组件连接未完成，请检查后台与网络。' : error.message })); process.exitCode = 1; }
