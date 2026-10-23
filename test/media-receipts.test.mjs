import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaReply } from '../src/media-replies.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { ConversationMemory } from '../src/persona.mjs';

const item = { id: 'a'.repeat(32), name: '初音未来圣诞快乐·该工作了', type: 'sticker' };
const other = { id: 'b'.repeat(32), name: '抱抱', type: 'sticker' };
const event = { post_type: 'message', message_type: 'private', self_id: '10000001', user_id: '20000001', message_id: 1, message: [{ type: 'text', data: { text: '催我写作业' } }] };
const image = { type: 'image', data: { file: 'fixture' } };
const deps = { outgoingMedia: { outgoing: async () => image } };
const marker = `[图片：${item.name}]`;

test('a selected image receipt is removed from legacy text and kept once in delivery memory', async () => {
  const reply = await mediaReply(JSON.stringify({ text: `收到，这就去催喵\n${marker}`, mediaIds: [item.id] }), event, deps, [item], false);
  assert.equal(reply.text, '收到，这就去催喵');
  const sent = [];
  const result = await deliverReply(reply, { target: {}, bot: {
    send: async (_target, text) => { sent.push(text); return []; },
    sendSegments: async (_target, parts) => { sent.push(parts); return { message_id: 2 }; },
  } });
  assert.deepEqual(sent, ['收到，这就去催喵', [image]]);
  assert.equal(result.summary, '收到，这就去催喵' + marker);
});

test('receipts are cleaned across bubbles even when the image belongs to a later bubble', async () => {
  const reply = await mediaReply(JSON.stringify({ messages: [
    { text: `收到，这就去催喵\n${marker}` },
    { text: '', mediaIds: [item.id] },
    { text: '先写第一题吧' },
  ] }), event, deps, [item], false);
  assert.deepEqual(reply.messages.map(row => row.text), ['收到，这就去催喵', '', '先写第一题吧']);
  assert.equal(reply.messages.flatMap(row => row.segments).length, 1);
});

test('a redundant receipt-only bubble is omitted without losing the actual image or nearby prose', async () => {
  const reply = await mediaReply(JSON.stringify({ messages: [
    { text: '收到' }, { text: marker }, { text: '现在开始', mediaIds: [item.id] },
  ] }), event, deps, [item], false);
  assert.deepEqual(reply.messages.map(row => row.text), ['收到', '现在开始']);
  assert.equal(reply.messages[1].segments[0], image);
});

test('only redundant selected-media annotations are cleaned; quotations, code and unrelated text stay intact', async () => {
  const original = `示例“${marker}”是文字。\n\`${marker}\`\n\`\`\`text\n${marker}\n\`\`\`\n${marker} 是记录格式\n[图片：抱抱]\n继续${marker}`;
  const reply = await mediaReply(JSON.stringify({ text: original, mediaIds: [item.id] }), event, deps, [item, other], false);
  assert.equal(reply.text, original.slice(0, -marker.length));
  const plain = `解释一下 ${marker}`;
  assert.equal(await mediaReply(plain, event, deps, [item], false), plain);
  assert.equal(await mediaReply(JSON.stringify({ text: plain, mediaIds: [] }), event, deps, [item], false), plain);
});

test('two selected annotations are removed while existing image limits and duplicate checks still apply', async () => {
  const reply = await mediaReply(JSON.stringify({ text: `好呀 [图片:${item.name}] [表情包：${other.name}]`, mediaIds: [item.id, other.id] }), event, deps, [item, other], false);
  assert.equal(reply.text, '好呀');
  assert.equal(reply.segments.length, 2);
  await assert.rejects(() => mediaReply(JSON.stringify({ messages: [
    { text: marker, mediaIds: [item.id] }, { text: '重复', mediaIds: [item.id] },
  ] }), event, deps, [item], false), /重复/);
});

test('the handler sends the image once and never sends its history annotation as QQ text', async () => {
  const sent = [], memory = new ConversationMemory();
  const handler = createMessageHandler({
    ...deps, groups: [], owner: '99999999', memory,
    catalog: { list: async () => [] }, persona: async () => ({ voice: [] }),
    outgoingMedia: { ...deps.outgoingMedia, list: async () => [item] },
    ai: async () => JSON.stringify({ messages: [{ text: `收到\n${marker}` }, { text: '', mediaIds: [item.id] }] }),
    bot: {
      send: async (_target, text) => { sent.push({ text }); return [{ message_id: 2 }]; },
      sendSegments: async (_target, parts) => { sent.push({ parts }); return { message_id: 3 }; },
    },
  });
  await handler(event);
  assert.deepEqual(sent, [{ text: '收到' }, { parts: [image] }]);
  assert.equal(memory.get(event).at(-1).text, `收到\n${marker}`);
});

test('removing a receipt-only bubble keeps the following image and lazy speech aligned', async () => {
  const requests = [];
  const reply = await mediaReply(JSON.stringify({ messages: [
    { text: marker }, { text: '开始吧', mediaIds: [item.id], speech: { text: '先写第一题' } },
  ] }), event, { ...deps, speech: { synthesize: async text => { requests.push(text); return { type: 'record' }; } } }, [item], true);
  assert.equal(reply.messages.length, 1);
  const sent = [];
  await deliverReply(reply, { target: {}, bot: {
    send: async (_target, text) => { sent.push(text); return []; },
    sendSegments: async (_target, [part]) => { sent.push(part.type); return {}; },
  } });
  assert.deepEqual(sent, ['开始吧', 'image', 'record']);
  assert.deepEqual(requests, ['先写第一题']);
});

test('a failed image delivery does not restore its annotation as text or successful history', async () => {
  const reply = await mediaReply(JSON.stringify({ text: `收到\n${marker}`, mediaIds: [item.id] }), event, deps, [item], false);
  const sent = [];
  const result = await deliverReply(reply, { target: {}, bot: {
    send: async (_target, text) => { sent.push(text); return []; },
    sendSegments: async () => { throw Error('upload failed'); },
  } });
  assert.equal(sent[0], '收到');
  assert.ok(sent.every(text => !text.includes(marker)));
  assert.ok(!result.summary.includes(marker));
  assert.match(result.summary, /媒体发送未完成/);
});
