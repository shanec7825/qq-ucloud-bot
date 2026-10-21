import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, SettingsStore, validateSettings, modelEnv } from '../src/settings.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';
import { resolveGroupPolicy, profileSettings } from '../src/group-policy.mjs';
import { allowedRoute } from '../napcat-plugin/bridge.mjs';

async function fixture(run) {
  const folder = await mkdtemp(join(tmpdir(), 'workspace-test-')), root = pathToFileURL(folder + '/');
  const store = new SettingsStore(new URL('settings.json', root), {});
  try { await store.load(); await run({ root, store }); } finally { await rm(folder, { recursive: true, force: true }); }
}
const vault = { get: () => '', flags: () => ({}) };
const event = (group = '300000001', id = 1) => ({ post_type: 'message', message_type: 'group', group_id: group, self_id: '100000002', user_id: '100000003', message_id: id, message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'text', data: { text: '你好' } }] });
function configured() {
  const config = defaults({ ALLOWED_GROUPS: '300000001,300000002' });
  config.github.enabled = config.drive.enabled = config.school.enabled = false;
  config.profiles = [{ id: 'study', name: '学习助手', systemPrompt: '先给例子', model: 'profile-model' }];
  config.groups[0].profileId = 'study';
  return config;
}

test('version 1 settings migrate without losing names/model/permissions and reject dangling profiles', () => fixture(async ({ root }) => {
  const legacy = configured(); legacy.version = 1; delete legacy.profiles;
  for (const group of legacy.groups) delete group.profileId;
  await writeFile(new URL('legacy.json', root), JSON.stringify(legacy));
  const store = new SettingsStore(new URL('legacy.json', root), {}); await store.load();
  assert.equal(store.get().version, 3); assert.deepEqual(store.get().profiles, []);
  assert.equal(store.get().bot.name, legacy.bot.name); assert.equal(store.get().ai.model, legacy.ai.model);
  assert.equal(store.get().groups[0].enabled, true); assert.equal(store.get().groups[0].profileId, '');
  assert.equal(JSON.parse(await readFile(new URL('legacy.json', root))).version, 3);
  assert.deepEqual(JSON.parse(await readFile(new URL('legacy.v1.backup.json', root))), legacy);
  const malformed = configured(); delete malformed.profiles; assert.throws(() => validateSettings(malformed));
  for (const numericId of [0, 123]) {
    const numericProfile = configured(); numericProfile.profiles[0].id = numericId; numericProfile.groups[0].profileId = numericId;
    assert.throws(() => validateSettings(numericProfile), /方案无效/);
    const numericReference = configured(); numericReference.groups[0].profileId = numericId;
    assert.throws(() => validateSettings(numericReference), /方案必须存在/);
  }
  const invalid = configured(); invalid.profiles = []; assert.throws(() => validateSettings(invalid));
  const duplicate = configured(); duplicate.profiles.push(duplicate.profiles[0]); assert.throws(() => validateSettings(duplicate));
  assert.equal(modelEnv(profileSettings({ ...configured(), ai: { ...configured().ai, backend: 'api' } }, '300000001'), {}, {}).OPENAI_MODEL, 'profile-model');
}));

test('group profile changes actual model/name/prompt and memory scope; other group and private stay default', () => fixture(async ({ store, root }) => {
  await store.update(configured(), 0);
  const runtime = new BotRuntime(store, vault, { root }), calls = [], noteScopes = [];
  runtime.proxy.send = async () => []; runtime.members.prepare = async () => {}; runtime.media.prepare = async () => null;
  runtime.notes.context = async (_event, options) => { noteScopes.push(options.profileId); return []; };
  runtime.ai = async (_question, context, config) => { calls.push({ context, config }); return 'ok'; };
  runtime.apply();
  try {
    await runtime.handler(event()); await runtime.handler(event('300000002'));
    await runtime.handler({ ...event(), message_type: 'private', message_id: 3 });
    assert.deepEqual(calls.map(call => call.config.bot.name), ['学习助手', store.get().bot.name, store.get().bot.name]);
    assert.equal(calls[0].config.bot.systemPrompt, '先给例子'); assert.equal(calls[0].config.ai.model, 'profile-model');
    assert.match(calls[0].context.responseRules.join(), /你叫 学习助手/);
    assert.deepEqual(noteScopes, ['study', '', '']);
  } finally { runtime.stop(); }
}));

test('changing group profile while model runs cancels old answer and clears its conversation', () => fixture(async ({ store, root }) => {
  await store.update(configured(), 0);
  const runtime = new BotRuntime(store, vault, { root }), sent = [];
  runtime.proxy.send = async (_target, text) => sent.push(text); runtime.members.prepare = async () => {}; runtime.media.prepare = async () => null;
  let started, release; const ready = new Promise(resolve => { started = resolve; }), hold = new Promise(resolve => { release = resolve; });
  runtime.ai = async () => { started(); await hold; return 'old'; }; runtime.apply();
  try {
    const pending = runtime.handler(event()); await ready;
    const config = store.get(); config.groups[0].profileId = ''; await store.update(config, config.revision); runtime.apply();
    release(); await pending; assert.deepEqual(sent, []); assert.deepEqual(runtime.memory.get(event()), []);
    config.monitor.groups = ['300000001']; config.monitor.enabled = false;
    assert.equal(resolveGroupPolicy(config, '300000001').canReply, false);
  } finally { release?.(); runtime.stop(); }
}));

test('workspace/inbox use authenticated HTTP and status writes require CSRF and valid values', () => fixture(async ({ store, root }) => {
  await store.update(configured(), 0);
  const runtime = new BotRuntime(store, vault, { root });
  await mkdir(new URL('notices/', root), { recursive: true });
  const report = { id: 'report-1', groupId: '300000001', groupName: '课程', createdAt: new Date().toISOString(), items: [{ id: 'item-1', title: '任务', summary: '交作业', sources: [{ excerpt: '依据' }] }] };
  await writeFile(new URL('notices/reports.json', root), JSON.stringify([report]));
  const before = await readFile(new URL('notices/reports.json', root), 'utf8');
  const admin = await startAdmin({ store, vault, runtime, root, port: 0 }); let cookie, csrf;
  const call = (path, method = 'GET', value, token = csrf) => fetch(admin.origin + '/api/' + path, { method, headers: { cookie: cookie || '', origin: admin.origin, 'content-type': 'application/json', 'x-csrf-token': token || '' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  try {
    assert.equal((await call('workspace')).status, 401); assert.equal((await call('inbox')).status, 401);
    const login = await call('session', 'POST', { key: admin.accessKey }); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
    const workspace = await (await call('workspace')).json(); assert.equal(workspace.profiles[0].id, 'study'); assert.equal(workspace.groups[0].profileName, '学习助手');
    const inbox = await (await call('inbox')).json(); assert.equal(inbox.items.length, 1); const id = inbox.items[0].id;
    assert.equal((await call('inbox/item', 'PUT', { id, status: 'done' }, '')).status, 403);
    assert.equal((await call('inbox/item', 'PUT', { id, status: 'bad' })).status, 400);
    assert.equal((await call('inbox/item', 'PUT', { id, status: 'done' })).status, 200);
    assert.equal((await (await call('inbox')).json()).items[0].status, 'done');
    assert.equal(await readFile(new URL('notices/reports.json', root), 'utf8'), before);
    assert.equal(allowedRoute('GET', 'workspace'), true); assert.equal(allowedRoute('PUT', 'inbox/item'), true); assert.equal(allowedRoute('DELETE', 'inbox/item'), false);
  } finally { runtime.stop(); await admin.close(); }
}));
