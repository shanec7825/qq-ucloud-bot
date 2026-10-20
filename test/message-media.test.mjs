import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { contentText, segments, faceName } from '../src/message-content.mjs';
import { incomingText } from '../src/persona.mjs';
import { MessageMedia, mediaURL, fetchImage, imageDimensions, stickerURL } from '../src/message-media.mjs';

const group = { post_type: 'message', message_type: 'group', group_id: 300000001, user_id: 10001, self_id: 100000002 };
const at = { type: 'at', data: { qq: group.self_id } };
test('图片、表情、卡片、语音等均可触发；文字伪造 @ 无法触发', () => {
  for (const type of ['image', 'mface', 'face', 'record', 'video', 'file', 'json', 'xml', 'reply', 'forward', 'dice', 'rps', 'location', 'contact', 'music', 'unknown']) {
    assert.ok(incomingText({ ...group, message: [at, { type, data: { id: '123', name: '附件' } }] }, ['300000001']));
    assert.equal(incomingText({ ...group, message: [{ type, data: {} }] }, ['300000001']), null);
  }
  assert.equal(incomingText({ ...group, message: [{ type: 'text', data: { text: `[CQ:at,qq=${group.self_id}]` } }] }, ['300000001']), null);
  assert.ok(incomingText({ ...group, message: `[CQ:at,qq=${group.self_id}][CQ:image,file=test]` }, ['300000001']));
  assert.equal(segments({ raw_message: '[CQ:text,text=a&#44;b]' })[0].data.text, 'a,b');
  assert.match(contentText({ message: [{ type: 'record', data: {} }] }), /语音/);
});
test('图片只允许 QQ HTTPS 媒体地址；拒绝本机文件、内网和跨域重定向', async () => {
  for (const address of ['file:///C:/secret', 'https://127.0.0.1/a.png', 'http://gchat.qpic.cn/a', 'https://gchat.qpic.cn.evil.test/a', 'https://x@gchat.qpic.cn/a']) assert.throws(() => mediaURL(address));
  assert.equal(mediaURL('https://gchat.qpic.cn/a').hostname, 'gchat.qpic.cn');
  assert.equal(mediaURL('https://multimedia.nt.qq.com.cn/download').hostname, 'multimedia.nt.qq.com.cn');
  assert.equal(mediaURL('https://gxh.vip.qq.com/club/a.gif').hostname, 'gxh.vip.qq.com');
  for (const address of ['https://multimedia.nt.qq.com.cn.evil.test/a', 'https://evil.gxh.vip.qq.com/a']) assert.throws(() => mediaURL(address));
  await assert.rejects(() => fetchImage('https://gchat.qpic.cn/a', async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })), /QQ 媒体/);
});

test('QQ 表情转成名称，支持当前 NapCat 原始标签、编号零及新版表情', () => {
  assert.equal(faceName({ id: 0 }), '惊讶');
  assert.equal(faceName({ id: '14' }), '微笑');
  assert.equal(faceName({ id: '478' }), '对的对的');
  assert.equal(faceName({ id: '99999', raw: { faceText: '/新版表情' } }), '新版表情');
  assert.match(faceName({ id: '99999', name: '99999' }), /未识别/);
  assert.equal(contentText({ message: '[CQ:face,id=179][CQ:face,id=182]' }), '[QQ表情：doge] [QQ表情：笑哭]');
  assert.ok(!contentText({ message: [{ type: 'face', data: { id: '99999' } }] }).includes('99999'));
});

test('商城表情使用真实图片，新 QQ 域名可下载，附件 ID 优先于普通占位文件名', async () => {
  const canvas = createCanvas(20, 20), calls = [], downloads = [];
  const id = '0123456789abcdef0123456789abcdef';
  assert.equal(stickerURL({ emoji_id: '../evil' }), null);
  assert.equal(stickerURL({ emoji_id: id }), `https://gxh.vip.qq.com/club/item/parcel/item/01/${id}/raw300.gif`);
  const media = new MessageMedia({ call: async (action, params) => { calls.push({ action, params }); return { url: 'https://multimedia.nt.qq.com.cn/a' }; } }, async url => { mediaURL(url); downloads.push(url); return canvas.encode('png'); });
  const result = await media.prepare({ ...group, message: [
    { type: 'mface', data: { emoji_id: id } },
    { type: 'image', data: { file: 'marketface', file_id: 'real-attachment-id' } },
  ] });
  try {
    assert.equal(result.images.length, 2);
    assert.deepEqual(calls, [{ action: 'get_image', params: { file: 'real-attachment-id' } }]);
    assert.equal(downloads[1], 'https://multimedia.nt.qq.com.cn/a');
  } finally { await result.cleanup(); }
});
test('模型图片转换为临时 PNG，用后删除；引用不能跨群读取', async () => {
  const canvas = createCanvas(20, 20); canvas.getContext('2d').fillRect(0, 0, 20, 20);
  const media = new MessageMedia({ call: async () => ({ message_type: 'group', group_id: 999, message: [{ type: 'text', data: { text: 'OTHER_GROUP_SECRET' } }] }) }, async () => canvas.encode('png'));
  const result = await media.prepare({ ...group, message: [at, { type: 'image', data: { url: 'https://gchat.qpic.cn/a' } }, { type: 'reply', data: { id: '1' } }, { type: 'record', data: {} }] });
  assert.equal(result.images.length, 1); const path = result.images[0].path;
  assert.ok((await stat(path)).size > 0); assert.ok(!result.notes.includes('OTHER_GROUP_SECRET'));
  assert.match(result.notes, /不属于当前会话/); assert.match(result.notes, /语音转文字未成功/);
  await result.cleanup(); await assert.rejects(() => stat(path));
});
test('图片解码前拒绝过大尺寸，语音转写使用当前消息 ID', async () => {
  const bytes = Buffer.alloc(24); bytes[0] = 137; bytes.write('PNG', 1); bytes.writeUInt32BE(40000, 16); bytes.writeUInt32BE(40000, 20);
  assert.throws(() => imageDimensions(bytes), /4000 万/);
  const calls = [];
  const media = new MessageMedia({ call: async (action, params) => { calls.push({ action, params }); return { text: '明天有什么作业' }; } });
  const result = await media.prepare({ ...group, message_id: 123, message: [at, { type: 'record', data: { file_id: 'x' } }] });
  assert.deepEqual(calls, [{ action: 'fetch_ptt_text', params: { message_id: 123 } }]);
  assert.match(result.notes, /明天有什么作业/); await result.cleanup();
});
