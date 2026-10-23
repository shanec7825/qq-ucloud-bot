import test from 'node:test';
import assert from 'node:assert/strict';
import { speechMode, splitChatText, conversationalReply } from '../src/chat-presentation.mjs';
import { mediaReply } from '../src/media-replies.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';
import { selectReplyMedia } from '../src/media-selection.mjs';

const event = { message_type: 'private', user_id: '123456', message: [] };
const speech = { autoReply: true, maxChars: 500 };
const record = { type: 'record', data: { file: 'fixture' } };
const raw = messages => JSON.stringify({ messages });

test('voice policy obeys explicit text/voice preferences before automatic selection', () => {
  assert.equal(speechMode('今天怎么样', event, speech), 'auto');
  for (const text of ['不要发语音，告诉我地址', '今天只发文字吧', '我不方便听语音', '用文字回答']) assert.equal(speechMode(text, event, speech), false);
  for (const text of ['用语音回答：今天怎么样', '能给我发条语音吗', '读给我听']) assert.equal(speechMode(text, event, { autoReply: false }), true);
  assert.equal(speechMode('用语音回答，但不要发语音了，只发文字', event, speech), false);
  assert.equal(speechMode('发条语音', event, null), false);
  assert.equal(speechMode('你好', event, { autoReply: false }), false);
});

test('automatic voice never reads plain output; optional speech and explicit requests differ', async () => {
  let calls = 0;
  const deps = { speech: { ...speech, synthesize: async () => { calls++; return record; } } };
  assert.equal(await mediaReply('今天六点见。', event, deps, [], 'auto'), '今天六点见。');
  assert.equal(await mediaReply(raw([{ text: '今天六点见。' }]), event, deps, [], 'auto').then(reply => reply.messages[0].prepareSpeech), undefined);
  const response = await mediaReply(JSON.stringify({ text: '地址发你了', speech: { text: '路上小心，我等你。' } }), event, deps, [], 'auto');
  assert.equal(calls, 0);
  await deliverReply(response, { target: {}, bot: { send: async () => [], sendSegments: async () => ({}) } });
  assert.equal(calls, 1);
  const explicit = await mediaReply('今天六点见。', event, deps, [], true);
  assert.equal(explicit.speechText, '今天六点见。');
  await assert.rejects(() => mediaReply('长'.repeat(501), event, deps, [], true), /语音内容/);
});

test('automatic replies cap voice at one and retain other spoken information as text', async () => {
  const response = await mediaReply(raw([
    { text: '先休息一下', speech: { text: '辛苦啦。' } },
    { text: '明天继续', speech: { text: '记得早点睡。' } },
    { text: '', speech: { text: '我一直在。' } },
  ]), event, { speech }, [], 'auto');
  assert.equal(response.messages.filter(row => row.prepareSpeech).length, 1);
  assert.equal(response.messages[1].text, '明天继续\n记得早点睡。');
  assert.equal(response.messages[2].text, '我一直在。');
});

test('automatic mode keeps long speech, code and links readable without starting TTS', async () => {
  for (const content of ['长'.repeat(181), '打开 https://example.com/a', 'const answer = 42;', '```js\nlet a = 1;\n```']) {
    const response = await mediaReply(raw([{ text: '', speech: { text: content } }]), event, { speech }, [], 'auto');
    assert.equal(response.messages[0].text, content);
    assert.equal(response.messages[0].prepareSpeech, undefined);
  }
});

test('oversized optional voice keeps valid text for both configured and default limits', async () => {
  for (const [config, length] of [[{ maxChars: 50 }, 51], [{}, 501]]) {
    const spoken = '长'.repeat(length), plan = { text: '正文应保留', speech: { text: spoken } };
    const deps = { speech: config };
    const grouped = await mediaReply(raw([plan]), event, deps, [], 'auto');
    assert.equal(grouped.messages[0].text, '正文应保留\n' + spoken);
    assert.equal(grouped.messages[0].prepareSpeech, undefined);
    assert.equal(await mediaReply(JSON.stringify(plan), event, deps, [], 'auto'), '正文应保留\n' + spoken);
    await assert.rejects(() => mediaReply(raw([plan]), event, deps, [], true), /语音内容/);
  }
});

test('optional voice fallback stays within ordinary per-message and total text budgets', async () => {
  const full = '正'.repeat(1500);
  const response = await mediaReply(raw([{ text: full, speech: { text: '补'.repeat(501) } }]), event, { speech }, [], 'auto');
  assert.equal(response.messages[0].text, full);
  const messages = Array.from({ length: 4 }, () => ({ text: '正'.repeat(1499), speech: { text: '补'.repeat(501) } }));
  const limited = await mediaReply(raw(messages), event, { speech }, [], 'auto');
  assert.equal(limited.messages.map(row => row.text).join('').length, 5996);
  assert.ok(limited.messages.every(row => !row.prepareSpeech));
});

