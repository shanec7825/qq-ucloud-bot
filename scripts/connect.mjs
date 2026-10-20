import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const service = process.argv[2];
await mkdir(new URL('data/', root), { recursive: true });
let binary, args, extraEnv = {};
if (service === 'github') {
  binary = fileURLToPath(new URL('tools/gh/bin/gh.exe', root));
  args = ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https', '--skip-ssh-key'];
  extraEnv.GH_CONFIG_DIR = fileURLToPath(new URL('data/gh/', root));
  console.log('请在浏览器完成 GitHub 授权；机器人只通过 GET API 读取项目。');
} else if (service === 'drive') {
  binary = fileURLToPath(new URL('tools/rclone/rclone.exe', root));
  args = ['--config', fileURLToPath(new URL('data/rclone.conf', root)), 'config', 'create', 'privateDrive', 'drive', 'scope', 'drive.readonly', '--interactive'];
  console.log('连接 Google Drive，仅请求只读权限。若共享客户端不可用，按 rclone 官方说明创建个人 OAuth client_id。');
} else throw new Error('支持 github 或 drive。');
// rclone config create 在 stdout 输出配置及 token，因此不转发其 stdout。
const child = spawn(binary, args, { stdio: service === 'drive' ? ['inherit', 'ignore', 'inherit'] : 'inherit', windowsHide: true, shell: false, env: { ...process.env, ...extraEnv } });
child.on('error', () => { console.error('缺少连接工具，请先 npm run setup:tools。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
