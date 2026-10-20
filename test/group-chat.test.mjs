import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { MessageMedia } from '../src/message-media.mjs';
import { OneBot } from '../src/onebot.mjs';
import { defaults, SettingsStore } from '../src/settings.mjs';

export const message = (id, user, text, at = false, extra = {}) => ({ post_type: 'message', message_type: 'group', group_id: '300000001',
  self_id: '100000002', user_id: String(user), message_id: id, time: Date.now() / 1000, sender: { card: user === 10001 ? '阿甲' : '阿乙' },
  message: [...(at ? [{ type: 'at', data: { qq: '100000002' } }] : []), { type: 'text', data: { text } }], ...extra });
function setup(overrides = {}) {
  const memory = new ConversationMemory(), calls = [], replies = [];
  const deps = { memory, groups: ['300000001'], owner: '100000001', bot: { send: async (...args) => { replies.push(args); return [{ message_id: 900 + replies.length }]; } },
    catalog: { list: async () => '暂无作业' }, persona: async () => ({ voice: [] }), resources: {},
    ai: async (question, context) => { calls.push({ question, context: structuredClone(context) }); return '回答'; }, ...overrides };
  return { memory, calls, replies, handler: createMessageHandler(deps) };
}

test('未@仅本机缓存；@后包含背景、当前成员身份和显示名，不误认另一人', async () => {
  const { memory, handler, calls, replies } = setup();
  await handler(message(1, 10001, '我等会去跑步'));
  assert.equal(calls.length, 0); assert.equal(replies.length, 0); assert.equal(memory.get(message(1, 10001, '')).length, 0);
  await handler(message(2, 10002, '刚才说要跑步的是谁？', true));
  const { context } = calls[0];
  assert.equal(context.currentMessage.senderName, '阿乙');
  assert.equal(context.groupBackground[0].senderName, '阿甲');
  assert.notEqual(context.currentMessage.speaker, context.groupBackground[0].speaker);
  assert.equal(context.conversation[0].speaker, context.currentMessage.speaker);
  assert.deepEqual(replies[0][2], { replyTo: 2, mention: '10002' });
  assert.equal(memory.get(message(3, 10002, '')).at(-1).messageId, '901');
  assert.equal(memory.get(message(3, 10002, '')).at(-1).replyTo, '2');
  assert.equal(memory.get(message(3, 10002, '')).at(-1).senderName, '');
});

test('同名成员和提及对象按稳定身份区分；重复事件不增加背景或回复', async () => {
  const { memory, handler, calls } = setup();
  const a = message(1, 10001, '我喜欢跑步', false, { sender: { card: '同名' } });
  await handler(a); await handler(a);
  const b = message(2, 10002, '他说什么', true, { sender: { card: '同名' } });
  b.message.push({ type: 'at', data: { qq: '10001' } });
  await handler(b); await handler(b);
  assert.equal(calls.length, 1); assert.equal(calls[0].context.groupBackground.length, 1);
  assert.notEqual(calls[0].context.currentMessage.speaker, calls[0].context.currentMessage.mentions[0].speaker);
  assert.equal(calls[0].context.currentMessage.mentions[0].speaker, memory.describe(a).speaker);
});

test('白名单外、自身、私聊内容不进入群背景；同消息编号跨群不被吞掉', async () => {
  const { handler, calls, memory } = setup({ groups: ['300000001', '300000002'] });
  await handler(message(1, 10001, 'OTHER_GROUP_SECRET', false, { group_id: '300000003' }));
  await handler(message(2, 100000002, 'SELF_LOOP', true));
  await handler(message(3, 10001, 'PRIVATE_SECRET', false, { message_type: 'private' }));
  await handler(message(4, 10001, '群一', true));
  await handler(message(4, 10002, '群二', true, { group_id: '300000002' }));
  assert.equal(calls.length, 3);
  assert.ok(!JSON.stringify(calls[2].context).match(/OTHER_GROUP_SECRET|PRIVATE_SECRET|SELF_LOOP|群一/));
  assert.equal(memory.sessions.has('group:300000003'), false);
});

test('排队消息使用到达时的群背景快照，不把未来闲聊倒灌到过去问题', async () => {
  let release, begin; const started = new Promise(resolve => { begin = resolve; }), wait = new Promise(resolve => { release = resolve; });
  const contexts = [];
  const { handler } = setup({ ai: async (_q, context) => { contexts.push(structuredClone(context)); if (contexts.length === 1) { begin(); await wait; } return '已回答'; } });
  const first = handler(message(1, 10001, '第一问', true)); await started;
  const second = handler(message(2, 10002, '第二问', true));
  await handler(message(3, 10001, '未来才出现的话'));
  release(); await Promise.all([first, second]);
  assert.ok(!JSON.stringify(contexts[1]).includes('未来才出现的话'));
  assert.ok(contexts[1].conversation.some(row => row.speaker === '机器人'));
});

