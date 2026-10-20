import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { HistoryDigest, digestSamples } from '../src/history-digest.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { ConversationMemory } from '../src/persona.mjs';

const groupId = '300000001';
const fixture = n => ({ chatInfo: { selfUin: '100000002' }, messages: Array.from({ length: n }, (_, id) => ({ id: String(id), sender: { uin: '10001', name: 'DO_NOT_SEND_NAME' }, content: { text: '群里的学习话题 ' + id } })) });
async function sandbox(run) {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('../data/digest-test-', import.meta.url)));
  try { await run(pathToFileURL(join(dir, '/') )); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('未 @ 的所有消息类型均不调用 AI、下载、历史或发送回复', async () => {
  const calls = [];
  const record = name => async () => { calls.push(name); return ''; };
  const handler = createMessageHandler({ groups: [groupId], owner: '100000001', memory: new ConversationMemory(), bot: { send: record('send') }, ai: record('ai'), media: { prepare: record('media') }, history: { context: record('history') } });
  for (const [id, type] of ['text', 'image', 'face', 'mface', 'record', 'video', 'reply', 'forward', 'file', 'json'].entries()) await handler({ post_type: 'message', message_type: 'group', group_id: groupId, user_id: 10001, self_id: 100000002, message_id: id, message: [{ type, data: { text: '群聊历史' } }] });
  assert.deepEqual(calls, []); assert.equal(handler.isBusy(), false);
});
test('历史导出每24小时一次；样本少、没有新增都不调用模型', async () => sandbox(async root => {
  let now = 0, count = 3, exports = 0, calls = 0;
  const digest = new HistoryDigest({ root, now: () => now, exporter: { export: async () => { exports++; return fixture(count); } }, ai: async (_question, context) => { calls++; assert.ok(!JSON.stringify(context).includes('DO_NOT_SEND_NAME')); assert.ok(context.samples.length <= 300); assert.ok(context.samples.join('').length <= 12000); return '{"summary":"本群主要讨论学习，表达自然。"}'; } });
  assert.equal((await digest.tick([groupId]))[0].modelCalls, 0);
  assert.equal((await digest.tick([groupId]))[0].status, 'not_due'); assert.equal(exports, 1);
  now += 86400000; count = 20;
  assert.equal((await digest.tick([groupId]))[0].status, 'updated'); assert.equal(calls, 1);
  assert.match((await digest.context(groupId)).summary, /学习/); assert.equal(await digest.context('999999'), null);
  now += 86400000;
  assert.equal((await digest.tick([groupId]))[0].status, 'unchanged'); assert.equal(calls, 1);
}));
test('失败的模型调用也计数，同一天不重试；样本移除发送者和机器人消息', async () => sandbox(async root => {
  let calls = 0;
  const digest = new HistoryDigest({ root, now: () => 0, exporter: { export: async () => fixture(20) }, ai: async () => { calls++; throw new Error('offline'); } });
  assert.equal((await digest.tick([groupId]))[0].modelCalls, 1);
  assert.equal((await digest.tick([groupId]))[0].status, 'not_due'); assert.equal(calls, 1);
  const data = fixture(1); data.messages.push({ id: 'bot', sender: { uin: '100000002' }, content: { text: 'bot' } });
  const samples = digestSamples(data); assert.equal(samples.length, 1); assert.ok(!JSON.stringify(samples).includes('DO_NOT_SEND_NAME'));
}));
