import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { defaults, validateSettings, SettingsStore, modelEnv } from '../src/settings.mjs';
import { SecretVault } from '../src/secret-vault.mjs';
import { ManagedMemory } from '../src/managed-memory.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';
import { GoogleDrive, DRIVE_SCOPE } from '../src/google-drive.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';

// This codec isolates persistence/API tests from platform DPAPI availability.
const codec = { protect: value => Buffer.from(value).toString('base64'), unprotect: value => Buffer.from(value, 'base64').toString('utf8') };
async function sandbox(run) {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('../data/admin-test-', import.meta.url))), root = pathToFileURL(join(folder, '/'));
  try { await run(root); } finally { await rm(folder, { recursive: true, force: true }); }
}
test('通用默认配置不含个人账号，迁移环境并拒绝危险地址、重复群、未知字段和并发覆盖', () => sandbox(async root => {
  const fresh = defaults({}); assert.equal(fresh.bot.name, 'Qlyra'); assert.equal(fresh.bot.ownerQQ, ''); assert.deepEqual(fresh.groups, []);
  const migrated = defaults({ OWNER_QQ: '100000001', ALLOWED_GROUPS: '300000001, 300000002', GROUP_HISTORY_MODEL_GROUPS: '300000002' });
  assert.equal(migrated.groups[1].historyEnabled, true);
  for (const change of [c => c.qq.url = 'ws://evil.test:3001', c => c.ai.baseURL = 'http://evil.test/v1', c => c.groups.push(...migrated.groups, ...migrated.groups), c => c.bot.extra = 'unexpected']) {
    const config = defaults({}); change(config); assert.throws(() => validateSettings(config));
  }
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  const first = store.get(), second = store.get(); first.bot.name = '测试机器人';
  await store.update(first, 0); await assert.rejects(() => store.update(second, 0), /其他页面更新/);
  const reloaded = new SettingsStore(new URL('settings.json', root), { BOT_NAME: '旧环境名' }); await reloaded.load();
  assert.equal(reloaded.get().bot.name, '测试机器人'); assert.equal(modelEnv(reloaded.get(), {}, {}).BOT_NAME, '测试机器人');
}));

test('密钥留空兼容已有环境、显式清除阻止回退，落盘不存原值，公开读取只有配置状态', () => sandbox(async root => {
  const vault = new SecretVault(root, { ONEBOT_ACCESS_TOKEN: 'legacy-private-token' }, codec); await vault.load();
  assert.equal(vault.get('onebotToken'), 'legacy-private-token');
  await vault.set({ githubToken: 'new-private-token', onebotToken: null });
  assert.equal(vault.get('onebotToken'), null); assert.equal(vault.flags().githubToken, true);
  assert.ok(!(await readFile(new URL('secrets.enc.json', root), 'utf8')).includes('new-private-token'));
  const reload = new SecretVault(root, { ONEBOT_ACCESS_TOKEN: 'legacy-private-token' }, codec); await reload.load();
  assert.equal(reload.get('githubToken'), 'new-private-token'); assert.equal(reload.get('onebotToken'), null);
  await assert.rejects(() => vault.set({ file: '/tmp/not-allowed' }), /字段无效/);
}));

