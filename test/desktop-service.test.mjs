import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateWorkspace, validateWorkspacePath, mergeOneBot, quickLoginConfig, DesktopService } from '../src/desktop-service.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';

test('等待 QQ 登录后异步加载的插件，避免管理接口先就绪导致误判', async () => {
  const service = new DesktopService(tmpdir(), { ownerReader: async () => [] }); let reads = 0;
  service.native = async () => ({ plugins: ++reads < 3 ? [] : PLUGIN_MODULES.map(plugin => ({ id: plugin.id })) });
  assert.equal((await service.waitForPlugins('fixture', { timeoutMs: 1000, pollMs: 1 })).plugins.length, PLUGIN_MODULES.length);
  assert.equal(reads, 3);
  service.native = async () => ({ plugins: [] });
  await assert.rejects(() => service.waitForPlugins('fixture', { timeoutMs: 1, pollMs: 1 }), /插件加载超时/);
});

test('拒绝复用其他工作区的服务，认证和启动均不触发', async () => {
  let requests = 0, spawned = false;
  const service = new DesktopService(join(tmpdir(), 'new-workspace'), {
    ownerReader: async () => [join(tmpdir(), 'old-workspace/tools/napcat/node.exe')],
    fetcher: async () => { requests++; throw Error('must not authenticate'); },
  });
  service.detached = async () => { spawned = true; };
  await assert.rejects(() => service.session(), { code: 'WORKSPACE_MISMATCH' });
  await assert.rejects(() => service.start(), { code: 'WORKSPACE_MISMATCH' });
  await assert.rejects(() => service.configure(), { code: 'WORKSPACE_MISMATCH' });
  const status = await service.status();
  assert.match(status.workspaceError, /其他工作区/); assert.equal(status.webuiAvailable, false);
  assert.equal(requests, 0); assert.equal(spawned, false);
});

test('同目录或空闲端口可用，无法识别监听进程时中止', async () => {
  const root = join(tmpdir(), 'same-workspace');
  for (const owners of [[], [join(root, 'tools/napcat/node.exe')]]) {
    await new DesktopService(root, { ownerReader: async () => owners }).assertRuntimeWorkspace();
  }
  await assert.rejects(() => new DesktopService(root, { ownerReader: async () => { throw Error('Cannot identify listener'); } }).start(), /Cannot identify/);
});

test('桌面端选择项目先校验，拒绝错误目录和含控制字符的参数', async () => {
  assert.throws(() => validateWorkspacePath('x\ncommand')); assert.throws(() => validateWorkspacePath(''));
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-project-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'unrelated', type: 'module' })); await assert.rejects(() => validateWorkspace(root), /项目/);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bupt-qq-homework-bot', type: 'module' })); await mkdir(join(root, 'src')); await writeFile(join(root, 'src/main.mjs'), ''); assert.equal(await validateWorkspace(root), root);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('QQ 换号只取消自动登录，不改管理密码、设备和其他配置；普通启动不清除快捷登录', () => {
  const config = { token: 'PRIVATE_PASSWORD', autoLoginAccount: '100000001', port: 6099, host: '127.0.0.1', custom: { background: 'user' } };
  assert.deepEqual(quickLoginConfig(config, false), config);
  assert.deepEqual(quickLoginConfig(config, true), { ...config, autoLoginAccount: '' }); assert.equal(config.autoLoginAccount, '100000001');
});

test('OneBot 桌面初始化保留用户其他网络配置，只管理本机 3001 端口，不重复添加', () => {
  const before = { custom: 42, network: { httpServers: [{ port: 5000 }], websocketServers: [{ port: 4000, token: 'other' }, { port: 3001, name: 'existing', custom: 'keep' }] } };
  const result = mergeOneBot(before, 'new-token'); assert.deepEqual(result.network.httpServers, before.network.httpServers); assert.deepEqual(result.network.websocketServers[0], before.network.websocketServers[0]);
  assert.equal(result.network.websocketServers[1].custom, 'keep'); assert.equal(result.network.websocketServers[1].token, 'new-token'); assert.equal(result.network.websocketServers[1].host, '127.0.0.1');
  assert.deepEqual(mergeOneBot(result, 'new-token'), result); assert.ok(!JSON.stringify(before).includes('new-token'));
});

