import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/settings.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { OneBot } from '../src/onebot.mjs';

function fixture(t) {
  const config = defaults();
  config.github.enabled = config.drive.enabled = config.school.enabled = config.speech.enabled = false;
  config.accounts.push({ id: 'other', name: 'Other', enabled: true, url: 'ws://127.0.0.1:3002', defaultProfileId: '' });
  const bots = [];
  const runtime = new BotRuntime({ get: () => structuredClone(config) }, { get: key => key.startsWith('onebotToken') ? 'test-token' : '' }, {
    botFactory: (_url, _token, receive, lifecycle) => {
      const bot = { receive, lifecycle, sent: [], connect() {}, close() {}, call: async () => [],
        send(target, text) { this.sent.push({ target, text }); return []; } };
      bots.push(bot); return bot;
    },
  });
  runtime.apply(); t.after(() => runtime.stop());
  return { runtime, bots };
}

const incoming = (selfId, messageId = 1) => ({ post_type: 'message', message_type: 'private', self_id: selfId,
  user_id: '234567', message_id: messageId, message: [{ type: 'text', data: { text: '你好，只用文字回答' } }] });

test('reconnecting adopts the logged-in QQ while retaining identity guards within each connection', async t => {
  const { runtime, bots } = fixture(t), received = [];
  runtime.handler = async event => { received.push(event); };
  bots[0].lifecycle.onConnect();
  await bots[0].receive(incoming('345678'));
  const oldEvent = received[0];
  await bots[0].receive(incoming('456789', 2));
  assert.equal(received.length, 1, 'a different self ID on the same connection is rejected');
  bots[1].lifecycle.onConnect();
  await bots[1].receive(incoming('567890'));
  runtime.memory.add(oldEvent, 'old account context');
  runtime.memory.add(received[1], 'other account context');
  bots[0].lifecycle.onConnect();
  assert.equal(runtime.dependencies(oldEvent).enabled, false, 'old work is revoked before any new message');
  await bots[0].receive(incoming('567890', 3));
  assert.equal(received.length, 2, 'another configured account cannot claim an existing QQ');
  await bots[0].receive(incoming('456789', 4));
  assert.equal(received.length, 3);
  assert.equal(runtime.selfIds.get('default'), '456789');
  assert.notEqual(received[2].transportGeneration, oldEvent.transportGeneration);
  assert.equal(runtime.dependencies(received[2]).enabled, true);
  assert.deepEqual(runtime.memory.get(oldEvent), []);
  assert.equal(runtime.memory.get(received[1]).length, 1, 'other accounts keep their context');
});

test('switching QQ cancels an in-flight reply and accepts a reused message ID from the new identity', async t => {
  const { runtime, bots } = fixture(t);
  runtime.media.prepare = async () => null;
  runtime.members.prepare = async () => {};
  let started, release;
  const ready = new Promise(resolve => { started = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let calls = 0;
  runtime.ai = async () => { if (++calls === 1) { started(); await hold; return '旧身份回复'; } return '新身份回复'; };
  bots[0].lifecycle.onConnect();
  const first = bots[0].receive(incoming('345678'));
  await ready;
  bots[0].lifecycle.onConnect();
  const second = bots[0].receive(incoming('456789'));
  release(); await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.deepEqual(bots[0].sent.map(row => row.text), ['新身份回复']);
});

test('OneBot reports each connection before messages and ignores events from retired sockets', async t => {
  const NativeSocket = globalThis.WebSocket;
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FakeSocket;
  const seen = [];
  const bot = new OneBot('ws://127.0.0.1:3001', 'test-token', event => seen.push(event.self_id), { onConnect: () => seen.push('connected') });
  t.after(() => { bot.close(); globalThis.WebSocket = NativeSocket; });
  const message = id => new MessageEvent('message', { data: JSON.stringify(incoming(id)) });
  bot.connect(); const first = bot.socket;
  first.dispatchEvent(new Event('open'));
  first.dispatchEvent(message('345678'));
  first.close(); const retiredRetry = bot.retry; clearTimeout(retiredRetry);
  bot.connect(); const second = bot.socket;
  second.dispatchEvent(new Event('open'));
  first.dispatchEvent(message('345678'));
  first.dispatchEvent(new Event('open'));
  first.dispatchEvent(new Event('close'));
  second.dispatchEvent(message('456789'));
  assert.deepEqual(seen, ['connected', '345678', 'connected', '456789']);
  assert.equal(bot.retry, retiredRetry, 'a retired socket must not schedule another reconnect');
});
