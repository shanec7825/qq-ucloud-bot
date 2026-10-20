import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const root = new URL('../data/', import.meta.url);
try {
  if (!process.argv.includes('--standalone')) {
    try {
      const ui = JSON.parse(await readFile(new URL('napcat-ui.json', root), 'utf8'));
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(ui.origin)) {
        const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', ui.origin + '/webui/plugins']] : process.platform === 'darwin' ? ['open', [ui.origin + '/webui/plugins']] : ['xdg-open', [ui.origin + '/webui/plugins']];
        const child = spawn(command[0], command[1], { windowsHide: true, shell: false, stdio: 'ignore' });
        child.on('error', () => { console.error('请在浏览器打开 NapCat 插件管理。'); process.exitCode = 1; });
        console.log('已请求打开 NapCat → 插件管理 → 插件配置。');
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        process.exit(0);
      }
    } catch {}
  }
  const { origin } = JSON.parse(await readFile(new URL('admin-info.json', root), 'utf8'));
  const key = (await readFile(new URL('admin-access.key', root), 'utf8')).trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !/^[\w-]{43}$/.test(key)) throw new Error();
  const url = origin + '/#key=' + key;
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { windowsHide: true, shell: false, stdio: 'ignore' });
  child.on('error', () => { console.error('无法打开浏览器，请手动打开 data/admin-launch.html。'); process.exitCode = 1; });
  console.log('已请求在默认浏览器打开本机管理台。请保持 npm start 运行。');
} catch { console.error('请先运行 npm start，再运行 npm run admin:open。'); process.exitCode = 1; }