test('桌面首页状态不包含管理密码或浏览器登录凭据；只调用固定本机接口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-status-')), calls = [];
  try {
    await mkdir(join(root, 'tools/napcat/napcat/config'), { recursive: true }); await writeFile(join(root, 'tools/napcat/napcat/config/webui.json'), JSON.stringify({ token: 'PRIVATE_PASSWORD' }));
    const service = new DesktopService(root, { ownerReader: async () => [], sessionCodec: { protect: async value => value, unprotect: async value => value }, fetcher: async (url, options) => {
      assert.ok(url.startsWith('http://127.0.0.1:6099/api/')); calls.push({ url, body: options.body });
      return { ok: true, json: async () => ({ code: 0, data: url.endsWith('auth/login') ? { Credential: 'PRIVATE_CREDENTIAL' } : { isLogin: true, loginPhase: 'ready' } }) };
    } });
    const state = await service.status(); assert.equal(state.qqLoggedIn, true); assert.equal(state.webuiAvailable, true); assert.equal(calls.length, 2);
    assert.ok(!JSON.stringify(state).includes('PRIVATE_')); assert.ok(!calls[0].body.includes('PRIVATE_PASSWORD'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('桌面刷新跨进程实例复用加密会话，失效后重新认证，不反复触发 NapCat 登录限流', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-session-')); let logins = 0, revoked = false;
  const sessionCodec = { protect: async value => Buffer.from(value).toString('base64'), unprotect: async value => Buffer.from(value, 'base64').toString() };
  const fetcher = async url => {
    if (url.endsWith('auth/login')) { logins++; revoked = false; return { ok: true, json: async () => ({ code: 0, data: { Credential: 'PRIVATE_SESSION' } }) }; }
    return { ok: !revoked, json: async () => ({ code: revoked ? -1 : 0, data: null }) };
  };
  try {
    await mkdir(join(root, 'tools/napcat/napcat/config'), { recursive: true }); await writeFile(join(root, 'tools/napcat/napcat/config/webui.json'), JSON.stringify({ token: 'PRIVATE_PASSWORD' }));
    for (let i = 0; i < 15; i++) assert.equal(await new DesktopService(root, { ownerReader: async () => [], fetcher, sessionCodec }).session(), 'PRIVATE_SESSION');
    assert.equal(logins, 1); revoked = true;
    assert.equal(await new DesktopService(root, { ownerReader: async () => [], fetcher, sessionCodec }).session(), 'PRIVATE_SESSION'); assert.equal(logins, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('status() 的 system/components 字段形状与顺序固定，不影响现有字段', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-shape-'));
  try {
    await mkdir(join(root, 'desktop'), { recursive: true });
    await writeFile(join(root, 'desktop/versions.json'), JSON.stringify({ napcat: 'v4.18.38', napcatAsset: 'NapCat.Shell.Windows.Node.zip', codexURL: 'https://example.invalid/openai/codex/releases/download/rust-v0.163.0/codex-x86_64-pc-windows-msvc.exe.zip' }));
    await mkdir(join(root, 'tools/napcat'), { recursive: true }); await writeFile(join(root, 'tools/napcat/node.exe'), 'stub');
    const service = new DesktopService(root, { ownerReader: async () => [], systemReader: async () => ['os', 'dotnet', 'webview2', 'node', 'powershell'].map(id => ({ id, ok: true, detail: id + ' 明细' })) });
    const state = await service.status();
    assert.deepEqual(state.system.map(item => item.id), ['os', 'dotnet', 'webview2', 'node', 'powershell']);
    for (const item of state.system) {
      assert.deepEqual(Object.keys(item), ['id', 'label', 'ok', 'detail']);
      assert.equal(item.ok, true); assert.ok(item.label); assert.equal(item.detail, item.id + ' 明细');
    }
    assert.deepEqual(state.components.map(item => item.id), ['napcat', 'codex']);
    const [napcat, codex] = state.components;
    assert.deepEqual(Object.keys(napcat), ['id', 'label', 'ok', 'version', 'detail']);
    assert.deepEqual(Object.keys(codex), ['id', 'label', 'ok', 'version', 'detail', 'optional']);
    assert.equal(napcat.ok, true); assert.equal(napcat.version, 'v4.18.38');
    assert.equal(codex.ok, false); assert.equal(codex.version, 'rust-v0.163.0'); assert.equal(codex.optional, true);
    for (const key of ['workspace', 'napcatInstalled', 'webuiAvailable', 'qqLoggedIn', 'botConnected']) assert.ok(key in state);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('status() 的系统检查可注入：systemReader 生效，缺失项与异常都按失败返回且不外抛', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-system-'));
  try {
    const service = new DesktopService(root, {
      ownerReader: async () => [],
      systemReader: async () => [
        { id: 'powershell', ok: true, detail: '注入的 PowerShell 5.1' },
        { id: 'os', ok: false, detail: '注入的系统信息' },
        { id: 'webview2', ok: false, detail: '注入的 WebView2 缺失' },
      ],
    });
    const state = await service.status(), byId = Object.fromEntries(state.system.map(item => [item.id, item]));
    assert.deepEqual(state.system.map(item => item.id), ['os', 'dotnet', 'webview2', 'node', 'powershell']);
    assert.equal(byId.os.ok, false); assert.equal(byId.os.detail, '注入的系统信息'); assert.equal(byId.os.help, undefined);
    assert.equal(byId.powershell.ok, true); assert.equal(byId.powershell.detail, '注入的 PowerShell 5.1');
    assert.equal(byId.webview2.help, 'https://developer.microsoft.com/microsoft-edge/webview2/');
    assert.equal(byId.dotnet.ok, false); assert.equal(byId.dotnet.detail, '未检测到。');
    const broken = new DesktopService(root, { ownerReader: async () => [], systemReader: async () => { throw new Error('boom'); } });
    const failed = await broken.status();
    assert.equal(failed.system.length, 5); assert.ok(failed.system.every(item => item.ok === false && item.detail.includes('boom')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('install() 全程按协议上报 progress：download/extract/configure 与收尾 done:true ok:true', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-install-')), events = [], extracted = [];
  const encode = text => new TextEncoder().encode(text), digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const napcatBytes = encode('NAPCAT_FIXTURE'), codexBytes = encode('CODEX_FIXTURE');
  const previousCodexBin = process.env.CODEX_BIN; delete process.env.CODEX_BIN;
  try {
    await mkdir(join(root, 'desktop'), { recursive: true });
    await writeFile(join(root, 'desktop/versions.json'), JSON.stringify({ napcat: 'v9.9.9', napcatAsset: 'NapCat.Shell.Windows.Node.zip', napcatSha256: digest(napcatBytes), codexURL: 'https://example.invalid/openai/codex/releases/download/rust-v0.1.0/codex.zip', codexSha256: digest(codexBytes) }));
    const service = new DesktopService(root, {
      ownerReader: async () => [],
      fetcher: async url => ({ ok: true, status: 200, arrayBuffer: async () => { const bytes = url.includes('codex') ? codexBytes : napcatBytes; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } }),
      extractor: async (archive, target) => {
        extracted.push([archive, target]); await mkdir(target, { recursive: true });
        await writeFile(join(target, target.endsWith('napcat') ? 'node.exe' : 'codex-x86_64-pc-windows-msvc.exe'), 'stub');
      },
      progress: payload => events.push(payload),
    });
    service.configure = async () => {};
    assert.deepEqual(await service.install(), { installed: true });
    assert.deepEqual(events.map(event => event.step).filter(Boolean), ['download', 'extract', 'download', 'extract', 'configure']);
    assert.deepEqual(events.filter(event => !event.done).map(event => event.item), ['napcat', 'napcat', 'codex', 'codex', undefined]);
    assert.deepEqual(events.at(-1), { action: 'install', done: true, ok: true });
    assert.deepEqual(events.filter(event => event.done), [events.at(-1)]);
    for (const event of events) {
      assert.equal(event.action, 'install');
      if (event.done) continue;
      assert.match(event.step, /^[a-z]+$/); assert.match(event.message, /[\u4e00-\u9fff]/);
      assert.ok(Number.isInteger(event.percent) && event.percent >= 0 && event.percent <= 100);
    }
    assert.equal(extracted.length, 2);
  } finally {
    if (previousCodexBin === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previousCodexBin;
    await rm(root, { recursive: true, force: true });
  }
});

test('install()/start() 失败路径发出 done:true ok:false error，收尾事件只发一次', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-fail-')), events = [];
  try {
    await mkdir(join(root, 'desktop'), { recursive: true });
    await writeFile(join(root, 'desktop/versions.json'), JSON.stringify({ napcat: 'v9.9.9', napcatAsset: 'x.zip', napcatSha256: '0'.repeat(64), codexURL: 'https://example.invalid/codex.zip', codexSha256: '1'.repeat(64) }));
    const service = new DesktopService(root, {
      ownerReader: async () => [],
      fetcher: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('BAD_BYTES').buffer }),
      extractor: async () => { throw new Error('校验失败后不得解压'); },
      progress: payload => events.push(payload),
    });
    await assert.rejects(() => service.install(), /校验失败/);
    assert.deepEqual(events.map(event => event.step).filter(Boolean), ['download']);
    const installDone = events.filter(event => event.done);
    assert.equal(installDone.length, 1); assert.equal(installDone[0].action, 'install'); assert.equal(installDone[0].ok, false); assert.match(installDone[0].error, /校验失败/);
    const starts = [];
    const other = new DesktopService(join(tmpdir(), 'qq-agent-other-workspace'), { ownerReader: async () => [join(tmpdir(), 'qq-agent-old-workspace/tools/napcat/node.exe')], progress: payload => starts.push(payload) });
    await assert.rejects(() => other.start(), { code: 'WORKSPACE_MISMATCH' });
    const startDone = starts.filter(event => event.done);
    assert.equal(startDone.length, 1); assert.equal(startDone[0].action, 'start'); assert.equal(startDone[0].ok, false); assert.match(startDone[0].error, /其他工作区/);
    assert.equal(starts.at(-1), startDone[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
