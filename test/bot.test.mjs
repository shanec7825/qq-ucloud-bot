import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseJSON, normalizeTasks, deadlineMs, notificationPlan, commandFromEvent, saveJSON, readJSON, SchoolClient, askAI } from '../src/core.mjs';
import { OneBot } from '../src/onebot.mjs';

const task = { id: '1234567890123456789', title: '作业', course: '网络', type: 3, deadline: '2026-10-20 23:59:00' };

test('数字 ID 保留精度；学校正常响应及异常响应分开处理', () => {
  const json = parseJSON('{"success":true,"code":200,"data":{"undoneList":[{"activityId":1234567890123456789,"activityName":"作业","type":3}]}}');
  assert.equal(normalizeTasks(json)[0].id, task.id);
  assert.throws(() => normalizeTasks({ success: false }), /拒绝/);
  assert.throws(() => normalizeTasks({ data: {} }), /格式变化/);
  assert.deepEqual(normalizeTasks({ data: { undoneList: [] } }), []);
});

test('截止时间不受宿主时区影响', () => {
  assert.equal(deadlineMs(task.deadline), Date.parse('2026-10-20T15:59:00Z'));
  assert.ok(Number.isNaN(deadlineMs(null)));
});

test('首次建立基线；成功发送后不重复；失败保留重试', () => {
  const now = deadlineMs(task.deadline) - 2 * 3600000;
  const state = { initialized: false, known: [], sent: {} };
  assert.equal(notificationPlan([task], state, now).length, 1);
  state.initialized = true;
  const pending = notificationPlan([task], state, now);
  assert.equal(pending.length, 2);
  assert.deepEqual(notificationPlan([task], state, now), pending);
  state.sent[pending[0].key] = true;
  assert.equal(notificationPlan([task], state, now).length, 1);
  state.sent[pending[1].key] = true;
  assert.equal(notificationPlan([task], state, now).length, 0);
  assert.equal(notificationPlan([task], { ...state, known: [task.id] }, deadlineMs(task.deadline) + 1).length, 0);
  assert.equal(notificationPlan([task], state, deadlineMs(task.deadline) - 1000).length, 1);
});

test('公开命令可接收他人消息；群聊必须同时在白名单并 @机器人', () => {
  const event = { post_type: 'message', message_type: 'private', user_id: 10001, self_id: 20002, message: [{ type: 'text', data: { text: '/作业' } }] };
  assert.equal(commandFromEvent(event, '10001'), '/作业');
  assert.equal(commandFromEvent(event, '99999'), '/作业');
  event.message_type = 'group'; event.group_id = 30003;
  assert.equal(commandFromEvent(event, '10001', ['30003']), null);
  event.message.unshift({ type: 'at', data: { qq: 20002 } });
  assert.equal(commandFromEvent(event, '10001', []), null);
  assert.equal(commandFromEvent(event, '10001', ['30003']), '/作业');
});

test('真实客户端调用形状、登录态重载、白名单请求头与失效报错', async () => {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('../data/bupt-bot-test-', import.meta.url)));
  const file = pathToFileURL(join(dir, 'session.json'));
  try {
    await saveJSON(file, { userId: task.id, headers: { 'blade-auth': 'fake', authorization: 'Basic fake', cookie: 'must-not-send' } });
    assert.equal((await readJSON(file)).userId, task.id);
    let calls = 0;
    const school = new SchoolClient(file, async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://apiucloud.bupt.edu.cn');
      assert.equal(url.searchParams.get('userId'), task.id);
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.redirect, 'error');
      return new Response('{"success":true,"data":{"undoneList":[]}}');
    });
    assert.deepEqual(await school.tasks(), []);
    assert.equal(calls, 1);
    const expired = new SchoolClient(file, async () => new Response('', { status: 401 }));
    await assert.rejects(() => expired.tasks(), /失效/);
    await assert.rejects(() => school.detail('1&evil=2'), /数字/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OpenAI 兼容请求使用可配置地址和模型；不发送学校凭据', async () => {
  const env = { OPENAI_API_KEY: 'fake', OPENAI_MODEL: 'test-model', OPENAI_BASE_URL: 'https://example.com/v1/' };
  const answer = await askAI('安排一下', [task], env, async (url, options) => {
    assert.equal(url.href, 'https://example.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2);
    assert.ok(!options.body.includes('blade-auth'));
    return Response.json({ choices: [{ message: { content: '先做网络作业' } }] });
  });
  assert.equal(answer, '先做网络作业');
  await assert.rejects(() => askAI('x', [], {}), /配置/);
  await assert.rejects(() => askAI('x', [], { ...env, OPENAI_BASE_URL: 'http://example.com' }), /HTTPS/);
});

test('OneBot 请求关联 echo，发送纯文本，API 失败可见', async () => {
  const bot = new OneBot('ws://127.0.0.1:3001', 'fake', () => {});
  assert.equal(bot.url.searchParams.get('access_token'), 'fake');
  bot.socket = { readyState: WebSocket.OPEN, send(raw) {
    const request = JSON.parse(raw);
    assert.equal(request.action, 'send_private_msg');
    assert.equal(request.params.message[0].type, 'text');
    const p = bot.pending.get(request.echo);
    clearTimeout(p.timer); bot.pending.delete(request.echo); p.resolve({ message_id: 1 });
  } };
  await bot.send({ user_id: '10001' }, '[CQ:at,qq=all]');
  bot.socket.readyState = WebSocket.CLOSED;
  await assert.rejects(() => bot.send({ user_id: '10001' }, 'x'), /未连接/);
});

test('OneBot 接收 API 确认与拒绝，并在断线时拒绝在途请求', async () => {
  const NativeSocket = globalThis.WebSocket;
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    responseCode = 0;
    send(raw) {
      const { echo } = JSON.parse(raw);
      if (this.responseCode === null) return;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ echo, status: this.responseCode === 0 ? 'ok' : 'failed', retcode: this.responseCode, data: { message_id: 99 } }),
      })));
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  let bot;
  try {
    globalThis.WebSocket = FakeSocket;
    bot = new OneBot('ws://127.0.0.1:3001', 'fake', () => {});
    bot.connect(); bot.socket.dispatchEvent(new Event('open'));
    assert.equal((await bot.call('send_private_msg', {})).message_id, 99);
    bot.socket.responseCode = 100;
    await assert.rejects(() => bot.call('send_private_msg', {}), /retcode=100/);
    bot.socket.responseCode = null;
    const pending = bot.call('send_private_msg', {});
    bot.close();
    await assert.rejects(() => pending, /断开/);
    assert.equal(bot.pending.size, 0);
  } finally { bot?.close(); globalThis.WebSocket = NativeSocket; }
});
