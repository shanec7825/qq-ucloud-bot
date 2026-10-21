import { readFile, writeFile, mkdir, access, open, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { SettingsStore } from './settings.mjs';
import { SecretVault } from './secret-vault.mjs';
import { AdminBridge } from '../napcat-plugin/bridge.mjs';
import { ensureEngine } from '../napcat-plugin/engine.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
import { protectSchoolSecret, unprotectSchoolSecret } from './school-secret.mjs';

const exec = promisify(execFile), origin = 'http://127.0.0.1:6099';
async function runtimeOwner() {
  if (process.platform !== 'win32') return null;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 6099); $owners=@($listeners | ForEach-Object { $p=Get-Process -Id $_.OwningProcess; if(!$p.Path){throw 'Cannot identify listener'}; $p.Path } | Select-Object -Unique); ConvertTo-Json -InputObject $owners -Compress"], { windowsHide: true, timeout: 12000 });
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}
export function validateWorkspacePath(value) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) throw new Error('项目目录无效。');
  return resolve(value);
}
export async function validateWorkspace(value) {
  const root = validateWorkspacePath(value), pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'bupt-qq-homework-bot' || pkg.type !== 'module') throw new Error('请选择 QQ Agent 项目目录。');
  await access(join(root, 'src/main.mjs')); return root;
}
export function quickLoginConfig(config, switching) { return switching ? { ...config, autoLoginAccount: '' } : { ...config }; }
export function mergeOneBot(config, token) {
  const value = structuredClone(config || {}); value.network ||= {};
  for (const name of ['httpServers', 'httpSseServers', 'httpClients', 'websocketClients']) value.network[name] ||= [];
  const servers = value.network.websocketServers ||= [], existing = servers.find(item => Number(item.port) === 3001);
  const server = { ...(existing || {}), name: existing?.name || 'qq-agent', enable: true, host: '127.0.0.1', port: 3001, messagePostFormat: 'array', reportSelfMessage: false, token, enableForcePushEvent: true, heartInterval: 30000 };
  if (existing) servers[servers.indexOf(existing)] = server; else servers.push(server);
  return value;
}
async function json(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (fallback !== undefined && error.code === 'ENOENT') return fallback; throw error; } }
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const writeJSON = (file, value) => writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
function childEnv() { return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/TOKEN|SECRET|PASSWORD|API_KEY|OPENAI_(?:BASE|IDENTITY|FEDERATION)/i.test(name))); }

