import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAppContext } from '../src/app-context.mjs';
const execute = promisify(execFile);
const root = new URL('../', import.meta.url);
const { settings, vault, runtime } = await loadAppContext();
console.log(`主人 QQ：${settings.bot.ownerQQ || '未配置'}；AI：${settings.ai.backend}；名字：${settings.bot.name}`);
for (const [label, path] of [['学校登录态', 'data/session.json'], ['NapCat', 'tools/napcat/.installed'], ['GitHub CLI', 'tools/gh/bin/gh.exe'], ['Google Drive 工具', 'tools/rclone/rclone.exe'], ['Google Drive 授权', 'data/rclone.conf']]) {
  try { await access(new URL(path, root)); console.log(`${label}：已准备（未验证服务端）`); }
  catch { console.log(`${label}：待准备`); }
}
try {
  const { stdout, stderr } = await execute(process.env.CODEX_BIN || 'codex', ['login', 'status'], { windowsHide: true, timeout: 15000 });
  console.log(`订阅登录：${/Logged in using ChatGPT/.test(stdout + stderr) ? '已用 ChatGPT 登录，待实际请求验证' : '未确认'}`);
} catch { console.log('订阅登录：待验证'); }
try {
  await execute(fileURLToPath(new URL('tools/gh/bin/gh.exe', root)), ['api', '--hostname', 'github.com', '--method', 'GET', '/user', '--jq', '.login'], { windowsHide: true, timeout: 15000, env: { ...runtime.env(), GH_CONFIG_DIR: fileURLToPath(new URL('data/gh', root)) } });
  console.log('GitHub 授权：可用');
} catch { console.log('GitHub 授权：待连接'); }
console.log(`OneBot token：${vault.flags().onebotToken ? '已配置' : '待配置'}；群白名单：${settings.groups.filter(g => g.enabled).map(g => g.id).join(',') || '空，暂不响应群消息'}`);
