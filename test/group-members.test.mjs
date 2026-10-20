import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupMembers } from '../src/group-members.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';

const event = (id = '10001', group = '300000001') => ({ post_type: 'message', message_type: 'group', group_id: group, user_id: id, self_id: '100000002',
  message_id: 1, sender: { card: '', nickname: 'QQ昵称' }, message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'text', data: { text: '群里都有谁？' } }] });
const roster = [
  { group_id: '300000001', user_id: '10001', card: '本群名片', nickname: 'QQ昵称', age: 99, title: '不要发送的额外字段' },
  { group_id: '300000001', user_id: '10002', card: '', nickname: '没设名片的群友' },
  { group_id: '300000001', user_id: '10003', card: '同名', nickname: '甲' },
  { group_id: '300000001', user_id: '10004', card: '同名', nickname: '乙' },
];
function setup(rows = roster) {
  const calls = [], memory = new ConversationMemory(); let now = 1;
  const directory = new GroupMembers({ call: async (action, params) => { calls.push({ action, params }); return action === 'get_group_member_list' ? rows : { group_id: params.group_id, group_name: '测试宿舍群' }; } }, () => ['300000001'], () => now);
  return { calls, memory, directory, advance: ms => { now += ms; } };
}

test('完整名单仅在本机匹配；只提供被问及的成员名字，不把全员或额外字段交给模型', async () => {
  const { directory, memory, calls } = setup();
  directory.observe(event()); assert.equal(calls.length, 0);
  await directory.prepare(event());
  const context = directory.context(event(), '没设名片的群友和同名', memory);
  assert.equal(context.groupName, '测试宿舍群'); assert.equal(context.members.length, 4); assert.equal(context.complete, true);
  assert.equal(directory.context(event(), '你好', memory).members.length, 1);
  assert.equal(directory.describe(event(), memory).senderName, '本群名片');
  assert.equal(context.members.find(row => row.nickname === '没设名片的群友').senderName, '没设名片的群友');
  const twins = context.members.filter(row => row.card === '同名'); assert.notEqual(twins[0].speaker, twins[1].speaker);
  assert.ok(!JSON.stringify(context).match(/10001|年龄|额外字段|user_id|"age"|"title"/));
});

test('@对象可补全群名片，事件里空名片不覆盖名单中的有效名片', async () => {
  const { directory, memory } = setup(); const request = event();
  request.message.push({ type: 'at', data: { qq: '10002' } });
  await directory.prepare(request);
  const person = directory.describe({ ...request, user_id: '10002', sender: {} }, memory);
  assert.equal(person.senderName, '没设名片的群友');
  assert.equal(person.speaker, memory.describe({ ...request, user_id: '10002' }).speaker);
  assert.equal(directory.describe(request, memory).card, '本群名片');
});

test('名单缓存五分钟，消息里的新名片即时更新；刷新可识别名片移除', async () => {
  const rows = structuredClone(roster), { directory, memory, calls, advance } = setup(rows);
  await Promise.all([directory.prepare(event()), directory.prepare(event())]); assert.equal(calls.length, 2);
  directory.observe({ ...event(), sender: { card: '新名片', nickname: 'QQ昵称' } });
  assert.equal(directory.describe({ ...event(), sender: {} }, memory).card, '新名片');
  await directory.prepare(event()); assert.equal(calls.length, 2);
  advance(5 * 60000); rows[0].card = '';
  await directory.prepare(event()); assert.equal(calls.length, 4);
  assert.equal(directory.describe(event(), memory).senderName, 'QQ昵称');
});

test('私聊和未允许群不读名单；混入其他群的成员被过滤；撤销权限后丢弃在途结果', async () => {
  const { directory, memory, calls } = setup([...roster, { group_id: '99999', user_id: '99999', card: '跨群秘密' }]);
  await directory.prepare({ ...event(), message_type: 'private' }); await directory.prepare(event('10001', '99999'));
  assert.equal(calls.length, 0); assert.equal(directory.context(event('10001', '99999'), '', memory), null);
  await directory.prepare(event()); assert.ok(!JSON.stringify(directory.context(event(), '', memory)).includes('跨群秘密'));
  let resolve; const wait = new Promise(done => { resolve = done; }); let allowed = ['300000001'];
  const pending = new GroupMembers({ call: async action => action === 'get_group_member_list' ? wait : {} }, () => allowed);
  const request = pending.prepare(event()); allowed = []; pending.retain(); resolve(roster); await request;
  assert.equal(pending.groups.size, 0);
});

test('大群只提供当前成员、@对象和问题中明确提到的名字，不附加无关名单', async () => {
  const rows = Array.from({ length: 100 }, (_, n) => ({ user_id: String(10001 + n), card: '群友名字' + n, nickname: '' }));
  const { directory, memory } = setup(rows); const request = event();
  request.message.push({ type: 'at', data: { qq: '10100' } });
  await directory.prepare(request); const context = directory.context(request, '群友名字88 是谁？', memory);
  assert.ok(context.members.length < 10); assert.equal(context.total, 100); assert.equal(context.complete, false);
  assert.ok(context.members.some(row => row.card === '群友名字99')); assert.ok(context.members.some(row => row.card === '群友名字88'));
});

test('接口失败仍用当前消息昵称回应，短暂冷却，不导致AI离线兜底', async () => {
  let calls = 0; const memory = new ConversationMemory();
  const directory = new GroupMembers({ call: async () => { calls++; throw new Error('QQ API unavailable'); } }, () => ['300000001']);
  await directory.prepare(event()); await directory.prepare(event());
  assert.equal(calls, 2); assert.equal(directory.describe(event(), memory).senderName, 'QQ昵称');
  assert.equal(directory.context(event(), '', memory).complete, false);
});

test('真实消息处理入口只在@时读名单，模型只看到当前发言者及@对象的名字', async () => {
  const { directory, memory, calls } = setup(); let captured;
  const handler = createMessageHandler({ groups: ['300000001'], owner: '100000001', memory, members: directory, bot: { send: async () => [] },
    catalog: { list: async () => '' }, persona: async () => ({ voice: [] }), resources: {}, ai: async (_q, context) => { captured = context; return '收到'; } });
  await handler({ ...event(), message_id: 0, message: [{ type: 'text', data: { text: '普通消息' } }] }); assert.equal(calls.length, 0);
  const request = event(); request.message.push({ type: 'at', data: { qq: '10002' } }); await handler(request);
  assert.equal(captured.currentMessage.senderName, '本群名片'); assert.equal(captured.groupDirectory.members.length, 2);
  assert.equal(captured.currentMessage.mentions[0].senderName, '没设名片的群友');
});
