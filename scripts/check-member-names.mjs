// Uses synthetic member names and the configured ChatGPT subscription. Never sends QQ messages.
import assert from 'node:assert/strict';
import { SettingsStore, modelEnv } from '../src/settings.mjs';
import { GroupMembers } from '../src/group-members.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { askCodex } from '../src/codex-ai.mjs';
if (!process.argv.includes('--live')) throw new Error('实测需显式传入 --live；使用 ChatGPT 订阅，不回退到 API。');
const store = new SettingsStore(); await store.load(); const config = store.get();
if (config.ai.backend !== 'codex') throw new Error('仅支持已登录的 ChatGPT 订阅实测。');
const memory = new ConversationMemory();
const roster = [{ user_id: '10001', card: '群名片甲', nickname: 'QQ昵称甲' }, { user_id: '10002', card: '静默群友的名片', nickname: 'QQ昵称乙' }];
const members = new GroupMembers({ call: async action => action === 'get_group_member_list' ? roster : { group_id: '300000001', group_name: '合成测试群' } }, () => ['300000001']);
let answer;
const handler = createMessageHandler({ memory, members, groups: ['300000001'], owner: '100000001', botName: config.bot.name,
  bot: { send: async () => [] }, persona: async () => ({ voice: [] }), resources: {}, catalog: { list: async () => '' },
  ai: async (question, context) => { answer = await askCodex(question, context, modelEnv(config)); return answer; } });
await handler({ post_type: 'message', message_type: 'group', group_id: '300000001', user_id: '10001', self_id: '100000002', message_id: 1,
  sender: { card: '', nickname: 'QQ昵称甲' }, message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'at', data: { qq: '10002' } },
    { type: 'text', data: { text: '请用群名片称呼我，并说出我刚才@的另一位群友的群名片。' } }] });
assert.ok(answer?.includes('群名片甲') && answer.includes('静默群友的名片'), '模型没有正确使用群名片');
console.log(JSON.stringify({ ok: true, model: config.ai.model, synthetic: true, answer }));
