import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const root = new URL('../data/', import.meta.url);
try {
  const { origin } = JSON.parse(await readFile(new URL('admin-info.json', root), 'utf8'));
  const key = (await readFile(new URL('admin-access.key', root), 'utf8')).trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !/^[\w-]{43}$/.test(key)) throw new Error();
  const url = origin + '/#key=' + key;
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { windowsHide: true, shell: false, stdio: 'ignore' });
  child.on('error', () => { console.error('无法打开浏览器，请手动打开 data/admin-launch.html。'); process.exitCode = 1; });
  console.log('已请求在默认浏览器打开本机管理台。请保持 npm start 运行。');
} catch { console.error('请先运行 npm start，再运行 npm run admin:open。'); process.exitCode = 1; }
