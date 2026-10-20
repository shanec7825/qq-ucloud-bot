import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile), root = new URL('../', import.meta.url), tools = new URL('tools/desktop/', root);
const versions = JSON.parse(await readFile(new URL('desktop/versions.json', root), 'utf8'));
await mkdir(tools, { recursive: true });
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('官方构建依赖下载失败 HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
const quote = text => "'" + text.replaceAll("'", "''") + "'";
async function expand(file, folder) { await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(fileURLToPath(file))} -DestinationPath ${quote(fileURLToPath(folder))} -Force`], { windowsHide: true, timeout: 120000 }); }
const sdk = new URL('webview2/', tools);
try { await access(new URL('lib/net462/Microsoft.Web.WebView2.Core.dll', sdk)); }
catch {
  const base = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/' + versions.webview2 + '/microsoft.web.webview2.' + versions.webview2 + '.nupkg';
  const bytes = await download(base);
  if (createHash('sha512').update(bytes).digest('base64') !== versions.webview2Sha512) throw new Error('WebView2 SHA512 校验失败。');
  const zip = new URL('webview2.zip', tools); await writeFile(zip, bytes); await expand(zip, sdk);
}
const nodeFolder = new URL('node/', tools);
try { await access(new URL('node-' + versions.node + '-win-x64/node.exe', nodeFolder)); }
catch {
  const filename = 'node-' + versions.node + '-win-x64.zip', base = 'https://nodejs.org/dist/' + versions.node + '/';
  const [bytes, checksums] = await Promise.all([download(base + filename), download(base + 'SHASUMS256.txt')]);
  const expected = checksums.toString().split('\n').find(line => line.endsWith('  ' + filename))?.split(/\s+/)[0];
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node SHA256 校验失败。');
  const zip = new URL('node.zip', tools); await writeFile(zip, bytes); await expand(zip, nodeFolder);
}
const compiler = new URL('inno/ISCC.exe', tools);
try { await access(compiler); }
catch {
  const bytes = await download(versions.innoURL);
  if (createHash('sha256').update(bytes).digest('hex') !== versions.innoSha256) throw new Error('Inno Setup SHA256 校验失败。');
  const setup = new URL('inno-setup.exe', tools); await writeFile(setup, bytes);
  await exec(fileURLToPath(setup), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/DIR=' + fileURLToPath(new URL('inno/', tools))], { windowsHide: true, timeout: 120000 });
}
console.log('WebView2、Node 和安装包编译器已从官方源准备并校验。');
