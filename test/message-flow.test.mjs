import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createMessageHandler } from '../src/message-handler.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { askAI } from '../src/core.mjs';
import { firstReplyText } from '../src/reply-preview.mjs';

const plan = (...texts) => JSON.stringify({ version: 2, messages: texts.map(text => ({ type: 'text', text })) });
const event = (id, text, extra = {}) => ({ post_type: 'message', message_type: 'private', self_id: '10000001', user_id: '20000001', message_id: id, message: [{ type: 'text', data: { text } }], ...extra });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup(ai, overrides = {}) {
  const sent = [], memory = new ConversationMemory();
  const handler = createMessageHandler({ groups: [], owner: '20000001', memory, catalog: { list: async () => [] }, resources: {}, persona: async () => ({ voice: [] }), ai,
    bot: { send: async (_target, text) => { sent.push(text); return [{ message_id: sent.length + 100 }]; } }, batchWindowMs: 0, ...overrides });
  return { handler, sent, memory };
}

test('only a closed, validated first v2 text item is eligible for early delivery', () => {
  assert.equal(firstReplyText('{"version":2,"messages":[{"type":"text","text":"半句'), null);
  assert.equal(firstReplyText('{"version":2,"messages":[{"type":"text","text":"完整。"}'), null);
  assert.equal(firstReplyText('{"version":2,"messages":[{"type":"text","text":"完整。"},'), '完整。');
  assert.equal(firstReplyText(plan('引号 " 与括号 } 和换行\n都完整。')), '引号 " 与括号 } 和换行\n都完整。');
  for (const raw of ['{"version":2,"messages":[{"type":"speech","text":"声音"},', '{"version":2,"messages":[{"type":"text","text":"正文","user_id":"other"},', '{"version":2,"messages":[{"type":"text","text":"<tool_call>隐藏</tool_call>"},', '{"version":2,"messages":[{"type":"text","text":"[图片：占位]"},', '{"messages":[{"text":"旧格式"}]}']) assert.equal(firstReplyText(raw), null);
});

test('first text reaches the transport while the model is still generating and is sent once', async () => {
  const started = gate(), finish = gate();
  const { handler, sent, memory } = setup(async (_q, _c, options) => {
    await options.onDelta('{"version":2,"messages":[{"type":"text","text":"先回答重点。"},'); started.resolve();
    await finish.promise; return plan('先回答重点。', '再解释原因。');
  });
  const work = handler(event(1, '解释一下')); await started.promise;
  assert.deepEqual(sent, ['先回答重点。']); assert.equal(handler.isBusy(), true);
  finish.resolve(); await work; assert.deepEqual(sent, ['先回答重点。', '再解释原因。']);
  assert.equal(memory.get(event(1)).at(-1).text, '先回答重点。\n再解释原因。');
  assert.equal(handler.isBusy(), false);
  assert.equal(handler.status().lastReply.inputMessages, 1); assert.equal(handler.status().lastReply.sentMessages, 2);
  assert.equal(typeof handler.status().lastReply.firstReceiptMs, 'number'); assert.ok(!JSON.stringify(handler.status()).includes('先回答'));
});

