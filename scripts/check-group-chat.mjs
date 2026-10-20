// Synthetic evaluation only: never connects to QQ or reads real chat history.
// --live uses the configured ChatGPT subscription model (no API fallback).
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { MessageMedia } from '../src/message-media.mjs';
import { askCodex } from '../src/codex-ai.mjs';
import { SettingsStore, modelEnv } from '../src/settings.mjs';

if (!process.argv.includes('--live')) throw new Error('合成实测会调用已登录的订阅模型；使用 node scripts/check-group-chat.mjs --live 运行。');
const store = new SettingsStore(); await store.load();
const config = store.get();
if (config.ai.backend !== 'codex') throw new Error('此脚本只使用 ChatGPT 订阅模型，不产生 API 调用。');
const env = modelEnv(config);
const event = (id, user, text, at = false, quote) => ({ post_type: 'message', message_type: 'group', group_id: '300000001',
  user_id: String(user), self_id: '100000002', message_id: id, time: Date.now() / 1000,
  sender: { card: user === 10001 ? '阿甲' : '阿乙' }, message: [...(quote ? [{ type: 'reply', data: { id: quote } }] : []),
    ...(at ? [{ type: 'at', data: { qq: '100000002' } }] : []), { type: 'text', data: { text } }] });
const scenarios = [
  { name: '区分当前成员与背景成员', before: [event(1, 10001, '我明天去跑步，阿乙喜欢打球。')], request: event(2, 10002, '刚才说要跑步的是谁？', true), check: text => /阿甲/.test(text) && !/你(?:说|明天|要去).*跑步/.test(text) },
  { name: '引用保留原作者', before: [event(1, 10001, '我明天去跑步。')], request: event(2, 10002, '这句话是谁说的？', true, '1'), check: text => /阿甲/.test(text) },
  { name: '调侃不进入检讨循环', before: [event(1, 10001, 'slyra刚才有点没接上梗，回去练练。')], request: event(2, 10002, '看来还得回去炼炼你', true), check: text => text.length < 200 && !/抱歉|对不起|下次我|我会注意|没接好|检讨/.test(text) },
];
const results = [];
for (const scenario of scenarios) {
  const memory = new ConversationMemory(), messages = new Map(scenario.before.map(row => [String(row.message_id), row]));
  let calls = 0, answer, modelAnswer, modelError;
  const media = new MessageMedia({ call: async (action, params) => { assert.equal(action, 'get_msg'); return messages.get(String(params.message_id)); } });
  const handler = createMessageHandler({ memory, groups: ['300000001'], owner: '100000001', botName: config.bot.name, media,
    catalog: { list: async () => '未提供作业数据。' }, persona: async () => ({ voice: ['自然简短地聊天，可以幽默。'] }), resources: {},
    ai: async (question, context) => { calls++; try { modelAnswer = await askCodex(question, context, env); return modelAnswer; } catch (error) { modelError = error.message; throw error; } },
    bot: { send: async (_target, text, options) => { assert.equal(String(options.mention), scenario.request.user_id); answer = text; return [{ message_id: '900' }]; } },
  });
  for (const row of scenario.before) await handler(row);
  assert.equal(calls, 0);
  await handler(scenario.request);
  const ok = calls === 1 && typeof modelAnswer === 'string' && answer === modelAnswer && scenario.check(answer);
  const result = { name: scenario.name, ok, model: config.ai.model, calls, answer, ...(modelError ? { modelError } : {}) }; results.push(result);
  console.log(JSON.stringify(result));
}
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/group-chat-evaluation.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), synthetic: true, results }, null, 2));
if (results.some(row => !row.ok)) process.exitCode = 1;