test('natural chat gives the model optional speech in one call and respects a text-only turn', async () => {
  let calls = 0;
  const deps = { owner: '', catalog: { list: async () => [] }, speech, ai: async (_question, context) => {
    calls++;
    if (calls === 1) {
      assert.equal(context.speechDirection.mode, 'auto');
      const prompt = taskSystemPrompt(context);
      assert.match(prompt, /语音可选|完全没有语音/); assert.ok(!prompt.includes('整轮至少一条语音'));
    } else assert.equal(context.speechDirection, undefined);
    return '收到啦';
  } };
  assert.equal(await routeNatural('下午见', event, deps), '收到啦');
  assert.equal(await routeNatural('下午见，别发语音', event, deps), '收到啦');
  assert.equal(calls, 2);
});

test('prose splits at sentence endings, keeps emoji and retains all original characters', () => {
  for (const text of [
    '今天就先到这里吧。你先好好休息一下。明天我们再一起继续。',
    '这次做得很不错！😄 你可以先休息一会儿。下次我们一起试试新的。',
    '我看到你的消息啦。这个叫“等等。先别动！”的按钮很有趣。我们明天继续。',
  ]) {
    const chunks = splitChatText(text);
    assert.ok(chunks.length >= 2 && chunks.length <= 4);
    assert.equal(chunks.join(''), text);
    assert.ok(!chunks.some(chunk => chunk.trim().startsWith('😄')));
  }
});

test('short reactions, links, code, formulas and structured lists stay whole', () => {
  for (const text of ['好呀！明天见。', '请看 https://example.com/hello。这里有很详细的步骤。看完告诉我。', '```js\nconsole.log("你好。世界。");\n```\n先运行这段代码。', '第一步。\n1. 运行测试\n2. 查看结果', '这是公式 $a+b=c$。需要把每一项放在一起理解。']) assert.deepEqual(splitChatText(text), [text]);
});

test('fallback splitting attaches media and lazy speech once after the full text', () => {
  const text = '今天就先到这里吧。你先好好休息一下。明天我们再一起继续。';
  const prepareSpeech = async () => ({ part: record });
  const result = conversationalReply({ text, summary: text + '[图片：晚安]', segments: [{ type: 'image' }], prepareSpeech, speechText: '晚安啦' });
  assert.equal(result.pacing, true);
  assert.equal(result.messages.filter(row => row.prepareSpeech).length, 1);
  assert.equal(result.messages.filter(row => row.segments).length, 1);
  assert.equal(result.messages.at(-1).prepareSpeech, prepareSpeech);
  assert.equal(result.messages.map(row => row.text).join(''), text);
  assert.equal(result.messages.map(row => row.summary).join(''), text + '[图片：晚安]');
});

test('a newer model message list keeps its semantic grouping', () => {
  const messages = [{ text: '一个完整意思。接着解释完整一点。' }, { text: '下一个意思。' }];
  assert.equal(conversationalReply({ messages }).messages, messages);
});

test('a failed read-aloud never repeats text that has already been sent in split bubbles', async () => {
  const text = '今天就先到这里吧。你先好好休息一下。明天我们再一起继续。';
  const reply = conversationalReply(await mediaReply(text, event, { speech: { ...speech, synthesize: async () => { throw Error('暂不可用'); } } }, [], true));
  const sent = [];
  await deliverReply(reply, { target: {}, wait: async () => {}, bot: { send: async (_target, text) => { sent.push(text); return []; } } });
  assert.equal(sent.filter(row => row === text).length, 0);
  assert.equal(sent.join(''), text);
  assert.ok(sent.every(row => !/语音未生成|语音内容|暂不可用/.test(row)));
});

test('paced sends start immediately, pause between bubbles and cancel during a pause', async () => {
  let clock = 0, enabled = true;
  const sent = [], waits = [];
  const result = await deliverReply({ pacing: true, messages: [{ text: '第一条' }, { text: '第二条' }] }, {
    target: {}, now: () => clock, isCurrent: () => enabled,
    wait: async ms => { waits.push(ms); clock += ms; enabled = false; },
    bot: { send: async (_target, text) => { sent.push(text); return [{ message_id: 1 }]; } },
  });
  assert.deepEqual(sent, ['第一条']); assert.equal(waits[0], 100);
  assert.ok(!result.summary.includes('第二条')); assert.match(result.summary, /后续消息未发送/);
});

test('context media selection reaches items beyond 80 and exposes relevant emotions within its budget', () => {
  const items = Array.from({ length: 160 }, (_, index) => ({ id: String(index), name: '测试-' + index, type: 'sticker', source: { pack: '测试包' + index % 12 } }));
  const special = { id: 'late', name: '工作细胞-别担心', type: 'sticker', source: { pack: '工作细胞', tags: ['安慰'] } };
  const selected = selectReplyMedia([...items, special], '今天压力好大，能安慰我一下吗');
  assert.equal(selected.length, 40); assert.equal(selected[0].id, 'late'); assert.deepEqual(selected[0].tags, ['安慰']);
  assert.ok(selected.every(row => !Object.hasOwn(row, 'imageURL')));
  assert.notDeepEqual(selectReplyMedia(items, '早上好'), selectReplyMedia(items, '晚上好'));
});