test('same-sender additions cancel stale generation and preserve all input in one follow-up', async () => {
  const started = gate(), questions = [];
  const { handler, sent, memory } = setup(async (q, _c, { signal }) => {
    questions.push(q);
    if (questions.length === 1) { started.resolve(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    return plan('根据完整问题回答。');
  });
  const a = handler(event(1, '帮我选晚餐')); await started.promise;
  const b = handler(event(2, '不要辣')); const c = handler(event(3, '预算二十元'));
  await Promise.all([a, b, c]);
  assert.equal(questions.length, 2); assert.equal(questions[1], '帮我选晚餐\n不要辣\n预算二十元');
  assert.deepEqual(sent, ['根据完整问题回答。']);
  assert.deepEqual(memory.get(event(1)).filter(row => row.speaker !== '机器人').map(row => row.text), ['帮我选晚餐', '不要辣', '预算二十元']);
});

test('a follow-up after an early receipt stops the old tail without repeating delivered text', async () => {
  const started = gate(), questions = [];
  const { handler, sent, memory } = setup(async (q, _c, options) => {
    questions.push(q);
    if (questions.length === 1) {
      await options.onDelta('{"version":2,"messages":[{"type":"text","text":"已经收到。"},'); started.resolve();
      await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return plan('按补充条件回复。');
  });
  const a = handler(event(1, '给个建议')); await started.promise;
  const b = handler(event(2, '改成明天')); await Promise.all([a, b]);
  assert.deepEqual(questions, ['给个建议', '改成明天']); assert.deepEqual(sent, ['已经收到。', '按补充条件回复。']);
  assert.ok(memory.get(event(1)).some(row => row.speaker === '机器人' && row.text.includes('已经收到。')));
});

test('failed early sends are attempted once and never start a second model or media request', async () => {
  let calls = 0, sends = 0, media = 0;
  const { handler } = setup(async (_q, _c, options) => { calls++; await options.onDelta(plan('正文')); return plan('正文'); }, {
    bot: { send: async () => { sends++; throw Error('uncertain receipt'); } }, outgoingMedia: { list: async () => [], outgoing: async () => { media++; } },
  });
  await handler(event(1, '你好')); assert.equal(sends, 1); assert.equal(calls, 1); assert.equal(media, 0);
});

test('different group members keep their own questions, order and mention receipts', async () => {
  const started = gate(), finish = gate(), requests = [], sends = [];
  const { handler } = setup(async (q, _c, options) => { requests.push(q); if (requests.length === 1) { started.resolve(); await finish.promise; assert.equal(options.signal.aborted, false); } return plan(q); }, {
    groups: ['30000001'], bot: { send: async (_t, text, options) => { sends.push({ text, options }); return []; } },
  });
  const group = (id, text, user_id) => { const e = event(id, text, { message_type: 'group', group_id: '30000001', user_id }); e.message.unshift({ type: 'at', data: { qq: e.self_id } }); return e; };
  const a = handler(group(1, '甲的问题', '20000001')); await started.promise;
  const b = handler(group(2, '乙的问题', '20000002')); finish.resolve(); await Promise.all([a, b]);
  assert.deepEqual(requests, ['甲的问题', '乙的问题']);
  assert.deepEqual(sends.map(row => row.options), [{ replyTo: 1, mention: '20000001' }, { replyTo: 2, mention: '20000002' }]);
});

test('stream reader handles split UTF-8/SSE frames and ignores reasoning and usage', async () => {
  const chunks = [], env = { OPENAI_API_KEY: 'fake', OPENAI_MODEL: 'test' };
  const bytes = new TextEncoder().encode(': ping\r\n\r\ndata: {"choices":[{"index":0,"delta":{"reasoning_content":"内部推理"}}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"。"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
  let request;
  const answer = await askAI('你好', {}, env, async (_url, options) => { request = JSON.parse(options.body); return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }); }, { onDelta: async delta => chunks.push(delta) });
  assert.equal(request.stream, true); assert.equal(answer, '你好。'); assert.deepEqual(chunks, ['你好', '。']);
});

test('a truncated stream, tool call or provider error never becomes a successful answer', async () => {
  for (const payload of ['data: {"choices":[{"delta":{"content":"半条"}}]}\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{}]},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', 'data: {"error":{"message":"private diagnostic"}}\n\ndata: [DONE]\n\n']) {
    await assert.rejects(() => askAI('问题', {}, { OPENAI_API_KEY: 'fake', OPENAI_MODEL: 'test' }, async () => new Response(payload, { headers: { 'content-type': 'text/event-stream' } }), { onDelta: async () => {} }));
  }
});

test('an idle first question never waits for the coalescing window', async () => {
  const { handler, sent } = setup(async () => plan('直接回答。'), { batchWindowMs: 300, wait: () => assert.fail('idle first question must not debounce') });
  await handler(event(1, '你好')); assert.deepEqual(sent, ['直接回答。']);
});

test('slash commands stay independent and never cancel another command', async () => {
  const started = gate(), finish = gate(), questions = [];
  const { handler, sent } = setup(async (q, _c, options) => { questions.push(q); if (questions.length === 1) { started.resolve(); await finish.promise; assert.equal(options.signal.aborted, false); } return plan('回复' + q); });
  const a = handler(event(1, '/AI 第一条')); await started.promise;
  const b = handler(event(2, '/AI 第二条')); finish.resolve(); await Promise.all([a, b]);
  assert.deepEqual(questions, ['第一条', '第二条']); assert.deepEqual(sent, ['回复第一条', '回复第二条']);
});

test('coalescing has a maximum wait even while additions keep arriving', async () => {
  const started = gate(), questions = [], works = []; let clock = 0, additions = 0, handler;
  ({ handler } = setup(async (q, _c, { signal }) => { questions.push({ q, clock }); if (questions.length === 1) { started.resolve(); await new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } return plan('合并回答。'); }, {
    batchWindowMs: 300, maxBatchWaitMs: 500, now: () => clock, wait: async ms => { clock += ms; if (additions++ < 4) works.push(handler(event(3 + additions, '补充' + additions))); },
  }));
  works.push(handler(event(1, '主问题'))); await started.promise; works.push(handler(event(2, '补充零')));
  await tick(); await Promise.all(works); assert.equal(questions.length, 2); assert.equal(questions[1].clock, 500);
  assert.match(questions[1].q, /主问题\n补充零/); assert.match(questions[1].q, /补充4/);
});

test('cancelling a voice wait lets the next question proceed before TTS finishes', async () => {
  const speaking = gate(), finish = gate(); let modelCalls = 0, voiceSends = 0;
  const { handler, sent, memory } = setup(async () => ++modelCalls === 1 ? JSON.stringify({ version: 2, messages: [{ type: 'text', text: '先发文字。' }, { type: 'speech', mode: 'speak', text: '还没发出的语音。', style: '' }] }) : plan('新的回复。'), {
    speech: { autoReply: true, synthesize: async () => { speaking.resolve(); await finish.promise; return { type: 'record' }; } },
    bot: { send: async (_t, text) => { sent.push(text); return [{ message_id: sent.length }]; }, sendSegments: async () => { voiceSends++; } },
  });
  const a = handler(event(1, '你好')); await speaking.promise;
  const b = handler(event(2, '改个话题')); await Promise.all([a, b]);
  assert.deepEqual(sent, ['先发文字。', '新的回复。']); assert.equal(voiceSends, 0);
  assert.ok(!memory.get(event(1)).some(row => row.speaker === '机器人' && row.text.includes('还没发出的语音')));
  finish.resolve(); await tick(); assert.equal(voiceSends, 0);
});

test('a slow group directory cannot hold up the first useful reply', async () => {
  const { handler, sent } = setup(async () => plan('用已知信息回答。'), { groups: ['30000001'], memberWaitMs: 1, members: { observe() {}, context() { return null; }, describe() { return {}; }, prepare: () => new Promise(() => {}) } });
  const request = event(1, '你好', { message_type: 'group', group_id: '30000001' }); request.message.unshift({ type: 'at', data: { qq: request.self_id } });
  await handler(request); assert.deepEqual(sent, ['用已知信息回答。']);
});

test('a corrupt tail after early text stops without protocol leakage or a duplicate repair', async () => {
  let calls = 0;
  const { handler, sent, memory } = setup(async (_q, _c, options) => { calls++; await options.onDelta('{"version":2,"messages":[{"type":"text","text":"可用的正文。"},'); return '{"version":2,"messages":[{"type":"text","text":"可用的正文。"},{"type":"unknown"}]}'; });
  await handler(event(1, '你好')); assert.deepEqual(sent, ['可用的正文。']); assert.equal(calls, 1);
  assert.match(memory.get(event(1)).at(-1).text, /可用的正文/);
});

test('interrupting a stalled SSE read cancels its reader and rejects without waiting for timeout', async () => {
  const controller = new AbortController(), reading = gate(); let cancelled = false;
  const work = askAI('你好', {}, { OPENAI_API_KEY: 'fake', OPENAI_MODEL: 'test' }, async () => new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }), { signal: controller.signal, onDelta() {} });
  await reading.promise; controller.abort(new Error('cancel fixture'));
  await assert.rejects(work, /cancel fixture/); assert.equal(cancelled, true);
});

test('an explicit voice request normalizes repeated text before anything is sent', async () => {
  const sent = [];
  const { handler } = setup(async (_q, _c, options) => { assert.equal(options.onDelta, undefined); return JSON.stringify({ version: 2, messages: [{ type: 'text', text: '今晚早点休息。' }, { type: 'speech', mode: 'speak', text: '今晚早点休息。', style: '' }] }); }, {
    speech: { synthesize: async () => ({ type: 'record' }) }, bot: { send: async (_t, text) => { sent.push(text); return []; }, sendSegments: async () => { sent.push('voice'); return {}; } },
  });
  await handler(event(1, '用语音回答')); assert.deepEqual(sent, ['voice']);
});
