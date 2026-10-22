import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaReply } from '../src/media-replies.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';

const event = { message_type: 'private', user_id: '20000001' };
const record = { type: 'record', data: { file: 'fixture' } };
const raw = messages => JSON.stringify({ messages });
function fixture(autoStyle = true) {
  const requests = [];
  const speech = {
    autoStyle, maxChars: 100,
    synthesize: async (text, _event, options) => { requests.push({ text, ...options }); return record; },
    synthesizeBatch: async rows => { requests.push(...rows); return rows.map(() => ({ part: record })); },
  };
  return { requests, deps: { speech } };
}

test('one reply sends independent text and voice, and remembers both only after delivery', async () => {
  const { deps, requests } = fixture();
  const reply = await mediaReply(JSON.stringify({ text: '地址发你了。', speech: { text: '路上慢一点，我等你。', style: '温柔关切' } }), event, deps, [], true);
  assert.equal(reply.text, '地址发你了。');
  assert.deepEqual(requests, [{ text: '路上慢一点，我等你。', style: '温柔关切' }]);
  const sent = [];
  const delivered = await deliverReply(reply, { target: {}, bot: { send: async (_target, text) => { sent.push(text); return []; }, sendSegments: async () => { sent.push('voice'); return {}; } } });
  assert.deepEqual(sent, ['地址发你了。', 'voice']);
  assert.match(delivered.summary, /地址发你了。\n\[语音\] 路上慢一点，我等你。/);
  assert.ok(!delivered.summary.includes('温柔关切'));
  const failed = await deliverReply(reply, { target: {}, bot: { send: async () => [], sendSegments: async () => { throw Error('send failed'); } } });
  assert.ok(!failed.summary.includes('我等你'));
  assert.match(failed.summary, /媒体发送未完成/);
});

test('mixed replies can contain text with voice, text alone and voice alone in order', async () => {
  const { deps, requests } = fixture(false);
  const reply = await mediaReply(raw([{ text: '地点见文字。', speech: { text: '到啦喊我。', style: '轻快' } }, { text: '三号门', speech: { text: '' } }, { text: '', speech: { text: '我先过去啦。' } }]), event, deps, [], true);
  assert.deepEqual(requests, [{ text: '到啦喊我。', style: '' }, { text: '我先过去啦。', style: '' }]);
  assert.deepEqual(reply.messages.map(row => row.segments.length), [1, 0, 1]);
  assert.equal(reply.messages[2].text, '');
  assert.equal(reply.messages[2].summary, '[语音] 我先过去啦。');
});

test('independent voice failure preserves the spoken content as visible text', async () => {
  const { deps } = fixture();
  deps.speech.synthesize = async () => { throw Error('服务繁忙'); };
  deps.speech.synthesizeBatch = async () => [{ error: '服务繁忙' }];
  const row = { text: '地点见文字。', speech: { text: '到啦喊我。' } };
  for (const plan of [JSON.stringify(row), raw([row])]) {
    const reply = await mediaReply(plan, event, deps, [], true);
    const message = reply.messages?.[0] || reply;
    const text = typeof message === 'string' ? message : message.text;
    assert.match(text, /语音未生成.*服务繁忙/);
    assert.match(text, /到啦喊我。/);
  }
});

test('speech payloads obey authorization, length and field boundaries before any work', async () => {
  const { deps, requests } = fixture();
  const row = { text: '可见文字', speech: { text: '私自添加的语音' } };
  assert.equal(await mediaReply(JSON.stringify(row), event, deps, [], false), '可见文字');
  assert.equal(requests.length, 0);
  const guarded = await mediaReply(JSON.stringify({ ...row, speech: { text: '替换', voice: 'Dean' } }), event, deps, [], true);
  assert.equal(guarded.text, '可见文字');
  assert.equal(requests[0].text, '可见文字');
  requests.length = 0;
  for (const text of [null, {}, 'x'.repeat(101), '含\0控制符']) {
    await assert.rejects(() => mediaReply(raw([{ text: '第一条' }, { text: '第二条', speech: { text } }]), event, deps, [], true), /语音内容/);
  }
  assert.equal(requests.length, 0);
});

test('legacy replies keep read-aloud behavior and explicit empty voice suppresses duplication', async () => {
  const { deps, requests } = fixture();
  const legacy = await mediaReply(JSON.stringify({ text: '兼容原文', speech: { style: '自然' } }), event, deps, [], true);
  assert.equal(legacy.summary, '兼容原文');
  assert.deepEqual(requests, [{ text: '兼容原文', style: '自然' }]);
  assert.equal(await mediaReply(JSON.stringify({ text: '只发文字', speech: { text: '' } }), event, deps, [], true), '只发文字');
  assert.equal(requests.length, 1);
});

test('chat plans independent speech even with automatic expression disabled, in one model request', async () => {
  const { deps, requests } = fixture(false);
  Object.assign(deps, { owner: '99999999', catalog: { list: async () => [] }, ai: async (_question, context) => {
    assert.equal(context.speechDirection.autoStyle, false);
    assert.equal(context.speechDirection.maxChars, 100);
    assert.match(taskSystemPrompt(context), /speech.text/);
    return raw([{ text: '文字说明', speech: { text: '口语补充' } }]);
  } });
  const reply = await routeNatural('用语音回答：怎么过去', event, deps);
  assert.equal(reply.messages[0].text, '文字说明');
  assert.deepEqual(requests, [{ text: '口语补充', style: '' }]);
});
