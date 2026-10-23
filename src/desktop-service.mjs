import { readFile, writeFile, mkdir, access, open, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { SettingsStore } from './settings.mjs';
import { SecretVault } from './secret-vault.mjs';
import { AdminBridge } from '../napcat-plugin/bridge.mjs';
import { ensureEngine } from '../napcat-plugin/engine.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
import { protectSchoolSecret, unprotectSchoolSecret } from './school-secret.mjs';
import { selectedModel, MIMO_TOKEN_PLAN_CN_BASE_URL } from './ai-providers.mjs';

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

const WEBVIEW2_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', WEBVIEW2_HELP = 'https://developer.microsoft.com/microsoft-edge/webview2/';
const SYSTEM_DEFS = [
  { id: 'os', label: '操作系统' },
  { id: 'dotnet', label: '.NET Framework 4.8' },
  { id: 'webview2', label: 'WebView2 运行时', help: WEBVIEW2_HELP },
  { id: 'node', label: 'Node 运行时' },
  { id: 'powershell', label: 'Windows PowerShell' },
];
const COMPONENT_DEFS = [
  { id: 'napcat', label: 'NapCat 运行组件' },
  { id: 'codex', label: 'ChatGPT / Codex 认证组件', optional: true },
  { id: 'mimo', label: '小米 MiMo / Token Plan 组件', optional: true },
];
const WATCHED_PORTS = [6099, 3001, 6100];
const PORT_DEFS = [{ port: 6099, label: 'NapCat 面板' }, { port: 3001, label: 'OneBot 连接' }, { port: 6100, label: '管理接口' }];
const INBOUND_SECTIONS = ['httpServers', 'httpSseServers', 'websocketServers'];
const clean = (value, fallback = '') => { const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return (text || fallback).slice(0, 200); };
async function runTool(command, args, timeoutMs) {
  try { const { stdout } = await exec(command, args, { windowsHide: true, timeout: timeoutMs }); return { ok: true, output: String(stdout) }; }
  catch (error) { return { ok: false, output: String(error?.stdout ?? '') }; }
}
async function regValue(key, name) {
  const result = await runTool('reg.exe', ['query', key, '/v', name], 5000); if (!result.ok) return null;
  const match = new RegExp('^\\s*' + name + '\\s+REG_\\w+\\s+(.+?)\\s*$', 'im').exec(result.output);
  return match ? match[1].trim() : null;
}
const regFirst = async (keys, name) => { for (const key of keys) { const value = await regValue(key, name); if (value) return value; } return null; };
async function checkOs() {
  const platform = process.platform, arch = os.arch(), release = os.release(), [major = 0, , build = 0] = release.split('.').map(Number);
  const ok = platform === 'win32' && arch === 'x64' && major >= 10;
  return { ok, detail: ok ? `${build >= 22000 ? 'Windows 11' : 'Windows 10'} ${release} ${arch}` : `需要 Windows 10/11 x64，当前为 ${platform}/${arch}。` };
}
async function checkDotnet() {
  const value = await regFirst(['HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full'], 'Release');
  if (!value) return { ok: false, detail: '未检测到 .NET Framework 4.8 的注册表 Release 值。' };
  const release = /^0x/i.test(value) ? parseInt(value, 16) : parseInt(value, 10), ok = Number.isFinite(release) && release >= 528040;
  return { ok, detail: ok ? `Release ${release}，满足 .NET Framework 4.8。` : `Release ${value} 低于 528040，需要 .NET Framework 4.8。` };
}
async function checkWebview2() {
  const value = await regFirst([`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`, `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`, `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`], 'pv');
  const ok = !!value && !/^0+(?:\.0+)*$/.test(value);
  return { ok, detail: ok ? `WebView2 Runtime ${value}。` : '未检测到 WebView2 Runtime。' };
}
async function checkNode() {
  const major = Number(process.versions.node.split('.')[0]), ok = Number.isFinite(major) && major >= 24;
  return { ok, detail: `Node ${process.version}（${process.execPath}）` };
}
async function checkPowershell() {
  const result = await runTool('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSVersionTable.PSVersion.ToString()'], 8000);
  const version = result.ok ? clean(result.output) : '';
  return { ok: !!version, detail: version ? `Windows PowerShell ${version}。` : 'Windows PowerShell 不可用。' };
}
export async function defaultSystemCheck() {
  const run = async (id, check) => { try { return { id, ...(await check()) }; } catch (error) { return { id, ok: false, detail: '检测失败：' + clean(error?.message) }; } };
  return Promise.all([run('os', checkOs), run('dotnet', checkDotnet), run('webview2', checkWebview2), run('node', checkNode), run('powershell', checkPowershell)]);
}
async function defaultExtract(archive, target) {
  const q = text => "'" + text.replaceAll("'", "''") + "'";
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(target)} -Force`], { windowsHide: true, timeout: 120000 });
}
function codexVersion(versions) {
  if (typeof versions?.codex === 'string' && versions.codex.trim()) return clean(versions.codex);
  const match = /releases\/download\/([^/]+)\//.exec(String(versions?.codexURL || ''));
  return match ? clean(match[1]) : '';
}
const normalizePath = value => { const text = String(value ?? '').trim(); if (!text) return ''; try { return resolve(text).toLowerCase(); } catch { return text.toLowerCase().replaceAll('/', '\\'); } };
const isNapcatPath = value => /\\tools\\napcat\\node\.exe$/i.test(normalizePath(value));
async function defaultListenerReader() {
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='SilentlyContinue'; $rows=@(Get-NetTCPConnection -State Listen | ForEach-Object { $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{ port=$_.LocalPort; pid=$_.OwningProcess; path=$(if($p -and $p.Path){[string]$p.Path}else{''}) } }); ConvertTo-Json -InputObject $rows -Compress"], { windowsHide: true, timeout: 8000 });
    const parsed = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim() || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({ port: Number(row?.port), pid: Number(row?.pid), path: String(row?.path ?? '') })).filter(row => Number.isFinite(row.port) && Number.isFinite(row.pid) && row.path);
  } catch { return []; }
}
async function defaultProcessKiller({ pid }) { await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }); }
async function defaultSecretReader(root) {
  const dataRoot = pathToFileURL(join(root, 'data') + sep), vault = new SecretVault(dataRoot);
  await vault.load(); return vault.get('mimoKey') || '';
}
function mimoKeyType(key) { return /^sk-/i.test(key) ? 'api' : /^t{1,2}p-/i.test(key) ? 'token-plan' : null; }

export class DesktopService {
  constructor(root, { fetcher = fetch, sessionCodec = { protect: protectSchoolSecret, unprotect: unprotectSchoolSecret }, ownerReader = runtimeOwner, systemReader = defaultSystemCheck, extractor = defaultExtract, listenerReader = defaultListenerReader, processKiller = defaultProcessKiller, secretReader = defaultSecretReader, progress = null } = {}) {
    this.root = root; this.fetch = fetcher; this.sessionCodec = sessionCodec; this.ownerReader = ownerReader; this.systemReader = systemReader; this.extractor = extractor;
    this.listenerReader = listenerReader; this.processKiller = processKiller; this.secretReader = secretReader;
    this.progress = typeof progress === 'function' ? progress : null; this.webui = join(root, 'tools/napcat/napcat/config/webui.json');
  }
  report(payload) { if (!this.progress) return; try { this.progress(payload); } catch { /* 进度回调不得影响操作本身。 */ } }
  async systemStatus() {
    let rows = [];
    try { rows = (await this.systemReader()) || []; } catch (error) { rows = SYSTEM_DEFS.map(def => ({ id: def.id, ok: false, detail: '检测失败：' + clean(error?.message) })); }
    if (!Array.isArray(rows)) rows = [];
    const byId = new Map(rows.filter(row => row && typeof row.id === 'string').map(row => [row.id, row]));
    return SYSTEM_DEFS.map(def => {
      const row = byId.get(def.id), ok = !!(row && row.ok);
      const item = { id: def.id, label: def.label, ok, detail: clean(row?.detail, ok ? '已就绪' : '未检测到。') };
      if (!ok && def.help) item.help = def.help;
      return item;
    });
  }
  async componentStatus() {
    let versions = {}; try { versions = await json(join(this.root, 'desktop/versions.json'), {}); } catch { versions = {}; }
    const ready = { napcat: await exists(join(this.root, 'tools/napcat/node.exe')), codex: await exists(join(this.root, 'tools/codex/codex-x86_64-pc-windows-msvc.exe')) };
    const mimo = await this.mimoStatus();
    return [
      { id: 'napcat', label: COMPONENT_DEFS[0].label, ok: ready.napcat, version: clean(versions.napcat), detail: ready.napcat ? '运行组件已就绪。' : '尚未准备，请在启动向导中准备运行组件。' },
      { id: 'codex', label: COMPONENT_DEFS[1].label, ok: ready.codex, version: codexVersion(versions), detail: ready.codex ? '已就绪；用于 ChatGPT 订阅登录认证。' : '未安装；可选组件，用于 ChatGPT 订阅登录（Codex）认证。', optional: true },
      { id: 'mimo', label: COMPONENT_DEFS[2].label, ok: mimo.ok, version: '', detail: mimo.detail, optional: true },
    ];
  }
  async mimoStatus() {
    let key = '', readFailed = false;
    try { key = String((await this.secretReader(this.root)) || ''); } catch { readFailed = true; }
    if (!key) return { ok: false, detail: readFailed ? '无法读取本机密钥库，按未配置处理。' : '未保存 MiMo Key；语音与 MiMo 模型需要先在设置中保存 Key。' };
    const type = mimoKeyType(key);
    if (!type) return { ok: true, detail: '已保存 MiMo Key，但类型无法识别：应以 sk-（按量 API）或 tp-、ttp-（Token Plan）开头。' };
    let settings = {}; try { settings = await json(join(this.root, 'data/settings.json'), {}); } catch { settings = {}; }
    const backend = String(settings?.ai?.backend ?? ''), speechURL = String(settings?.speech?.baseURL ?? MIMO_TOKEN_PLAN_CN_BASE_URL), plan = type === 'token-plan';
    const notes = [];
    if ((backend === 'mimo-api' || backend === 'mimo-token-plan-cn') && (backend === 'mimo-token-plan-cn') !== plan) notes.push(backend === 'mimo-token-plan-cn' ? '所选模型后端为 Token Plan，与 Key 类型不匹配。' : '所选模型后端为按量 API，与 Key 类型不匹配。');
    if (speechURL.startsWith('https://token-plan-') !== plan) notes.push(speechURL.startsWith('https://token-plan-') ? '语音地址为 Token Plan 集群，与 Key 类型不匹配。' : '语音地址为按量 API，与 Key 类型不匹配。');
    return { ok: true, detail: `已保存${plan ? 'Token Plan Key（tp-、ttp-）' : '按量 API Key（sk-）'}。` + (notes.length ? notes.join('') : '与所选模型后端、语音地址匹配。') };
  }
  async listeners() {
    try {
      const rows = await this.listenerReader();
      return (Array.isArray(rows) ? rows : []).map(row => ({ port: Number(row?.port), pid: Number(row?.pid), path: String(row?.path ?? '') })).filter(row => Number.isFinite(row.port) && Number.isFinite(row.pid) && row.path);
    } catch { return []; }
  }
  ownPaths() { return [join(this.root, 'tools/napcat/node.exe'), process.execPath].map(normalizePath); }
  isForeign(row) { const path = normalizePath(row.path); return !!path && !this.ownPaths().includes(path); }
  async conflictStatus() {
    const rows = (await this.listeners()).filter(row => WATCHED_PORTS.includes(row.port) && this.isForeign(row));
    return { owners: [...new Set(rows.map(row => row.path))], ports: [...new Set(rows.map(row => row.port))].sort((a, b) => a - b) };
  }
  async portStatus() {
    try {
      const rows = await this.listeners(), folder = join(this.root, 'tools/napcat/napcat/config'), own = this.ownPaths(), extras = new Map();
      for (const name of await this.onebotConfigFiles()) {
        let config; try { config = await json(join(folder, name), null); } catch { continue; }
        for (const section of INBOUND_SECTIONS) {
          const list = config?.network?.[section]; if (!Array.isArray(list)) continue;
          for (const entry of list) {
            const port = Number(entry?.port);
            if (!entry || typeof entry !== 'object' || !Number.isFinite(port) || entry.enable === false || (entry.name === 'qq-agent' && port === 3001)) continue;
            if (!extras.has(port)) extras.set(port, typeof entry.name === 'string' && entry.name ? entry.name : '额外监听');
          }
        }
      }
      const describe = port => {
        const list = rows.filter(row => row.port === port), foreign = list.find(row => !own.includes(normalizePath(row.path)));
        if (foreign) return { role: 'foreign', detail: `被外来进程占用：${foreign.path}` };
        if (list.length) return { detail: port === 6100 ? '本机机器人进程监听中' : '本工作区 NapCat 监听中' };
        return {};
      };
      const result = PORT_DEFS.map(item => { const state = describe(item.port); return { port: item.port, label: item.label, role: state.role || 'required', ...(state.detail ? { detail: state.detail } : {}) }; });
      for (const [port, label] of [...extras].sort((a, b) => a[0] - b[0])) {
        const state = describe(port);
        result.push({ port, label, role: state.role || 'extra', detail: state.detail || '配置中仍启用的多余入站监听' });
      }
      return result;
    } catch { return []; }
  }
  async onebotConfigFiles() {
    let extra = []; try { extra = (await readdir(join(this.root, 'tools/napcat/napcat/config'))).filter(name => /^onebot11_\d+\.json$/.test(name)).sort(); } catch {}
    return ['onebot11.json', ...extra];
  }
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
    } catch (error) { if (error.code === 'WORKSPACE_MISMATCH') { state.workspaceError = error.message; state.conflict = await this.conflictStatus(); } /* A stopped service is a normal launcher state. */ }
    try { const response = await new AdminBridge(this.root).request('GET', 'state'); if (response.status === 200) { state.botConnected = response.data.status.qq.connected; state.botName = response.data.settings.bot.name; state.model = selectedModel(response.data.settings); } } catch {}
    const [system, components, ports] = await Promise.all([this.systemStatus(), this.componentStatus(), this.portStatus()]);
    state.system = system; state.components = components; state.ports = ports;
    return state;
  }
  async detached(binary, args, name, env = childEnv()) {
    await mkdir(join(this.root, 'data'), { recursive: true }); const log = await open(join(this.root, 'data', name + '.log'), 'a', 0o600);
    try { const child = spawn(binary, args, { cwd: this.root, env, windowsHide: true, detached: true, shell: false, stdio: ['ignore', log.fd, log.fd] }); await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref(); }
    finally { await log.close(); }
  }
  async download(url, digest, folder) {
    const label = folder === 'napcat' ? 'NapCat 运行组件' : 'Codex 登录组件', [atDownload, atExtract] = folder === 'napcat' ? [10, 35] : [50, 75];
    this.report({ action: 'install', step: 'download', item: folder, message: `正在下载 ${label}…`, percent: atDownload });
    const response = await this.fetch(url, { signal: AbortSignal.timeout(300000) }); if (!response.ok) throw new Error('官方运行组件下载失败 HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer()); if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('运行组件校验失败，未安装。');
    const archive = join(this.root, 'tools', 'desktop-' + folder + '.zip'), target = join(this.root, 'tools', folder); await writeFile(archive, bytes); await mkdir(target, { recursive: true });
    this.report({ action: 'install', step: 'extract', item: folder, message: `正在解压 ${label}…`, percent: atExtract });
    await this.extractor(archive, target);
  }
  async install() {
    try {
      await mkdir(join(this.root, 'tools'), { recursive: true }); const versions = await json(join(this.root, 'desktop/versions.json'));
      if (!await exists(join(this.root, 'tools/napcat/node.exe'))) await this.download(`https://github.com/NapNeko/NapCatQQ/releases/download/${versions.napcat}/${versions.napcatAsset}`, versions.napcatSha256, 'napcat');
      const localCodex = join(this.root, 'tools/codex/codex-x86_64-pc-windows-msvc.exe');
      if (!process.env.CODEX_BIN || process.env.CODEX_BIN === 'codex') {
        if (!await exists(localCodex)) await this.download(versions.codexURL, versions.codexSha256, 'codex');
        if (!await exists(localCodex)) throw new Error('Codex 运行组件未找到，请检查官方发行包。');
      }
      this.report({ action: 'install', step: 'configure', message: '正在写入桌面配置…', percent: 90 });
      await this.configure(); this.report({ action: 'install', done: true, ok: true });
      return { installed: true };
    } catch (error) {
      this.report({ action: 'install', done: true, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
    }
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
  async migrateLegacySpeech(list, credential, { timeoutMs = 5000, pollMs = 250 } = {}) {
    const speech = PLUGIN_MODULES.find(plugin => plugin.module === 'speech');
    if (!list.plugins.some(row => row.id === speech.id && row.status === 'disabled')) return list;
    // A recorded module state means this installation has already used the new
    // extension. In particular, never undo a user's later disable action.
    try { await access(join(this.root, 'data/napcat-modules/speech.json')); return list; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = await json(join(this.root, 'data/settings.json'), {});
    if (saved?.speech?.enabled !== true) return list;
    this.report({ action: 'start', step: 'plugins', message: '正在恢复已启用的语音扩展…' });
    await this.native('Plugin/SetStatus', { id: speech.id, enable: true }, credential);
    const deadline = Date.now() + timeoutMs;
    do {
      list = await this.native('Plugin/List', undefined, credential);
      if (list.plugins.some(row => row.id === speech.id && row.status === 'active')) return list;
      await delay(pollMs);
    } while (Date.now() < deadline);
    throw new Error('语音扩展未能启用，请在 NapCat 插件管理中检查语音扩展状态。');
  }
  async start() {
    try {
      await this.assertRuntimeWorkspace();
      let credential, fresh = false;
      try { credential = await this.session(); } catch {}
      if (!credential) {
        if (!await exists(join(this.root, 'tools/napcat/node.exe'))) throw new Error('请先点击“准备运行组件”。');
        this.report({ action: 'start', step: 'configure', item: 'napcat', message: '正在写入 NapCat 配置…', percent: 15 });
        await this.configure();
        this.report({ action: 'start', step: 'launch', item: 'napcat', message: '正在启动 NapCat 后台…', percent: 35 });
        await this.detached(join(this.root, 'tools/napcat/node.exe'), [join(this.root, 'tools/napcat/index.js')], 'desktop-napcat');
        this.report({ action: 'start', step: 'wait', item: 'napcat', message: '等待 NapCat 服务就绪…', percent: 55 });
        credential = await this.ready(); fresh = true;
      }
      this.report({ action: 'start', step: 'plugins', message: '正在检查插件加载…', percent: 75 });
      let list = fresh ? await this.waitForPlugins(credential) : await this.native('Plugin/List', undefined, credential);
      const expectedVersion = (await json(join(this.root, 'package.json'))).version;
      if (PLUGIN_MODULES.some(plugin => list.plugins.some(row => row.id === plugin.id && row.version !== expectedVersion))) {
        this.report({ action: 'start', step: 'configure', message: '正在更新插件配置…' });
        await this.configure(); await this.native('Process/Restart', {}, credential); await delay(1500); credential = await this.ready(); list = await this.waitForPlugins(credential);
        if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id && row.version === expectedVersion))) throw new Error('插件版本尚未更新，请查看 NapCat 日志。');
      }
      for (const plugin of PLUGIN_MODULES) if (!list.plugins.some(row => row.id === plugin.id)) {
        try { await this.native('Plugin/SetStatus', { id: plugin.id, enable: true }, credential); } catch {}
      }
      if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id))) {
        this.report({ action: 'start', step: 'configure', message: '正在更新插件配置…' });
        await this.configure(); await this.native('Process/Restart', {}, credential); await delay(1500); credential = await this.ready(); list = await this.waitForPlugins(credential);
        if (PLUGIN_MODULES.some(plugin => !list.plugins.some(row => row.id === plugin.id))) throw new Error('插件尚未加载，请查看 NapCat 日志。');
      }
      list = await this.migrateLegacySpeech(list, credential);
      this.report({ action: 'start', step: 'launch', message: '正在启动机器人引擎…', percent: 90 });
      await ensureEngine(this.root, process.execPath);
      const state = await this.status(); this.report({ action: 'start', done: true, ok: true }); return state;
    } catch (error) {
      this.report({ action: 'start', done: true, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }
  async switchAccount() {
    const credential = await this.session(), before = await json(this.webui);
    await writeJSON(join(this.root, 'data', 'desktop-webui-before-switch.json'), before);
    await writeJSON(this.webui, quickLoginConfig(before, true));
    await this.native('Process/Restart', {}, credential); await delay(1500); await this.ready(); return { switched: true };
  }
  async stopBot() {
    try {
      this.report({ action: 'stop-bot', step: 'stop', message: '正在停止机器人…' });
      const response = await new AdminBridge(this.root).request('POST', 'runtime/stop', {});
      if (response.status !== 200) throw new Error('停止机器人未完成。');
      this.report({ action: 'stop-bot', done: true, ok: true }); return { stopped: true };
    } catch (error) {
      this.report({ action: 'stop-bot', done: true, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }
  async stopConflict() {
    const stopped = [], refused = [], failures = [], attemptedPids = new Set();
    try {
      this.report({ action: 'stop-conflict', step: 'check', message: '正在检查占用端口的后台…', percent: 20 });
      const conflicts = (await this.listeners()).filter(row => WATCHED_PORTS.includes(row.port) && this.isForeign(row));
      for (const row of conflicts) {
        if (isNapcatPath(row.path)) {
          if (attemptedPids.has(row.pid)) continue;
          attemptedPids.add(row.pid);
          this.report({ action: 'stop-conflict', step: 'kill', message: `正在结束占用端口 ${row.port} 的 NapCat 后台…` });
          try { await this.processKiller({ pid: row.pid, port: row.port, path: row.path }); stopped.push({ port: row.port, pid: row.pid, path: row.path }); }
          catch (error) { failures.push({ ...row, error: error instanceof Error ? error.message : String(error) }); }
        } else {
          refused.push({ port: row.port, pid: row.pid, path: row.path, reason: `不是 QQ Agent 的 NapCat 后台，未自动结束，请手动确认后关闭：${row.path}` });
          this.report({ action: 'stop-conflict', step: 'skip', message: `端口 ${row.port} 由其它程序占用，已跳过。` });
        }
      }
      this.report({ action: 'stop-conflict', step: 'verify', message: '正在复查端口占用…', percent: 80 });
      const remaining = (await this.listeners()).filter(row => WATCHED_PORTS.includes(row.port) && this.isForeign(row) && isNapcatPath(row.path));
      if (failures.length) throw new Error('结束占用端口的后台失败：' + failures.map(row => `端口 ${row.port}（${row.error}）`).join('、'));
      if (remaining.length) throw new Error('端口仍被其它 QQ Agent 的 NapCat 后台占用：' + [...new Set(remaining.map(row => row.port))].sort((a, b) => a - b).join('、') + '，请稍后重试或手动关闭。');
      this.report({ action: 'stop-conflict', done: true, ok: true });
      return { stopped, refused };
    } catch (error) {
      this.report({ action: 'stop-conflict', done: true, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }
  async trimPorts() {
    try {
      this.report({ action: 'trim-ports', step: 'read', message: '正在检查端口配置…', percent: 15 });
      const folder = join(this.root, 'tools/napcat/napcat/config'), trimmed = [], seen = new Set(); let reported = false;
      for (const name of await this.onebotConfigFiles()) {
        const file = join(folder, name), config = await json(file, null);
        if (!config || typeof config !== 'object' || !config.network || typeof config.network !== 'object') continue;
        let changed = false;
        for (const section of INBOUND_SECTIONS) {
          const list = config.network[section]; if (!Array.isArray(list)) continue;
          for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const port = Number(entry.port), keep = entry.name === 'qq-agent' && port === 3001;
            let action = null;
            if (!keep && entry.enable !== false) { entry.enable = false; action = 'disabled'; }
            const wildcard = ['0.0.0.0', '::', '::0', '[::]'].includes(entry.host);
            if (keep ? entry.host !== '127.0.0.1' : wildcard) { entry.host = '127.0.0.1'; action ||= 'loopback-only'; }
            if (action) {
              changed = true;
              const record = { name: typeof entry.name === 'string' ? entry.name : '', port: Number.isFinite(port) ? port : entry.port, action }, key = `${record.name}|${record.port}|${record.action}`;
              if (!seen.has(key)) { seen.add(key); trimmed.push(record); }
            }
          }
        }
        if (changed) {
          if (!reported) { this.report({ action: 'trim-ports', step: 'configure', message: '正在收紧端口配置…', percent: 55 }); reported = true; }
          await writeJSON(file, config);
        }
      }
      let credential = null;
      if (trimmed.length) { try { credential = await this.session(); } catch {} /* 本机 NapCat 未运行时配置将在下次启动生效。 */ }
      if (credential) {
        this.report({ action: 'trim-ports', step: 'restart', message: '正在重启 NapCat 使端口配置生效…', percent: 80 });
        await this.native('Process/Restart', {}, credential); await delay(1500); await this.ready();
      }
      this.report({ action: 'trim-ports', done: true, ok: true });
      return { trimmed, restartRequired: trimmed.length > 0 };
    } catch (error) {
      this.report({ action: 'trim-ports', done: true, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }
}

export async function loadDesktopEnvironment(root) {
  const file = join(root, '.env'); if (await exists(file)) process.loadEnvFile(file);
  if (!process.env.CODEX_BIN || process.env.CODEX_BIN === 'codex') {
    const binary = join(root, 'tools/codex/codex-x86_64-pc-windows-msvc.exe');
    if (await exists(binary)) process.env.CODEX_BIN = binary;
  }
}
