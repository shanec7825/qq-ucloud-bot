import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaReply } from '../src/media-replies.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';
import { conversationalReply } from '../src/chat-presentation.mjs';
import { REPLY_FORMAT_NOTICE } from '../src/reply-protocol.mjs';

const id = '5f673d3e044049009614a0b409b8cf0b';
const media = [{ id, name: '来了来了' }];
const event = { message_type: 'private', user_id: '123' };

test('fenced, double-encoded and missing-container JSON send prose and real media only', async () => {
  const plan = JSON.stringify({ messages: [{ text: '我在啊。\n来了～[图片：来了来了]', mediaIds: [id] }] });
  for (const raw of [plan, '```json\n' + plan + '\n```', JSON.stringify(plan), plan.slice(0, -2)]) {
    const sent = [];
    const reply = conversationalReply(await mediaReply(raw, event, { outgoingMedia: { outgoing: async (_event, selected) => {
      assert.equal(selected, id); return { type: 'image', data: { file: 'fixture' } };
    } } }, media, false));
    await deliverReply(reply, { target: {}, bot: { send: async (_target, text) => { sent.push(text); }, sendSegments: async (_target, parts) => { sent.push(parts[0].type); } } });
    assert.deepEqual(sent, ['我在啊。\n来了～', 'image']);
  }
});

test('complete legacy speech data reaches lazy TTS without exposing tool labels or style', async () => {
  const raw = '<tool_call><function=generateSpeech><parameter=text>好啦好啦，给你一条就是了。喵～</parameter><parameter=speechStyle>轻快、自然</parameter></function></tool_call>';
  const sent = [], spoken = [];
  const reply = await mediaReply(raw, event, { speech: { autoStyle: true, synthesize: async (text, _event, options) => {
    spoken.push({ text, style: options.style }); return { type: 'record', data: { file: 'fixture' } };
  } } }, [], true);
  assert.equal(spoken.length, 0);
  await deliverReply(conversationalReply(reply), { target: {}, bot: { send: async (_target, text) => { sent.push(text); }, sendSegments: async (_target, parts) => { sent.push(parts[0].type); } } });
  assert.deepEqual(spoken, [{ text: '好啦好啦，给你一条就是了。喵～', style: '轻快、自然' }]);
  assert.equal(sent.at(-1), 'record');
  assert.ok(sent.every(text => !/parameter|tool_call|轻快/.test(text)));
});

test('broken, unknown and nested protocols fail before media or speech work', async () => {
  let work = 0;
  const deps = { outgoingMedia: { outgoing: async () => { work++; } }, speech: { synthesize: async () => { work++; } } };
  const bad = [
    '{"messages":[{"text":"还没有结束',
    '{"messages":[{"text":"你好",}]}',
    '<tool_call><function=generateSpeech><parameter=text>你好',
    '</parameter></function></tool_call>',
    '<tool_call><function=deleteFile><parameter=text>你好</parameter></function></tool_call>',
    '<tool_call><function=generateSpeech><parameter=text>你好</parameter><parameter=path>elsewhere</parameter></function></tool_call>',
    JSON.stringify({ text: '<tool_call>hidden</tool_call>', mediaIds: [id] }),
    JSON.stringify({ messages: [{ text: '第一条', mediaIds: [id] }, { text: '{"messages":[{"text":"nested"}]}' }] }),
    JSON.stringify({ text: '你好', speech: { text: '<function=generateSpeech>hidden</function>' } }),
    '{"mediaIds":[]}',
  ];
  for (const raw of bad) await assert.rejects(() => mediaReply(raw, event, deps, media, true), /格式/);
  assert.equal(work, 0);
});

test('delivery guard rejects the entire batch before a preceding normal bubble or lazy TTS', async () => {
  let work = 0; const sent = [];
  const reply = { messages: [{ text: '正常开头' }, { text: '<tool_call><function=generateSpeech>', prepareSpeech: async () => { work++; } }] };
  const result = await deliverReply(reply, { target: {}, bot: { send: async (_target, text) => { sent.push(text); } } });
  assert.deepEqual(sent, [REPLY_FORMAT_NOTICE]); assert.equal(work, 0); assert.equal(result.summary, REPLY_FORMAT_NOTICE);
});

test('ordinary code, JSON data and comparisons remain unchanged', async () => {
  for (const text of ['我在呢～', '1 < 2，3 > 2', '{"name":"小明","count":2}', '```js\nconst a = { text: "你好" };\n```']) {
    assert.equal(await mediaReply(text, event, {}, [], false), text);
  }
  assert.equal(await mediaReply('{"text":"你好"}', event, {}, [], false), '你好');
});
