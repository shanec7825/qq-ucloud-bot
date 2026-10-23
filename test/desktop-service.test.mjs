import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MIMO_API_BASE_URL, MIMO_TOKEN_PLAN_CN_BASE_URL } from '../src/ai-providers.mjs';
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

test('升级到独立语音扩展时恢复旧版已启用的语音，并确认扩展实际激活', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-speech-migration-'));
  try {
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data/settings.json'), JSON.stringify({ speech: { enabled: true } }));
    const speechId = PLUGIN_MODULES.find(plugin => plugin.module === 'speech').id;
    const before = { plugins: PLUGIN_MODULES.map(plugin => ({ id: plugin.id, status: 'disabled' })) };
    const after = { plugins: before.plugins.map(plugin => ({ ...plugin, status: plugin.id === speechId ? 'active' : 'disabled' })) };
    const calls = [], service = new DesktopService(root, { ownerReader: async () => [] }); let reads = 0;
    service.native = async (path, payload, credential) => {
      calls.push({ path, payload, credential });
      if (path === 'Plugin/List') return ++reads === 1 ? before : after;
      return {};
    };
    assert.deepEqual(await service.migrateLegacySpeech(before, 'fixture', { timeoutMs: 1000, pollMs: 1 }), after);
    assert.deepEqual(calls.filter(call => call.path === 'Plugin/SetStatus'), [{ path: 'Plugin/SetStatus', payload: { id: speechId, enable: true }, credential: 'fixture' }]);
    assert.equal(reads, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('语音迁移尊重已记录的模块状态和未开启的旧设置，不启用其他扩展', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-speech-opt-out-'));
  try {
    await mkdir(join(root, 'data/napcat-modules'), { recursive: true });
    const service = new DesktopService(root, { ownerReader: async () => [] });
    service.native = async () => { throw new Error('must not change plugin status'); };
    const list = { plugins: PLUGIN_MODULES.map(plugin => ({ id: plugin.id, status: 'disabled' })) };
    for (const active of [false, true]) {
      await writeFile(join(root, 'data/settings.json'), JSON.stringify({ speech: { enabled: true } }));
      await writeFile(join(root, 'data/napcat-modules/speech.json'), JSON.stringify({ active }));
      assert.equal(await service.migrateLegacySpeech(list, 'fixture'), list);
    }
    await rm(join(root, 'data/napcat-modules/speech.json'));
    for (const settings of [{}, { speech: { enabled: false } }, { speech: { enabled: 'true' } }]) {
      await writeFile(join(root, 'data/settings.json'), JSON.stringify(settings));
      assert.equal(await service.migrateLegacySpeech(list, 'fixture'), list);
    }
    await writeFile(join(root, 'data/settings.json'), JSON.stringify({ speech: { enabled: true } }));
    const missing = { plugins: [] };
    assert.equal(await service.migrateLegacySpeech(missing, 'fixture'), missing);
    const active = { plugins: list.plugins.map(plugin => ({ ...plugin, status: 'active' })) };
    assert.equal(await service.migrateLegacySpeech(active, 'fixture'), active);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('语音扩展启用请求失败或未激活时明确报错，不把迁移视作成功', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-speech-failed-'));
  try {
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data/settings.json'), JSON.stringify({ speech: { enabled: true } }));
    const service = new DesktopService(root, { ownerReader: async () => [] });
    const list = { plugins: [{ id: 'napcat-plugin-agent-speech', status: 'disabled' }] };
    service.native = async () => { throw new Error('启用失败'); };
    await assert.rejects(() => service.migrateLegacySpeech(list, 'fixture'), /启用失败/);
    service.native = async path => path === 'Plugin/List' ? list : {};
    await assert.rejects(() => service.migrateLegacySpeech(list, 'fixture', { timeoutMs: 1, pollMs: 1 }), /语音扩展未能启用/);
  } finally { await rm(root, { recursive: true, force: true }); }
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
    const service = new DesktopService(root, { ownerReader: async () => [], secretReader: async () => '', systemReader: async () => ['os', 'dotnet', 'webview2', 'node', 'powershell'].map(id => ({ id, ok: true, detail: id + ' 明细' })) });
    const state = await service.status();
    assert.deepEqual(state.system.map(item => item.id), ['os', 'dotnet', 'webview2', 'node', 'powershell']);
    for (const item of state.system) {
      assert.deepEqual(Object.keys(item), ['id', 'label', 'ok', 'detail']);
      assert.equal(item.ok, true); assert.ok(item.label); assert.equal(item.detail, item.id + ' 明细');
    }
    assert.deepEqual(state.components.map(item => item.id), ['napcat', 'codex', 'mimo']);
    const [napcat, codex, mimo] = state.components;
    assert.deepEqual(Object.keys(napcat), ['id', 'label', 'ok', 'version', 'detail']);
    assert.deepEqual(Object.keys(codex), ['id', 'label', 'ok', 'version', 'detail', 'optional']);
    assert.deepEqual(Object.keys(mimo), ['id', 'label', 'ok', 'version', 'detail', 'optional']);
    assert.equal(napcat.ok, true); assert.equal(napcat.version, 'v4.18.38');
    assert.equal(codex.ok, false); assert.equal(codex.version, 'rust-v0.163.0'); assert.equal(codex.optional, true);
    assert.equal(codex.label, 'ChatGPT / Codex 认证组件');
    assert.equal(mimo.label, '小米 MiMo / Token Plan 组件'); assert.equal(mimo.optional, true); assert.equal(mimo.ok, false); assert.equal(mimo.version, '');
    assert.ok(Array.isArray(state.ports));
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

test('stop-conflict 结束其它工作区的 NapCat 进程树，收尾 done:true ok:true', async () => {
  const root = join(tmpdir(), 'qq-agent-conflict-'), killed = [], events = [];
  const foreign = join(tmpdir(), 'other-workspace', 'tools', 'napcat', 'node.exe');
  const listeners = [{ port: 6099, pid: 4242, path: foreign }];
  const service = new DesktopService(root, {
    ownerReader: async () => [],
    listenerReader: async () => listeners.map(row => ({ ...row })),
    processKiller: async target => { killed.push(target); listeners.splice(listeners.findIndex(row => row.pid === target.pid), 1); },
    progress: payload => events.push(payload),
  });
  assert.deepEqual(await service.stopConflict(), { stopped: [{ port: 6099, pid: 4242, path: foreign }], refused: [] });
  assert.deepEqual(killed, [{ pid: 4242, port: 6099, path: foreign }]);
  assert.deepEqual(events.at(-1), { action: 'stop-conflict', done: true, ok: true });
  assert.equal(events.filter(event => event.done).length, 1);
  assert.ok(events.some(event => event.step === 'kill' && event.message.includes('6099')));
});

test('stop-conflict deduplicates one NapCat PID listening on multiple ports', async () => {
  const root = join(tmpdir(), 'qq-agent-conflict-dedup-'), foreign = join(tmpdir(), 'other-workspace', 'tools', 'napcat', 'node.exe');
  const killed = [], events = []; let running = true;
  const service = new DesktopService(root, {
    ownerReader: async () => [], listenerReader: async () => running ? [6099, 3001].map(port => ({ port, pid: 4242, path: foreign })) : [],
    processKiller: async ({ pid }) => { if (killed.includes(pid)) throw Error('process no longer exists'); killed.push(pid); running = false; },
    progress: payload => events.push(payload),
  });
  const result = await service.stopConflict(); assert.deepEqual(killed, [4242]); assert.equal(result.stopped.length, 1); assert.equal(events.at(-1).ok, true);
});

test('stop-conflict 拒绝非 NapCat 程序并写明路径，不调用 taskkill', async () => {
  const root = join(tmpdir(), 'qq-agent-refuse-'), killed = [], events = [];
  const app = 'C:\\Program Files\\SomeApp\\app.exe';
  const service = new DesktopService(root, {
    ownerReader: async () => [],
    listenerReader: async () => [{ port: 6100, pid: 777, path: app }],
    processKiller: async target => { killed.push(target); },
    progress: payload => events.push(payload),
  });
  const result = await service.stopConflict();
  assert.deepEqual(result.stopped, []); assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0].port, 6100); assert.equal(result.refused[0].pid, 777); assert.equal(result.refused[0].path, app);
  assert.match(result.refused[0].reason, /手动/); assert.ok(result.refused[0].reason.includes(app));
  assert.equal(killed.length, 0);
  assert.deepEqual(events.at(-1), { action: 'stop-conflict', done: true, ok: true });
});

test('stop-conflict 混合场景：只结束 NapCat 后台，其它程序列入 refused', async () => {
  const root = join(tmpdir(), 'qq-agent-mixed-'), killed = [], events = [];
  const foreign = join(tmpdir(), 'other-b', 'tools', 'napcat', 'node.exe'), app = 'C:\\Other\\svc.exe';
  const listeners = [{ port: 6099, pid: 11, path: foreign }, { port: 6100, pid: 22, path: app }];
  const service = new DesktopService(root, {
    ownerReader: async () => [],
    listenerReader: async () => listeners.map(row => ({ ...row })),
    processKiller: async target => { killed.push(target.pid); listeners.splice(listeners.findIndex(row => row.pid === target.pid), 1); },
    progress: payload => events.push(payload),
  });
  const result = await service.stopConflict();
  assert.deepEqual(killed, [11]);
  assert.deepEqual(result.stopped, [{ port: 6099, pid: 11, path: foreign }]);
  assert.equal(result.refused.length, 1); assert.equal(result.refused[0].path, app);
  assert.deepEqual(events.at(-1), { action: 'stop-conflict', done: true, ok: true });
});

test('stop-conflict 不动本工作区进程，无冲突返回空；杀完仍被占用则报错说明', async () => {
  const root = join(tmpdir(), 'qq-agent-clean-'), killed = [], events = [];
  const own = join(root, 'tools', 'napcat', 'node.exe');
  const service = new DesktopService(root, {
    ownerReader: async () => [],
    listenerReader: async () => [{ port: 6099, pid: 1, path: own }, { port: 6100, pid: 2, path: process.execPath }],
    processKiller: async target => { killed.push(target); },
    progress: payload => events.push(payload),
  });
  assert.deepEqual(await service.stopConflict(), { stopped: [], refused: [] });
  assert.equal(killed.length, 0);
  const foreign = join(tmpdir(), 'other-c', 'tools', 'napcat', 'node.exe'), stuckEvents = [];
  const stuck = new DesktopService(root, {
    ownerReader: async () => [],
    listenerReader: async () => [{ port: 3001, pid: 9, path: foreign }],
    processKiller: async () => {},
    progress: payload => stuckEvents.push(payload),
  });
  await assert.rejects(() => stuck.stopConflict(), /仍被.*占用/);
  const done = stuckEvents.filter(event => event.done);
  assert.equal(done.length, 1); assert.equal(done[0].action, 'stop-conflict'); assert.equal(done[0].ok, false); assert.match(done[0].error, /占用/);
});

test('status() 在 6099 被其它工作区占用时输出 conflict，只含被占端口与外来路径', async () => {
  const root = join(tmpdir(), 'qq-agent-conflict-status-');
  const foreign = join(tmpdir(), 'other-workspace', 'tools', 'napcat', 'node.exe');
  const service = new DesktopService(root, {
    ownerReader: async () => [foreign], secretReader: async () => '', systemReader: async () => [],
    listenerReader: async () => [
      { port: 6099, pid: 11, path: foreign },
      { port: 3001, pid: 12, path: foreign },
      { port: 445, pid: 13, path: 'C:\\Windows\\System32\\svchost.exe' },
    ],
  });
  const state = await service.status();
  assert.match(state.workspaceError, /其他工作区/);
  assert.deepEqual(state.conflict, { owners: [foreign], ports: [3001, 6099] });
  assert.ok(!JSON.stringify(state.conflict).includes('svchost'));
});

test('trim-ports 收紧入站监听：只保留 qq-agent 3001 并强制回环，出站不动', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-trim-')), events = [];
  const folder = join(root, 'tools', 'napcat', 'napcat', 'config');
  const before = {
    network: {
      httpServers: [{ name: 'legacy', port: 5000, host: '0.0.0.0', enable: true }],
      httpSseServers: [],
      websocketServers: [
        { name: 'qq-agent', port: 3001, host: '0.0.0.0', enable: true, token: 'keep-me' },
        { name: 'extra', port: 3002, host: '127.0.0.1', enable: true },
        { name: 'off', port: 3003, host: '127.0.0.1', enable: false },
      ],
      httpClients: [{ name: 'out', port: 9000, host: '0.0.0.0', enable: true }],
      websocketClients: [{ name: 'out2', port: 9001, enable: true }],
    },
  };
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'onebot11.json'), JSON.stringify(before));
    await writeFile(join(folder, 'onebot11_2.json'), JSON.stringify({ network: { websocketServers: [{ name: 'other', port: 3004, host: '::', enable: true }] } }));
    const service = new DesktopService(root, { ownerReader: async () => [], fetcher: async () => { throw new Error('本地 NapCat 未运行，不得发请求'); }, progress: payload => events.push(payload) });
    const result = await service.trimPorts();
    assert.deepEqual(result, {
      trimmed: [
        { name: 'legacy', port: 5000, action: 'disabled' },
        { name: 'qq-agent', port: 3001, action: 'loopback-only' },
        { name: 'extra', port: 3002, action: 'disabled' },
        { name: 'other', port: 3004, action: 'disabled' },
      ],
      restartRequired: true,
    });
    const after = JSON.parse(await readFile(join(folder, 'onebot11.json'), 'utf8'));
    assert.equal(after.network.websocketServers[0].enable, true); assert.equal(after.network.websocketServers[0].host, '127.0.0.1'); assert.equal(after.network.websocketServers[0].token, 'keep-me');
    assert.equal(after.network.websocketServers[1].enable, false);
    assert.equal(after.network.websocketServers[2].enable, false);
    assert.equal(after.network.httpServers[0].enable, false); assert.equal(after.network.httpServers[0].host, '127.0.0.1');
    assert.deepEqual(after.network.httpClients, before.network.httpClients); assert.deepEqual(after.network.websocketClients, before.network.websocketClients);
    assert.deepEqual(events.filter(event => event.step).map(event => event.step), ['read', 'configure']);
    assert.deepEqual(events.at(-1), { action: 'trim-ports', done: true, ok: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('trim-ports 在本机 NapCat 运行时自动 Process/Restart 并等待生效', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-trim-run-')), calls = [], urls = [];
  const folder = join(root, 'tools', 'napcat', 'napcat', 'config');
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'webui.json'), JSON.stringify({ token: 'PRIVATE_TOKEN' }));
    await writeFile(join(folder, 'onebot11.json'), JSON.stringify({ network: { websocketServers: [{ name: 'qq-agent', port: 3001, host: '0.0.0.0', enable: true }, { name: 'extra', port: 3002, enable: true }] } }));
    const service = new DesktopService(root, {
      ownerReader: async () => [],
      sessionCodec: { protect: async value => value, unprotect: async value => value },
      fetcher: async url => { urls.push(url); return { ok: true, json: async () => ({ code: 0, data: url.endsWith('auth/login') ? { Credential: 'CRED' } : {} }) }; },
      progress: payload => calls.push(payload),
    });
    const result = await service.trimPorts();
    assert.equal(result.restartRequired, true);
    assert.equal(result.trimmed.length, 2);
    assert.ok(urls.some(url => url.endsWith('Process/Restart')));
    assert.deepEqual(calls.map(event => event.step).filter(Boolean), ['read', 'configure', 'restart']);
    assert.deepEqual(calls.at(-1), { action: 'trim-ports', done: true, ok: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('status() 的 ports 数组区分必需、多余与外来占用，不列出范围外端口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-ports-'));
  const folder = join(root, 'tools', 'napcat', 'napcat', 'config');
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'onebot11.json'), JSON.stringify({
      network: {
        httpServers: [{ name: 'legacy', port: 5000, host: '127.0.0.1', enable: true }],
        websocketServers: [{ name: 'qq-agent', port: 3001, host: '127.0.0.1', enable: true }, { name: 'extra', port: 3002, host: '127.0.0.1', enable: true }, { name: 'off', port: 3003, enable: false }],
      },
    }));
    const foreign = join(tmpdir(), 'other-workspace', 'tools', 'napcat', 'node.exe');
    const service = new DesktopService(root, {
      ownerReader: async () => [], secretReader: async () => '', systemReader: async () => [],
      listenerReader: async () => [
        { port: 6099, pid: 1, path: join(root, 'tools', 'napcat', 'node.exe') },
        { port: 3001, pid: 2, path: foreign },
        { port: 5000, pid: 3, path: 'C:\\Other\\app.exe' },
        { port: 445, pid: 4, path: 'C:\\Windows\\System32\\svchost.exe' },
      ],
    });
    const state = await service.status();
    assert.deepEqual(state.ports, [
      { port: 6099, label: 'NapCat 面板', role: 'required', detail: '本工作区 NapCat 监听中' },
      { port: 3001, label: 'OneBot 连接', role: 'foreign', detail: `被外来进程占用：${foreign}` },
      { port: 6100, label: '管理接口', role: 'required' },
      { port: 3002, label: 'extra', role: 'extra', detail: '配置中仍启用的多余入站监听' },
      { port: 5000, label: 'legacy', role: 'foreign', detail: '被外来进程占用：C:\\Other\\app.exe' },
    ]);
    assert.ok(!state.ports.some(row => row.port === 445 || row.port === 3003));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('components 的 mimo 只暴露 Key 类型与匹配提示，绝不输出 Key 本身', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-agent-mimo-'));
  try {
    await mkdir(join(root, 'data'), { recursive: true });
    const pick = async (key, settings) => {
      await writeFile(join(root, 'data', 'settings.json'), JSON.stringify(settings));
      const service = new DesktopService(root, { ownerReader: async () => [], secretReader: async () => key, systemReader: async () => [], listenerReader: async () => [] });
      return (await service.status()).components.find(item => item.id === 'mimo');
    };
    const matched = await pick('sk-PRIVATE-KEY-123', { ai: { backend: 'mimo-api' }, speech: { baseURL: MIMO_API_BASE_URL } });
    assert.equal(matched.ok, true); assert.equal(matched.optional, true); assert.equal(matched.label, '小米 MiMo / Token Plan 组件');
    assert.match(matched.detail, /按量 API Key/); assert.match(matched.detail, /与所选模型后端、语音地址匹配/);
    assert.ok(!JSON.stringify(matched).includes('PRIVATE-KEY'));
    const plan = await pick('tp-PRIVATE-PLAN-456', { ai: { backend: 'mimo-token-plan-cn' }, speech: { baseURL: MIMO_TOKEN_PLAN_CN_BASE_URL } });
    assert.equal(plan.ok, true); assert.match(plan.detail, /Token Plan Key/); assert.match(plan.detail, /匹配/);
    assert.ok(!JSON.stringify(plan).includes('PRIVATE-PLAN'));
    const mismatch = await pick('sk-PRIVATE-KEY-123', { ai: { backend: 'codex' }, speech: { baseURL: MIMO_TOKEN_PLAN_CN_BASE_URL } });
    assert.match(mismatch.detail, /不匹配/); assert.ok(!JSON.stringify(mismatch).includes('PRIVATE-KEY'));
    const empty = await pick('', {});
    assert.equal(empty.ok, false);
    const broken = new DesktopService(root, { ownerReader: async () => [], secretReader: async () => { throw new Error('vault 不可用'); }, systemReader: async () => [], listenerReader: async () => [] });
    const failed = (await broken.status()).components.find(item => item.id === 'mimo');
    assert.equal(failed.ok, false); assert.match(failed.detail, /未配置/); assert.ok(!JSON.stringify(failed).includes('vault'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
