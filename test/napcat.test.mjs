import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AdminBridge, allowedRoute, registerBridge } from '../napcat-plugin/bridge.mjs';
import { startAdmin } from '../src/admin-server.mjs';
import { SettingsStore } from '../src/settings.mjs';
import { trustSlyraPlugin } from '../napcat-plugin/local-trust.mjs';

test('local trust exception affects only slyra and retains sensitive-word restrictions', () => {
  const source = 'return this.isOfficialPlugin(e) ? null : r ? "blocked-keyword" : "blocked-unofficial";';
  const changed = trustSlyraPlugin(source), evaluate = Function('e', 'r', changed).bind({ isOfficialPlugin: id => id === 'official' });
  assert.equal(evaluate('official', true), null);
  assert.equal(evaluate('napcat-plugin-slyra', false), null);
  assert.equal(evaluate('napcat-plugin-slyra', true), 'blocked-keyword');
  assert.equal(evaluate('napcat-plugin-slyra-monitor', false), null);
  assert.equal(evaluate('napcat-plugin-slyra-monitor', true), 'blocked-keyword');
  assert.equal(evaluate('napcat-plugin-slyra-evil', false), 'blocked-unofficial');
  assert.equal(evaluate('untrusted', false), 'blocked-unofficial');
  assert.equal(trustSlyraPlugin(changed), changed); assert.throws(() => trustSlyraPlugin('unknown version'));
  const legacy = 'return this.isOfficialPlugin(e) || (e === "napcat-plugin-slyra" && !r) ? null : r ? "blocked-keyword" : "blocked-unofficial";';
  assert.equal(trustSlyraPlugin(legacy), changed);
});

test('NapCat bridge restricts methods and paths; never proxies arbitrary URLs or sessions', () => {
  for (const [method, path] of [['GET', 'state'], ['GET', 'monitor'], ['POST', 'monitor/run'], ['PUT', 'settings'], ['POST', 'check/drive'], ['DELETE', 'memory/notes/abc-123']]) assert.equal(allowedRoute(method, path), true);
  for (const [method, path] of [['GET', 'https://evil.test'], ['PUT', '../secrets'], ['POST', 'session'], ['GET', 'state?x=1'], ['__proto__', 'state'], ['GET', 'memory/notes/abc/../../state']]) assert.equal(allowedRoute(method, path), false);
});

test('NapCat authenticated router only; cross-origin calls rejected before bridge access', async () => {
  let handler, calls = 0;
  registerBridge({ router: { post: (path, fn) => { assert.equal(path, '/bridge'); handler = fn; } } }, { request: async () => { calls++; return { status: 200, data: { ok: true } }; } });
  const response = () => ({ code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } });
  const denied = response(); await handler({ headers: { host: '127.0.0.1:6099', origin: 'https://evil.test' }, body: {} }, denied);
  assert.equal(denied.code, 403); assert.equal(calls, 0);
  const accepted = response(); await handler({ headers: { host: '127.0.0.1:6099', origin: 'http://127.0.0.1:6099' }, body: { method: 'GET', path: 'state' } }, accepted);
  assert.equal(calls, 1); assert.deepEqual(accepted.data, { ok: true });
});

test('bridge logs in server-side, preserves save conflicts and hides bootstrap credential', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'slyra-napcat-test-')), root = pathToFileURL(folder + '/'); let admin;
  try {
    const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
    let monitorRuns = 0;
    const runtime = { status: async () => ({ qq: { connected: false } }), apply() {}, checks: {}, handler: { isBusy: () => false },
      monitor: { status: async () => ({ running: false, reports: [], state: {} }), run: async () => { monitorRuns++; return { status: 'disabled' }; } } };
    admin = await startAdmin({ store, runtime, vault: { flags: () => ({}) }, root, port: 0 });
    await mkdir(join(folder, 'data'));
    await writeFile(join(folder, 'data/admin-info.json'), JSON.stringify({ origin: admin.origin }));
    await writeFile(join(folder, 'data/admin-access.key'), admin.accessKey);
    const bridge = new AdminBridge(folder), session = await bridge.request('GET', 'session');
    assert.deepEqual(session.data, { csrf: 'napcat-session' }); assert.ok(!JSON.stringify(session).includes(admin.accessKey));
    const state = await bridge.request('GET', 'state'); assert.equal(state.status, 200);
    assert.equal((await bridge.request('GET', 'monitor')).data.running, false);
    assert.equal((await bridge.request('POST', 'monitor/run', {})).data.status, 'disabled'); assert.equal(monitorRuns, 1);
    assert.equal((await bridge.request('POST', 'monitor/run', { groupId: '../../private' })).status, 400); assert.equal(monitorRuns, 1);
    const value = state.data.settings; value.bot.name = 'NapCat 中的新名字';
    const result = await bridge.request('PUT', 'settings', { settings: value, revision: value.revision });
    assert.equal(result.status, 200); assert.equal(store.get().bot.name, value.bot.name);
    assert.equal((await bridge.request('PUT', 'settings', { settings: value, revision: value.revision })).status, 409);
    assert.equal((await bridge.request('GET', 'http://evil.test')).status, 400);
    await writeFile(new URL('napcat-ui.json', root), JSON.stringify({ origin: 'http://127.0.0.1:6099' }));
    await admin.close(); admin = await startAdmin({ store, runtime, vault: { flags: () => ({}) }, root, port: 0 });
    const redirect = await fetch(admin.origin + '/', { redirect: 'manual' });
    assert.equal(redirect.status, 303); assert.equal(redirect.headers.get('location'), 'http://127.0.0.1:6099/webui/extension#');
  } finally { await admin?.close(); await rm(folder, { recursive: true, force: true }); }
});

test('bridge refuses non-loopback origins before sending the internal key', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'slyra-napcat-origin-'));
  try {
    await mkdir(join(folder, 'data')); await writeFile(join(folder, 'data/admin-info.json'), JSON.stringify({ origin: 'https://evil.test' }));
    let calls = 0; const bridge = new AdminBridge(folder, () => { calls++; });
    await assert.rejects(() => bridge.request('GET', 'state'), /Invalid local origin/); assert.equal(calls, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
