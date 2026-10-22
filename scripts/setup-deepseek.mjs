import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '0.2.1-rc.2';
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('DeepSeek Harness 需要 Node.js 24 或更新版本。');
const npmPaths = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
try {
  const { stdout } = await promisify(execFile)(process.platform === 'win32' ? 'where.exe' : 'which', ['npm'], { windowsHide: true });
  for (const path of stdout.trim().split(/\r?\n/)) npmPaths.push(join(dirname(path), 'node_modules/npm/bin/npm-cli.js'), join(dirname(path), '../lib/node_modules/npm/bin/npm-cli.js'));
} catch { /* A runtime can still bundle npm beside Node. */ }
let npm;
for (const path of npmPaths) { try { await access(path); npm = path; break; } catch {} }
if (!npm) throw Error('未找到 npm。请安装带 npm 的 Node.js 24，再运行 npm run setup:deepseek。');
const target = join(root, 'tools/deepseek-harness');
await mkdir(target, { recursive: true });
await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'qq-agent-deepseek-runtime', private: true, dependencies: { '@deepseek-ai/dsh': version } }, null, 2));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)));
const { stdout } = await promisify(execFile)(process.execPath, [npm, 'install', '--prefix', target, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(root, 'data/npm-cache')], { env, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
console.log(stdout.trim());
console.log('DeepSeek Harness ' + version + ' 已准备：' + join(target, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
