import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { SettingsStore } from '../src/settings.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';

// Runs the real authenticated HTTP handler in process. Existing socket tests remain separate.
async function fixture(work) {
  const parent = new URL('../data/test-tmp/', import.meta.url); await mkdir(parent, { recursive: true });
  const path = await mkdtemp(fileURLToPath(new URL('product-api-', parent))), root = pathToFileURL(join(path, '/'));
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  const vault = { get: () => '', flags: () => ({}) }, runtime = new BotRuntime(store, vault, { root }); runtime.apply();
  const { server } = await startAdmin({ store, vault, runtime, root, port: 0 });
  const info = JSON.parse(await readFile(new URL('admin-info.json', root), 'utf8')), handler = server.listeners('request')[0];
  await new Promise(resolve => server.close(resolve));
  let cookie = '', csrf = '';
  async function request(method, route, value, authenticated = true, headers = {}) {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]);
    req.method = method; req.url = '/api/' + route; req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { host: new URL(info.origin).host, origin: info.origin, 'content-type': 'application/json', ...(authenticated ? { cookie, 'x-csrf-token': csrf } : {}), ...headers };
    const result = { status: 200, headers: {} }, res = { headersSent: false, setHeader(name, value) { result.headers[name] = value; }, writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); this.headersSent = true; }, end(value) { result.data = value ? JSON.parse(value) : null; }, destroy() { throw Error('unexpected response destroy'); } };
    await handler(req, res); return result;
  }
  const login = await request('POST', 'session', { key: (await readFile(new URL('admin-access.key', root), 'utf8')).trim() }, false);
  cookie = login.headers['set-cookie'].split(';')[0]; csrf = login.data.csrf;
  try { await work({ root, store, runtime, request }); } finally { runtime.stop(); await rm(path, { recursive: true, force: true }); }
}

test('chat API enforces auth/CSRF/revisions and exposes a small shared contact configuration', () => fixture(async ({ store, request }) => {
  assert.equal((await request('GET', 'chat', undefined, false)).status, 401);
  const current = (await request('GET', 'chat')).data;
  assert.equal(current.settings.chat.defaultMode, 'normal'); assert.equal(current.settings.memory, undefined);
  const input = { revision: current.settings.revision, defaultMode: 'normal', memoryContacts: [{ id: '123456', mode: 'memory', profileId: '' }] };
  assert.equal((await request('PUT', 'chat', input, true, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await request('PUT', 'chat', input)).status, 200);
  assert.equal(store.get().chat.memoryContacts[0].mode, 'memory');
  assert.equal((await request('PUT', 'chat', input)).status, 409);
  assert.equal((await request('PUT', 'chat', { ...input, revision: store.get().revision, recentLimit: 2000 })).status, 400);
}));

test('clear contact erases all user-visible memories and invalidates old tool scopes before they can refill', () => fixture(async ({ store, runtime, request }) => {
  const cfg = store.get(); cfg.bot.ownerQQ = '123456'; cfg.agent.enabled = true; cfg.chat.memoryContacts = [{ id: '123456', mode: 'memory', profileId: '' }]; await store.update(cfg, cfg.revision); runtime.apply();
  const event = { accountId: 'default', profileId: '', message_type: 'private', user_id: '123456' };
  runtime.memory.add(event, 'private history'); runtime.agentSessions.set('old', { observations: ['private tool history'] }); runtime.native.selections.set('old', { files: ['private file'] });
  const tools = runtime.agent(runtime.dependencies(event).memoryMode ? { ...runtime.config(), memory: { ...runtime.config().memory, enabled: true } } : runtime.config()).tools;
  const scope = tools.scope(event), before = runtime.dependencies(event).capabilities;
  const result = await request('DELETE', 'chat/memory', { contactId: '123456' }); assert.equal(result.status, 200);
  assert.deepEqual(runtime.memory.get(event), []); assert.equal(runtime.agentSessions.size, 0); assert.equal(runtime.native.selections.size, 0);
  assert.notEqual(runtime.dependencies(event).capabilities, before); assert.throws(() => tools.assertScope(event, scope));
}));

test('notifications become local tasks only after click; calendar API returns a draft and never sends a message', () => fixture(async ({ runtime, request }) => {
  runtime.proxy.send = () => { throw Error('QQ must not be used'); };
  await runtime.inbox.recordNotifications({ id: 'f'.repeat(32), groupId: '987654', groupName: '课程群', createdAt: '2026-10-23', outputFormat: 'detailed', items: [{ id: 'one', title: '提交代码', summary: 'const n = 1;', sources: [{ excerpt: '周五提交' }] }] });
  assert.equal((await request('GET', 'inbox')).data.items.length, 0);
  const notices = (await request('GET', 'notifications')).data; assert.equal(notices.groups[0].groupId, '987654'); assert.equal(notices.items[0].outputFormat, 'detailed');
  const id = notices.items[0].id; assert.equal((await request('POST', 'inbox/add', { id })).status, 200);
  const preview = await request('POST', 'inbox/calendar', { id, start: '2026-10-24', end: '2026-10-25', allDay: true }); assert.equal(preview.status, 200); assert.equal(preview.data.mode, 'preview'); assert.match(preview.data.description, /const n = 1/);
  assert.equal((await request('POST', 'inbox/calendar', { id, start: 'tomorrow' })).status, 400);
  assert.equal((await request('PUT', 'inbox/item', { id, status: 'done' })).status, 200);
}));

test('ChatGPT App detection distinguishes login, tool visibility and a real successful provider read', () => fixture(async ({ runtime, request }) => {
  runtime.account.status = async () => ({ loggedIn: true });
  runtime.connectors.readCatalog = async () => [{ name: 'github.list_repositories' }]; let reads = 0;
  runtime.native.github = async () => { reads++; return 'repositories'; };
  assert.equal((await request('GET', 'connectors/status')).data.providers.github.connected, false);
  assert.equal((await request('POST', 'connectors/check', { provider: 'github' })).data.ok, true); assert.equal(reads, 1);
  assert.equal((await request('GET', 'connectors/status')).data.providers.github.connected, true);
  assert.equal((await request('POST', 'connectors/check', { provider: 'gmail' })).status, 400);
}));
