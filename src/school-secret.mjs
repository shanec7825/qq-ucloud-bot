import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function transform(mode, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../scripts/school-secret.ps1', import.meta.url)), '-Mode', mode], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('本机学校会话加密超时')); }, 10000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) child.kill(); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('本机学校会话加密不可用')); });
    child.on('close', code => { clearTimeout(timer); code === 0 && output && output.length <= 65536 ? resolve(output) : reject(new Error('本机学校会话加密失败')); });
    child.stdin.end(value);
  });
}
export const protectSchoolSecret = value => transform('protect', value);
export const unprotectSchoolSecret = value => transform('unprotect', value);