export class DesktopService {
  constructor(root, { fetcher = fetch, sessionCodec = { protect: protectSchoolSecret, unprotect: unprotectSchoolSecret }, ownerReader = runtimeOwner } = {}) { this.root = root; this.fetch = fetcher; this.sessionCodec = sessionCodec; this.ownerReader = ownerReader; this.webui = join(root, 'tools/napcat/napcat/config/webui.json'); }
  async assertRuntimeWorkspace() {
    const owners = await this.ownerReader();
    const expected = resolve(this.root, 'tools/napcat/node.exe').toLowerCase();
    if (owners && owners.some(path => resolve(path).toLowerCase() !== expected)) {
      const error = new Error('6099 端口由其他工作区占用，请先退出该 NapCat 后台，再启动当前项目。');
      error.code = 'WORKSPACE_MISMATCH'; throw error;
    }
  }
  async native(path, body, credential) {
    const response = await this.fetch(origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(credential ? { authorization: 'Bearer ' + credential } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(12000) });
    const value = await response.json(); if (!response.ok || value.code !== 0) throw new Error('NapCat 操作未完成：' + path); return value.data;
  }
  async session() {
    await this.assertRuntimeWorkspace();
    const config = await json(this.webui), hash = createHash('sha256').update(config.token + '.napcat').digest('hex');
    const file = join(this.root, 'data/desktop-session.enc.json');
    try {
      const saved = await json(file), cache = JSON.parse(await this.sessionCodec.unprotect(saved.ciphertext));
      if (cache.hash === hash && cache.expires > Date.now() && typeof cache.credential === 'string') {
        await this.native('auth/check', {}, cache.credential); return cache.credential;
      }
    } catch { /* Missing, expired or revoked local sessions require one fresh login. */ }
    const result = await this.native('auth/login', { hash });
    if (typeof result.Credential !== 'string') throw new Error('NapCat 登录响应无效。');
    const ciphertext = await this.sessionCodec.protect(JSON.stringify({ hash, credential: result.Credential, expires: Date.now() + 50 * 60000 }));
    await mkdir(join(this.root, 'data'), { recursive: true }); await writeJSON(file, { ciphertext }); return result.Credential;
  }
  async status() {
    const state = { workspace: this.root, napcatInstalled: await exists(join(this.root, 'tools/napcat/node.exe')), webuiAvailable: false, qqLoggedIn: false, botConnected: false };
    try {
      const credential = await this.session(), qq = await this.native('QQLogin/CheckLoginStatus', {}, credential);
      state.webuiAvailable = true; state.qqLoggedIn = !!qq.isLogin; state.loginPhase = qq.loginPhase || '';
    } catch (error) { if (error.code === 'WORKSPACE_MISMATCH') { state.workspaceError = error.message; } /* A stopped service is a normal launcher state. */ }
    try { const response = await new AdminBridge(this.root).request('GET', 'state'); if (response.status === 200) { state.botConnected = response.data.status.qq.connected; state.botName = response.data.settings.bot.name; state.model = response.data.settings.ai.backend === 'codex' ? response.data.settings.ai.model : response.data.settings.ai.apiModel; } } catch {}
    return state;
  }
  async detached(binary, args, name, env = childEnv()) {
    await mkdir(join(this.root, 'data'), { recursive: true }); const log = await open(join(this.root, 'data', name + '.log'), 'a', 0o600);
    try { const child = spawn(binary, args, { cwd: this.root, env, windowsHide: true, detached: true, shell: false, stdio: ['ignore', log.fd, log.fd] }); await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref(); }
    finally { await log.close(); }
  }
  async download(url, digest, folder) {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(300000) }); if (!response.ok) throw new Error('官方运行组件下载失败 HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer()); if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('运行组件校验失败，未安装。');
    const archive = join(this.root, 'tools', 'desktop-' + folder + '.zip'), target = join(this.root, 'tools', folder); await writeFile(archive, bytes); await mkdir(target, { recursive: true });
    const q = text => "'" + text.replaceAll("'", "''") + "'";
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(target)} -Force`], { windowsHide: true, timeout: 120000 });
  }
  async install() {
    await mkdir(join(this.root, 'tools'), { recursive: true }); const versions = await json(join(this.root, 'desktop/versions.json'));
    if (!await exists(join(this.root, 'tools/napcat/node.exe'))) { console.error('正在下载并校验 NapCat 运行组件…'); await this.download(`https://github.com/NapNeko/NapCatQQ/releases/download/${versions.napcat}/${versions.napcatAsset}`, versions.napcatSha256, 'napcat'); }
    const localCodex = join(this.root, 'tools/codex/codex-x86_64-pc-windows-msvc.exe');
    if (!process.env.CODEX_BIN || process.env.CODEX_BIN === 'codex') {
      if (!await exists(localCodex)) { console.error('正在下载并校验可选的 ChatGPT / Codex 登录组件…'); await this.download(versions.codexURL, versions.codexSha256, 'codex'); }
      if (!await exists(localCodex)) throw new Error('Codex 运行组件未找到，请检查官方发行包。');
    }
    await this.configure();
    return { installed: true };
  }
  async configure() {
    await this.assertRuntimeWorkspace();
    const folder = join(this.root, 'tools/napcat/napcat/config'); await mkdir(folder, { recursive: true }); await mkdir(join(this.root, 'data'), { recursive: true });
    const dataRoot = pathToFileURL(join(this.root, 'data') + sep), store = new SettingsStore(new URL('settings.json', dataRoot)), vault = new SecretVault(dataRoot); await store.load(); await vault.load();
    let token = vault.get('onebotToken'); if (!token) { token = randomBytes(32).toString('base64url'); await vault.set({ onebotToken: token }); }
    const webui = await json(this.webui, {}); if (!webui.token) webui.token = randomBytes(24).toString('base64url'); webui.host = '127.0.0.1'; webui.port = 6099; await writeJSON(this.webui, webui);
    const configs = ['onebot11.json', ...(await readdir(folder)).filter(name => /^onebot11_\d+\.json$/.test(name))];
    for (const name of configs) { const file = join(folder, name); await writeJSON(file, mergeOneBot(await json(file, {}), token)); }
    const next = store.get(); if (next.qq.url !== 'ws://127.0.0.1:3001') throw new Error('现有 OneBot 地址不是默认端口，请先在机器人设置中确认，桌面端不会覆盖。');
    await exec(process.execPath, [join(this.root, 'scripts/install-napcat.mjs'), '--trust-local-plugin'], { cwd: this.root, windowsHide: true, timeout: 30000 });
  }
  async ready() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) { try { return await this.session(); } catch { await delay(500); } }
    throw new Error('NapCat 启动未完成，请查看项目 data/desktop-napcat.log；不要重复打开多个后台。');
  }
  async waitForPlugins(credential, { timeoutMs = 45000, pollMs = 750 } = {}) {
    const deadline = Date.now() + timeoutMs;
    do {
      const list = await this.native('Plugin/List', undefined, credential);
      if (PLUGIN_MODULES.every(plugin => list.plugins.some(row => row.id === plugin.id))) return list;
      await delay(pollMs);
    } while (Date.now() < deadline);
    throw new Error('插件加载超时，请查看 NapCat 日志；QQ 登录就绪后再启动机器人。');
  }
  async start() {
    await this.assertRuntimeWorkspace();
    let credential, fresh = false;
    try { credential = await this.session(); } catch {}
    if (!credential) {
      if (!await exists(join(this.root, 'tools/napcat/node.exe'))) throw new Error('请先点击“准备运行组件”。');
      await this.configure(); await this.detached(join(this.root, 'tools/napcat/node.exe'), [join(this.root, 'tools/napcat/index.js')], 'desktop-napcat'); credential = await this.ready(); fresh = true;
    }
    let list = fresh ? await this.waitForPlugins(credential) : await this.native('Plugin/List', undefined, credential);
    const expectedVersion = (await json(join(this.root, 'package.json'))).version;
    if (PLUGIN_MODULES.some(plugin => list.plugins.some(row => row.id === plugin.id && row.version !== expectedVersion))) {
      await this.configure(); await this.native('Process/Restart', {}, credential); await delay(1500); credential = await this.ready(); list = await this.waitForPlugins(credential);
      if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id && row.version === expectedVersion))) throw new Error('插件版本尚未更新，请查看 NapCat 日志。');
    }
    for (const plugin of PLUGIN_MODULES) if (!list.plugins.some(row => row.id === plugin.id)) {
      try { await this.native('Plugin/SetStatus', { id: plugin.id, enable: true }, credential); } catch {}
    }
    if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id))) {
      await this.configure(); await this.native('Process/Restart', {}, credential); await delay(1500); credential = await this.ready(); list = await this.waitForPlugins(credential);
      if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id))) throw new Error('插件尚未加载，请查看 NapCat 日志。');
    }
    await ensureEngine(this.root, process.execPath); return this.status();
  }
  async switchAccount() {
    const credential = await this.session(), before = await json(this.webui);
    await writeJSON(join(this.root, 'data', 'desktop-webui-before-switch.json'), before);
    await writeJSON(this.webui, quickLoginConfig(before, true));
    await this.native('Process/Restart', {}, credential); await delay(1500); await this.ready(); return { switched: true };
  }
  async stopBot() {
    const response = await new AdminBridge(this.root).request('POST', 'runtime/stop', {});
    if (response.status !== 200) throw new Error('停止机器人未完成。'); return { stopped: true };
  }
}

export async function loadDesktopEnvironment(root) {
  const file = join(root, '.env'); if (await exists(file)) process.loadEnvFile(file);
  if (!process.env.CODEX_BIN || process.env.CODEX_BIN === 'codex') {
    const binary = join(root, 'tools/codex/codex-x86_64-pc-windows-msvc.exe');
    if (await exists(binary)) process.env.CODEX_BIN = binary;
  }
}
