import { readFile, writeFile, mkdir, readdir, lstat, copyFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), versions = JSON.parse(await readFile(join(root, 'desktop/versions.json'), 'utf8'));
const output = join(root, 'release', pkg.version), app = join(output, 'win-x64'), sdk = join(root, 'tools/desktop/webview2');
await mkdir(join(app, 'runtime'), { recursive: true }); await mkdir(join(app, 'assets'), { recursive: true }); await mkdir(join(app, 'docs'), { recursive: true });
const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d'); ctx.fillStyle = '#2457d6'; ctx.beginPath(); ctx.roundRect(8, 8, 240, 240, 56); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 176px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Q', 128, 132);
const png = canvas.toBuffer('image/png'), icon = Buffer.alloc(22); icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4); icon[8] = 0; icon.writeUInt16LE(1, 10); icon.writeUInt16LE(32, 12); icon.writeUInt32LE(png.length, 14); icon.writeUInt32LE(22, 18); await writeFile(join(app, 'app.ico'), Buffer.concat([icon, png]));
for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll']) await copyFile(join(sdk, 'lib/net462', name), join(app, name));
await copyFile(join(sdk, 'runtimes/win-x64/native/WebView2Loader.dll'), join(app, 'WebView2Loader.dll'));
await copyFile(join(root, 'desktop/QQAgent.exe.config'), join(app, 'QQAgent.exe.config'));
await copyFile(join(root, 'desktop/assets/home.html'), join(app, 'assets/home.html'));
const nodeFolder = join(root, 'tools/desktop/node/node-' + versions.node + '-win-x64');
await copyFile(join(nodeFolder, 'node.exe'), join(app, 'runtime/node.exe')); await copyFile(join(nodeFolder, 'LICENSE'), join(app, 'runtime/LICENSE-Node.txt'));
for (const name of ['README.md', 'README.Windows.md', 'THIRD_PARTY.md']) await copyFile(join(root, name), join(app, name));
await copyFile(join(root, 'docs/CONFIGURATION.md'), join(app, 'docs/CONFIGURATION.md'));
await copyFile(join(root, 'docs/PLUGIN-DISTRIBUTION.md'), join(app, 'docs/PLUGIN-DISTRIBUTION.md'));
await copyFile(join(root, 'docs/WORKSPACE-ARCHITECTURE.md'), join(app, 'docs/WORKSPACE-ARCHITECTURE.md'));
await copyFile(join(root, 'docs/NAPCAT-NATIVE-UI.md'), join(app, 'docs/NAPCAT-NATIVE-UI.md'));
for (const name of ['ACCOUNT-PERSONAS.md', 'GROUP-NOTICES.md']) await copyFile(join(root, 'docs', name), join(app, 'docs', name));
await mkdir(join(app, 'docs/releases'), { recursive: true });
await copyFile(join(root, 'docs/releases/v' + pkg.version + '.md'), join(app, 'docs/releases/v' + pkg.version + '.md'));
try { await copyFile(join(sdk, 'LICENSE.txt'), join(app, 'LICENSE-WebView2.txt')); } catch { throw new Error('WebView2 license missing'); }
await copyFile(join(sdk, 'NOTICE.txt'), join(app, 'NOTICE-WebView2.txt'));
const compiler = join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'); await access(compiler);
const references = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', join(app, 'Microsoft.Web.WebView2.Core.dll'), join(app, 'Microsoft.Web.WebView2.WinForms.dll')];
const result = await exec(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', '/out:' + join(app, 'QQAgent.exe'), '/win32icon:' + join(app, 'app.ico'), '/win32manifest:' + join(root, 'desktop/app.manifest'), ...references.map(path => '/reference:' + path), join(root, 'desktop/QQAgent.cs')], { windowsHide: true, maxBuffer: 1000000 });
if (result.stdout.trim()) console.log(result.stdout.trim());
console.log('桌面程序已编译，正在生成无个人配置的后端资源包…');
const files = {}, excludedFolders = new Set(['.git', '.bin', '.cache', 'test', 'tests', '__tests__', 'examples', 'docs', 'playwright', 'playwright-core']);
async function collect(path, prefix) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.env') || entry.name.endsWith('.log')) continue;
    const source = join(path, entry.name), relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('发行资源不允许链接：' + relative);
    if (entry.isDirectory()) { if (!excludedFolders.has(entry.name)) await collect(source, relative + '/'); }
    else if (entry.isFile()) files[relative] = new Uint8Array(await readFile(source));
  }
}
for (const folder of ['src', 'scripts', 'napcat-plugin', 'public', 'licenses', 'node_modules']) await collect(join(root, folder), folder + '/');
for (const file of ['package.json', 'package-lock.json', 'desktop/versions.json']) files[file] = new Uint8Array(await readFile(join(root, file)));
const paths = Object.keys(files);
if (paths.some(path => /(?:^|\/)(?:data|tools|\.git|\.env[^/]*)\//.test(path) || path.startsWith('data/') || path.startsWith('tools/'))) throw new Error('发行包混入个人目录。');
await writeFile(join(app, 'backend.zip'), zipSync(files, { level: 6 }));
await writeFile(join(output, 'payload-manifest.json'), JSON.stringify({ version: pkg.version, files: paths, excludes: ['.env', 'data/', 'tools/', 'tests/', 'private credentials'], node: versions.node, webview2: versions.webview2 }, null, 2));
const portable = {};
async function packPortable(folder, prefix = '') { for (const entry of await readdir(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) await packPortable(path, prefix + entry.name + '/'); else portable['QQ-Agent/' + prefix + entry.name] = new Uint8Array(await readFile(path)); } }
await packPortable(app); const portableName = 'QQ-Agent-' + pkg.version + '-win-x64.zip'; await writeFile(join(output, portableName), zipSync(portable, { level: 6 }));
if (!process.argv.includes('--no-installer')) {
  const result = await exec(join(root, 'tools/desktop/inno/ISCC.exe'), ['/Qp', '/DAppVersion=' + pkg.version, '/DAppFiles=' + app, '/DOutputDirectory=' + output, join(root, 'desktop/installer.iss')], { windowsHide: true, timeout: 300000, maxBuffer: 1000000 }); if (result.stdout.trim()) console.log(result.stdout.trim());
}
const artifacts = (await readdir(output)).filter(name => name.endsWith('.zip') || name.endsWith('.exe'));
const sums = [];
for (const name of artifacts) { const bytes = await readFile(join(output, name)); sums.push(createHash('sha256').update(bytes).digest('hex') + '  ' + name); console.log(name + ' · ' + Math.round(bytes.length / 1024 / 1024) + ' MB'); }
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log('发行目录：' + output);