test('网页设置经真实 HTTP 保存后用于 QQ 请求；跨站、伪 Host、未登录和缺少 CSRF 均拒绝', () => sandbox(async root => {
  const store = new SettingsStore(new URL('settings.json', root), { OWNER_QQ: '100000001', ALLOWED_GROUPS: '300000001' }); await store.load();
  const config = store.get(); config.school.enabled = false; await store.update(config, config.revision);
  const vault = new SecretVault(root, {}, codec); await vault.load(); await vault.set({ onebotToken: 'fake-qq-token', githubToken: 'fake-github-private-token' });
  const sent = [], requests = [];
  class FakeBot {
    constructor(_url, _token, onEvent) { this.onEvent = onEvent; this.socket = { readyState: 0 }; }
    connect() { this.socket.readyState = 1; }
    close() { this.socket.readyState = 3; }
    async send(target, text) { sent.push({ target, text }); }
    async call(action) { if (action === 'get_group_list') return [{ group_id: 300000001, group_name: '<script>literal</script>' }]; throw new Error('Unexpected QQ API'); }
  }
  const runtime = new BotRuntime(store, vault, { root, botFactory: (...args) => new FakeBot(...args) });
  runtime.ai = async (_q, context, config) => { requests.push({ context, config }); return config.bot.name + ':' + config.bot.systemPrompt; };
  await runtime.start(); const admin = await startAdmin({ store, vault, runtime, root, port: 0 });
  let cookie, csrf;
  const call = (path, method = 'GET', input, extra = {}) => fetch(admin.origin + '/api/' + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin: admin.origin, 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) } : {}), ...extra }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
  try {
    assert.equal((await call('state')).status, 401);
    assert.equal((await call('session', 'POST', { key: admin.accessKey }, { origin: 'https://evil.test' })).status, 403);
    const login = await call('session', 'POST', { key: admin.accessKey }); cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); csrf = (await login.json()).csrf;
    const forgedHost = await new Promise((resolve, reject) => { const request = httpRequest(admin.origin + '/api/state', { headers: { host: 'evil.test', cookie } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(); });
    assert.equal(forgedHost, 403);
    assert.equal((await call('state', 'GET', undefined, { origin: 'https://evil.test' })).status, 403);
    assert.equal((await call('settings', 'PUT', {}, { 'x-csrf-token': '' })).status, 403);
    const publicData = await (await call('state')).json(); assert.equal(publicData.secrets.githubToken, true); assert.ok(!JSON.stringify(publicData).includes('fake-github-private-token'));
    const next = publicData.settings; next.bot.name = '星羽'; next.bot.systemPrompt = '先讲例子，再给定义。'; next.groups.push({ id: '300000002', name: '第二个群', enabled: true, historyEnabled: false });
    assert.equal((await call('settings', 'PUT', { settings: next, revision: next.revision })).status, 200);
    assert.equal((await call('settings', 'PUT', { settings: next, revision: next.revision })).status, 409);
    const event = { post_type: 'message', message_type: 'group', group_id: '300000002', self_id: '100000002', user_id: '100000003', message_id: 1, message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'text', data: { text: '你好' } }] };
    await runtime.handler(event); assert.equal(sent[0].text, '星羽:先讲例子，再给定义。'); assert.equal(requests[0].config.bot.name, '星羽');
    await runtime.handler({ ...event, message_id: 2, message: [{ type: 'text', data: { text: '未@' } }] }); assert.equal(requests.length, 1);
    await runtime.notes.put({ scope: 'private:100000001', text: 'OWNER_PRIVATE_NOTE' }); await runtime.notes.put({ scope: 'group:300000001', text: 'OTHER_GROUP_NOTE' });
    await runtime.handler({ ...event, message_id: 3 }); assert.ok(!JSON.stringify(requests.at(-1).context).includes('PRIVATE_NOTE')); assert.ok(!JSON.stringify(requests.at(-1).context).includes('OTHER_GROUP_NOTE'));
    const ordinaryMemory = await (await call('memory')).json(); assert.ok(!ordinaryMemory.conversations.some(c => c.scope === 'group:300000002'));
    const memoryConfig = (await (await call('state')).json()).settings;
    memoryConfig.chat.memoryContacts = [{ id: event.user_id, mode: 'memory', profileId: '' }];
    assert.equal((await call('settings', 'PUT', { settings: memoryConfig, revision: memoryConfig.revision })).status, 200);
    await runtime.handler({ ...event, message_id: 4 });
    const memory = await (await call('memory')).json(); assert.ok(memory.conversations.some(c => c.scope === 'group:300000002'));
    assert.equal((await call('memory/conversations', 'DELETE', { scope: 'group:300000002' })).status, 200); assert.equal(runtime.memory.get(event).length, 0);
    const before = await readFile(new URL('settings.json', root), 'utf8'); assert.ok(!before.includes('fake-qq-token'));
  } finally { runtime.stop(); await admin.close(); }
}));

