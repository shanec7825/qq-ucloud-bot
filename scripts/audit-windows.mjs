import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { SecretVault } from '../src/secret-vault.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const folder = join(root, 'release', pkg.version), backend = unzipSync(await readFile(join(folder, 'win-x64/backend.zip'))), paths = Object.keys(backend);
for (const path of paths.filter(path => /^(?:src|scripts|napcat-plugin)\//.test(path) || ['package.json', 'package-lock.json'].includes(path))) {
  if (!Buffer.from(backend[path]).equals(await readFile(join(root, path)))) throw new Error('发行后端与当前源码不一致：' + path);
}
for (const path of ['src/chat-abort.mjs', 'src/chat-stream.mjs', 'src/reply-preview.mjs']) if (!backend[path]) throw new Error('发行后端缺少消息优化模块：' + path);
if (paths.some(path => /^scripts\/apply-(?:message-flow|reply-protocol-fix)\.mjs$/.test(path))) throw new Error('发行后端包含仅限本机的补丁脚本。');
if (paths.some(path => path.startsWith('data/') || path.startsWith('tools/') || /(?:^|\/)\.env(?:\.|$)/.test(path))) throw new Error('发行包包含禁止发布的个人目录。');
const markers = new Set(); const collect = value => { if (typeof value === 'string' && value.length >= 12) markers.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
try {
  process.loadEnvFile(join(root, '.env')); const vault = new SecretVault(); await vault.load();
  for (const name of ['onebotToken', 'openaiKey', 'deepseekKey', 'mimoKey', 'githubToken', 'googleClientSecret', 'googleTokens']) collect(vault.get(name));
  for (const account of JSON.parse(await readFile(join(root, 'data/settings.json'), 'utf8')).accounts || []) if (account.id !== 'default') collect(vault.get('onebotToken:' + account.id));
} catch (error) { if (error.code !== 'ENOENT') throw new Error('无法完成本机授权指纹检查，未通过发行审核。'); }
for (const marker of markers) {
  const needle = Buffer.from(marker), wide = Buffer.from(marker, 'utf16le');
  for (const [path, bytes] of Object.entries(backend)) if (Buffer.from(bytes).includes(needle) || Buffer.from(bytes).includes(wide)) throw new Error('发行资源含本机凭据，拒绝发布：' + path);
}
const portableName = 'Qlyra-' + pkg.version + '-win-x64.zip', portable = unzipSync(await readFile(join(folder, portableName)));
if (!portable['Qlyra/Qlyra.exe'] || !portable['Qlyra/Qlyra.exe.config'] || !portable['Qlyra/QQAgent.exe'] || !portable['Qlyra/runtime/node.exe'] || !portable['Qlyra/WebView2Loader.dll'] || !portable['Qlyra/assets/qlyra.png']) throw new Error('便携包缺少 Qlyra 运行文件或兼容入口。');
const report = { passed: true, version: pkg.version, backendFiles: paths.length, backendMatchesSource: true, messageFlowIncluded: true, noDevelopmentPatchScripts: true, noPersonalDirectories: true, noLocalCredentialFingerprints: true, portableStructureValid: true, excluded: ['.env', 'data/', 'tools/', 'QQ cache', 'school sessions', 'cloud authorization'] };
await writeFile(join(folder, 'release-audit.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
