import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkspace, validateWorkspacePath, mergeOneBot, quickLoginConfig, DesktopService } from '../src/desktop-service.mjs';

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
    const service = new DesktopService(root, { sessionCodec: { protect: async value => value, unprotect: async value => value }, fetcher: async (url, options) => {
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
    for (let i = 0; i < 15; i++) assert.equal(await new DesktopService(root, { fetcher, sessionCodec }).session(), 'PRIVATE_SESSION');
    assert.equal(logins, 1); revoked = true;
    assert.equal(await new DesktopService(root, { fetcher, sessionCodec }).session(), 'PRIVATE_SESSION'); assert.equal(logins, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
