import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateSettings } from '../src/settings.mjs';
import { migrateSettings } from '../src/settings-migrations.mjs';
import { resolveConversation, profileSettings, resolveGroupPolicy } from '../src/group-policy.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { ManagedMemory, memoryScope } from '../src/managed-memory.mjs';
import { BotRuntime } from '../src/runtime.mjs';
function config() {
  const value = defaults({ ALLOWED_GROUPS: '123456' });
  value.github.enabled = value.drive.enabled = value.school.enabled = false;
  value.profiles = [{ id: 'study', name: 'Study', systemPrompt: 'Study voice', model: 'study-model' }, { id: 'fun', name: 'Fun', systemPrompt: 'Fun voice', model: '' }];
  value.accounts.push({ id: 'other', name: 'Other', enabled: true, url: 'ws://127.0.0.1:3002', defaultProfileId: 'fun' });
  value.bindings.push({ id: 'one', accountId: 'other', kind: 'group', targetId: '123456', profileId: 'study', enabled: true });
  return value;
}
const event = (accountId = 'other', kind = 'group') => ({ accountId, message_type: kind, group_id: '123456', user_id: '234567', self_id: '345678' });
test('v2 migration is additive and account/persona references are validated', () => {
  const old = defaults(); old.version = 2; delete old.accounts; delete old.bindings;
  const migrated = migrateSettings(old); assert.equal(old.version, 2); assert.equal(migrated.version, 3); assert.equal(migrated.accounts[0].id, 'default');
  assert.equal(validateSettings(config()).version, 3);
  for (const change of [v => v.accounts.pop(), v => v.profiles.pop(), v => v.bindings.push({ ...v.bindings[0], id: 'duplicate' }), v => v.accounts[1].url = 'ws://remote.invalid:3001']) {
    const value = config(); change(value); assert.throws(() => validateSettings(value));
  }
});
test('binding then account default then legacy group select persona without sharing group permissions', () => {
  const value = config();
  assert.equal(resolveConversation(value, event()).profileId, 'study');
  assert.equal(resolveConversation(value, event('other', 'private')).profileId, 'fun');
  assert.equal(profileSettings(value, '123456', 'other').bot.name, 'Study');
  assert.equal(resolveGroupPolicy(value, '999999', 'other').canReply, false);
  value.bindings[0].enabled = false; assert.equal(resolveGroupPolicy(value, '123456', 'other').canReply, false);
  assert.equal(resolveGroupPolicy(value, '123456').canReply, true);
  value.bindings.push({ id: 'default-binding', accountId: 'default', kind: 'group', targetId: '123456', profileId: 'study', enabled: true });
  value.groups[0].enabled = false; assert.equal(resolveGroupPolicy(value, '123456').canReply, false);
});
test('RAM and managed notes isolate equal QQ numbers across accounts and personas', async () => {
  const memory = new ConversationMemory(), a = { ...event(), profileId: 'study' }, b = { ...a, accountId: 'default' }, c = { ...a, profileId: 'fun' };
  memory.add(a, 'secret'); assert.equal(memory.get(b).length, 0); assert.equal(memory.get(c).length, 0);
  const notes = new ManagedMemory(); notes.list = async () => [
    { scope: 'global', enabled: true, text: 'legacy' }, { scope: 'profile:study', enabled: true, text: 'old profile' },
    { scope: 'account:other:profile:study', enabled: true, text: 'persona' },
    { scope: 'account:other:profile:study:group:123456', enabled: true, text: 'group' },
  ];
  assert.deepEqual((await notes.context(a)).map(n => n.text), ['persona', 'group']);
  assert.deepEqual(await notes.context(c), []);
  assert.deepEqual((await notes.context(b)).map(n => n.text), ['old profile']);
  assert.equal(memoryScope('account:other:profile:study:group:123456'), 'account:other:profile:study:group:123456');
  assert.throws(() => memoryScope('account:other:profile:study:group:bad'));
});
test('transport closures route replies, reject forged account/self identities, and invalidate closed callbacks', async () => {
  const value = config(), bots = [];
  const runtime = new BotRuntime({ get: () => structuredClone(value) }, { get: key => key.startsWith('onebotToken') ? 'token' : '' }, {
    botFactory: (url, token, receive) => { const bot = { url, receive, sent: [], connect() {}, close() { this.closed = true; }, send(target, text) { this.sent.push({ target, text }); return []; }, call: async () => [] }; bots.push(bot); return bot; },
  });
  const received = []; runtime.handler = async e => received.push(e); runtime.apply();
  await bots[1].receive({ ...event(), accountId: 'default', post_type: 'message' });
  assert.equal(received[0].accountId, 'other'); assert.equal(received[0].profileId, 'study');
  await runtime.proxy.send({ accountId: 'other', user_id: '234567' }, 'reply'); assert.equal(bots[0].sent.length, 0); assert.equal(bots[1].sent.length, 1);
  await bots[0].receive({ ...event(), post_type: 'message' }); assert.equal(received.length, 1);
  value.accounts[1].enabled = false; runtime.apply(); await bots[1].receive({ ...event(), self_id: '456789' }); assert.equal(received.length, 1);
  runtime.stop();
});

test('queued messages are cancelled when their captured persona changes', async () => {
  const value = config(), bots = [];
  const runtime = new BotRuntime({ get: () => structuredClone(value) }, { get: key => key.startsWith('onebotToken') ? 'token' : '' }, {
    botFactory: (url, token, receive) => { const bot = { receive, sent: [], connect() {}, close() {}, send(target, text) { this.sent.push(text); return []; }, call: async () => [] }; bots.push(bot); return bot; },
  });
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  runtime.ai = async () => { calls++; started(); await blocked; return 'study answer'; };
  runtime.catalog.list = async () => 'no tasks';
  runtime.apply();
  const incoming = id => ({ ...event(), post_type: 'message', message_id: id, message: [{ type: 'at', data: { qq: '345678' } }, { type: 'text', data: { text: 'hello' } }] });
  const first = bots[1].receive(incoming('first'));
  await entered;
  const second = bots[1].receive(incoming('second'));
  value.bindings[0].profileId = 'fun'; runtime.apply();
  release(); await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(bots[1].sent, []);
  assert.deepEqual(runtime.memory.list(), []);
  runtime.stop();
});

test('settings update reconciles default connection aliases and validates Drive permissions', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { SettingsStore } = await import('../src/settings.mjs');
  const root = await mkdtemp(join(process.cwd(), '.accounts-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(pathToFileURL(join(root, 'settings.json')), {});
  let value = await store.load();
  value.accounts[0].url = 'ws://127.0.0.1:3003'; value = await store.update(value, value.revision);
  assert.equal(value.qq.url, value.accounts[0].url);
  value.qq.url = 'ws://127.0.0.1:3004'; value = await store.update(value, value.revision);
  assert.equal(value.qq.url, value.accounts[0].url);
  const conflict = structuredClone(value); conflict.qq.url = 'ws://127.0.0.1:3005'; conflict.accounts[0].url = 'ws://127.0.0.1:3006';
  await assert.rejects(store.update(conflict, value.revision), /连接地址不一致/);
  delete value.drive.accessMode;
  assert.equal(validateSettings(value).drive.accessMode, 'read');
  value.drive.accessMode = 'write'; assert.equal(validateSettings(value).drive.accessMode, 'write');
  value.drive.accessMode = 'invalid'; assert.throws(() => validateSettings(value));
});
