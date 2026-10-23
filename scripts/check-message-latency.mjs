// One synthetic question to the already configured model; QQ is a local sink.
// No real contacts, memories, attachments, audio or model text are logged.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SecretVault } from '../src/secret-vault.mjs';
import { modelEnv } from '../src/settings.mjs';
import { askAI } from '../src/core.mjs';
import { askDeepSeek } from '../src/deepseek-ai.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { ConversationMemory } from '../src/persona.mjs';

if (!process.argv.includes('--live-model')) throw Error('Use --live-model to allow one real model request with a synthetic question.');
const flag = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const root = pathToFileURL(resolve(flag('--root') || process.cwd(), 'data') + '/');
const settings = JSON.parse(await readFile(new URL('settings.json', root), 'utf8'));
assert.ok(['api', 'mimo-api', 'mimo-token-plan-cn', 'deepseek'].includes(settings.ai.backend), 'This probe requires a Chat Completions model.');
const vault = new SecretVault(root); await vault.load();
const keyName = settings.ai.backend === 'deepseek' ? 'deepseekKey' : settings.ai.backend.startsWith('mimo') ? 'mimoKey' : 'openaiKey';
const env = modelEnv(settings, { [keyName]: vault.get(keyName) }, {});
env.BOT_SYSTEM_PROMPT = '延迟测试。回复严格按宿主的 JSON 格式。第一项用一句话回答，第二项用约一百五十字解释。仅文字。';
env.BOT_NAME = '本地测试';
const startedAt = performance.now(), receipts = []; let modelCompletedMs = null, deltaCount = 0;
const handler = createMessageHandler({ groups: [], owner: '', memory: new ConversationMemory(), catalog: { list: async () => [] }, resources: {},
  ai: async (q, context, options) => {
    const onDelta = options.onDelta;
    const modelOptions = { ...options, onDelta: async delta => { deltaCount++; await onDelta(delta); } };
    const answer = await (settings.ai.backend === 'deepseek' ? askDeepSeek(q, context, env, fetch, modelOptions) : askAI(q, context, env, fetch, modelOptions));
    modelCompletedMs = Math.round(performance.now() - startedAt); return answer;
  },
  bot: { send: async () => { receipts.push(Math.round(performance.now() - startedAt)); return [{ message_id: receipts.length }]; }, sendSegments: async () => { throw Error('Probe only allows text.'); } },
});
await handler({ post_type: 'message', message_type: 'private', user_id: '10000001', self_id: '20000001', message_id: 1,
  message: [{ type: 'text', data: { text: '这是延迟测试。为什么天空通常是蓝色？先用一句简短的话直接回答，再用约一百五十字解释原理。' } }] });
assert.ok(modelCompletedMs !== null && receipts.length > 0, 'Model probe did not complete successfully.');
const report = { checkedAt: new Date().toISOString(), backend: settings.ai.backend, model: env.OPENAI_MODEL || env.DEEPSEEK_MODEL,
  firstLocalReceiptMs: receipts[0], modelCompletedMs, firstTextLeadMs: modelCompletedMs - receipts[0], deltaCount,
  localTextMessages: receipts.length, liveModelRequests: 1, qqMessagesSent: 0, liveQqDeliveryVerified: false };
if (flag('--report')) await writeFile(resolve(flag('--report')), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