test('背景有条数、文字与时间限额；关闭、清空、关闭再打开不会恢复旧记录', () => {
  const memory = new ConversationMemory();
  memory.configure({ enabled: true, recentLimit: 16, ttlMinutes: 60, groupContext: true, groupContextLimit: 60 });
  for (let n = 0; n < 80; n++) memory.observe(message(n, 10001, '长'.repeat(1000)));
  assert.equal(memory.list()[0].background.length, 60);
  assert.ok(JSON.stringify(memory.background(message(100, 10001, ''))).length <= 10002);
  for (const row of memory.list()[0].background) row.observedAt -= 16 * 60000;
  assert.deepEqual(memory.background(message(100, 10001, '')), []);
  memory.observe(message(81, 10001, '旧背景'));
  memory.configure({ enabled: false, recentLimit: 16, ttlMinutes: 60 });
  memory.configure({ enabled: true, recentLimit: 16, ttlMinutes: 60 });
  assert.equal(memory.list().length, 0);
  memory.observe(message(82, 10001, '新背景')); memory.clear('group:300000001');
  assert.equal(memory.list().length, 0);
});

test('引用保留原作者及机器人身份，拒绝跨群引用；当前发言人不会冒领引用', async () => {
  const memory = new ConversationMemory();
  const quoted = message(1, 10001, '这是阿甲说的');
  const media = new MessageMedia({ call: async (_action, { message_id }) => message_id === 'bad' ? { ...quoted, group_id: '99999', message: [{ type: 'text', data: { text: 'CROSS_SECRET' } }] } : quoted });
  const current = message(2, 10002, '谁说的', true);
  current.message.unshift({ type: 'reply', data: { id: '1' } }, { type: 'reply', data: { id: 'bad' } });
  const prepared = await media.prepare(current, { describe: event => memory.describe(event) });
  try {
    assert.equal(prepared.quotes.length, 1); assert.equal(prepared.quotes[0].senderName, '阿甲');
    assert.equal(prepared.quotes[0].speaker, memory.describe(quoted).speaker);
    assert.notEqual(prepared.quotes[0].speaker, memory.describe(current).speaker);
    assert.ok(!prepared.notes.includes('CROSS_SECRET'));
    assert.equal(memory.describe({ ...quoted, user_id: quoted.self_id }).speaker, '机器人');
  } finally { await prepared.cleanup(); }
});

test('持续的普通群消息不会延长旧对话的保留时间', () => {
  const memory = new ConversationMemory(), request = message(1, 10001, '过期的提问', true);
  memory.add(request, '过期的提问'); memory.get(request)[0].recordedAt -= 61 * 60000;
  memory.observe(message(2, 10002, '新闲聊'));
  assert.deepEqual(memory.get(request), []); assert.equal(memory.background(request).length, 1);
});

test('群回复使用真实 reply/at 消息段，模型文字不能生成CQ指令；私聊不添加@', async () => {
  const bot = new OneBot('ws://127.0.0.1:3001', '', () => {}), calls = [];
  bot.call = async (action, params) => { calls.push({ action, params }); return { message_id: calls.length }; };
  await bot.send({ group_id: '300000001' }, '[CQ:at,qq=all]' + '长'.repeat(1900), { replyTo: -123, mention: 10001 });
  assert.deepEqual(calls[0].params.message.slice(0, 2), [{ type: 'reply', data: { id: '-123' } }, { type: 'at', data: { qq: '10001' } }]);
  assert.equal(calls[0].params.message[2].type, 'text'); assert.equal(calls[1].params.message.length, 1);
  await bot.send({ user_id: '10001' }, '私聊', { replyTo: 1, mention: 10001 });
  assert.equal(calls[2].params.message.length, 1);
});

test('旧配置无损迁移背景开关，保留现有模型、群权限与提示词', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'qq-settings-test-'));
  try {
    const old = defaults({}); old.bot.name = '原名字'; old.bot.systemPrompt = '原提示词'; old.ai.model = 'gpt-6-luna';
    delete old.memory.groupContext; delete old.memory.groupContextLimit;
    const file = pathToFileURL(join(folder, 'settings.json')); await writeFile(file, JSON.stringify(old));
    const store = new SettingsStore(file, {}); await store.load();
    assert.equal(store.get().memory.groupContext, true); assert.equal(store.get().memory.groupContextLimit, 24);
    assert.equal(store.get().bot.systemPrompt, old.bot.systemPrompt); assert.equal(store.get().ai.model, old.ai.model);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