test('长期记忆按群与私聊隔离，摘要清空不重置历史调用配额', () => sandbox(async root => {
  const notes = new ManagedMemory(root);
  const common = await notes.put({ scope: 'global', text: '共享规则' }); await notes.put({ scope: 'private:100000001', text: 'PRIVATE_NOTE' }); await notes.put({ scope: 'group:300000001', text: '本群内容' });
  assert.deepEqual((await notes.context({ message_type: 'group', group_id: '300000001' })).map(n => n.text), ['共享规则', '本群内容']);
  assert.deepEqual((await notes.context({ message_type: 'group', group_id: '300000002' })).map(n => n.text), ['共享规则']);
  await notes.put({ ...common, text: '已编辑' }); await notes.remove(common.id); assert.equal((await notes.list()).length, 2);
  await notes.saveDigest('300000001', '摘要'); await notes.saveDigest('300000001', ''); assert.equal((await notes.digest('300000001')).summary, '');
  assert.throws(() => notes.digestFile('../outside')); await assert.rejects(() => notes.put({ scope: 'private:../bad', text: 'x' }));
}));

test('Google OAuth 固定只读权限、PKCE、单次 state 与会话绑定，自动续期不泄露凭据', async () => {
  const values = { googleClientSecret: 'test-client-secret' }, calls = [];
  const config = defaults({}); config.drive.clientId = 'test.apps.googleusercontent.com';
  const vault = { get: key => values[key], set: async patch => Object.assign(values, patch) };
  const google = new GoogleDrive({ settings: () => config, vault, now: () => 1000, fetcher: async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: DRIVE_SCOPE }); } });
  const begun = google.begin('http://127.0.0.1:6100', 'admin-session'), url = new URL(begun.url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPE); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.ok(!begun.url.includes('test-client-secret'));
  await assert.rejects(() => google.complete('bad-state', 'code', () => true), /过期/); assert.equal(calls.length, 0);
  await google.complete(state, 'test-code', session => session === 'admin-session'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token'); assert.equal(calls[0].options.redirect, 'error'); assert.ok(calls[0].options.body.get('code_verifier'));
  await assert.rejects(() => google.complete(state, 'test-code', () => true), /过期/);
  assert.equal(await google.accessToken(), 'test-access');
  const token = JSON.parse(values.googleTokens); token.expires = 0; values.googleTokens = JSON.stringify(token);
  assert.deepEqual(await Promise.all([google.accessToken(), google.accessToken()]), ['test-access', 'test-access']); assert.equal(calls.length, 2);
  config.drive.clientId = 'other.apps.googleusercontent.com'; await assert.rejects(() => google.accessToken(), /客户端已改变/);
});

test('在途请求遇到群权限撤销不发言；清空上下文不会被较早的回答重新填回', async () => {
  for (const revoke of [true, false]) {
    let release, started, allowed = ['300000001']; const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
    const memory = new ConversationMemory(), sent = [];
    const handler = createMessageHandler({ memory, bot: { send: async (_target, text) => sent.push(text) }, getDependencies: () => ({ groups: allowed, owner: '100000001', ai: async () => { started(); await wait; return '较早的回答'; }, catalog: { list: async () => '无作业' }, persona: async () => ({ voice: [] }) }) });
    const event = { post_type: 'message', message_type: 'group', group_id: '300000001', user_id: '100000003', self_id: '100000002', message_id: 1, message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'text', data: { text: '你好' } }] };
    const request = handler(event); await entered;
    if (revoke) allowed = [];
    memory.clear('group:300000001'); release(); await request;
    assert.equal(sent.length, revoke ? 0 : 1); assert.equal(memory.get(event).length, 0);
  }
});
