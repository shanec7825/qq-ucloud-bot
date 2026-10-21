import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentTools, ToolAgent } from '../src/agent-tools.mjs';
import { AgentSchool } from '../src/agent-school.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { defaults } from '../src/settings.mjs';
import { qqPlainText } from '../src/qq-output.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';

const event = { message_type: 'private', user_id: '12345', self_id: '23456', accountId: 'default', profileId: 'study' };
test('QQ confirmation shows exact raw write bytes and only confirmation mutates', async () => {
  const content = '# Heading\n**text**\n```js\nconst x = `a`;\n```';
  let writes = 0;
  const tools = new AgentTools({ owner: '12345', settings: () => ({ enabled: true, writes: true }), github: { request: async () => { writes++; return { html_url: 'https://github.com/a/b/issues/1' }; } } });
  const agent = new ToolAgent({ tools, settings: () => ({ enabled: true }), ai: async () => JSON.stringify({ tool: 'github.file.write', args: { repo: 'a/b', path: 'x.md', content, message: 'save', branch: 'feature/test' } }) });
  const preview = qqPlainText(await agent.answer('github 写文件', event));
  assert.ok(preview.includes(content)); assert.equal(writes, 0);
  const code = preview.match(/\/确认 ([A-F0-9]{10})/)[1];
  assert.match(await agent.answer('/确认 ' + code, event), /操作已完成/); assert.equal(writes, 1);
  await assert.rejects(agent.answer('/确认 ' + code, event)); assert.equal(writes, 1);
});

test('school submit retains original prepared plan and revocation during recheck blocks POST', async () => {
  let revision = 0, block = false, release, reached;
  const ready = new Promise(resolve => { reached = resolve; });
  let posts = 0;
  const view = { assignmentContent: '', attachmentIds: [], commitId: '', status: 2, assignmentStatus: 99, isOvertimeCommit: 0 };
  const client = { publicDetail: async () => ({}), request: async (path, payload) => {
    if (payload) { posts++; return {}; }
    if (block && path.includes('submit-view')) { reached(); await new Promise(resolve => { release = resolve; }); }
    return { data: path.includes('/detail?') ? { assignmentTitle: '练习', assignmentType: 0 } : structuredClone(view) };
  } };
  const schoolSubmission = new AgentSchool(client, { getUserId: async () => '12345' });
  const tools = new AgentTools({ owner: '12345', settings: () => ({ enabled: true, writes: true }), signature: () => revision, school: client, schoolSubmission });
  const proposal = await tools.execute('school.submit', { assignmentId: '42', content: '答案' }, event);
  assert.equal(posts, 0); assert.equal(proposal.preview.args.title, '练习'); assert.equal(JSON.stringify(proposal.preview).includes('userId'), false);
  block = true;
  const confirmation = tools.confirm(proposal.instruction.split(' ').at(-1), event);
  await ready; revision++; release(); await assert.rejects(confirmation); assert.equal(posts, 0);
});

test('ordinary OAuth access-token refresh does not invalidate pending action scope', () => {
  const config = defaults({}); config.github.enabled = config.drive.enabled = config.school.enabled = false; config.agent.enabled = true;
  let tokens = 'old';
  const runtime = new BotRuntime({ get: () => structuredClone(config) }, { get: key => key === 'googleTokens' ? tokens : '' });
  const agent = runtime.agent(config), original = agent.tools.scope(event);
  tokens = 'refreshed access token'; assert.equal(agent.tools.scope(event), original);
  runtime.google.authorizationRevision = 1; assert.notEqual(agent.tools.scope(event), original);
  runtime.stop();
});

test('passive notification intake works with chat disabled but rejects inactive transports', async () => {
  let observed = 0, observeEnabled = true;
  const handler = createMessageHandler({ bot: { send: () => assert.fail() }, memory: {}, getDependencies: () => ({ enabled: false, observeEnabled, observe: () => { observed++; } }) });
  const incoming = { post_type: 'message', message_type: 'group', user_id: '12345', self_id: '23456' };
  await handler(incoming); assert.equal(observed, 1);
  observeEnabled = false; await handler(incoming); assert.equal(observed, 1);
  observeEnabled = true; await handler({ ...incoming, user_id: '23456' }); assert.equal(observed, 1);
});

test('tool followups reuse scoped results and never cross accounts', async () => {
  const sessions = new Map(); let captured, steps = 0;
  const tools = new AgentTools({ owner: '12345', github: { request: async () => ({ id: 'selected' }) } });
  const make = () => new ToolAgent({ tools, sessions, settings: () => ({ enabled: true, maxSteps: 2 }), ai: async (question, context) => {
    captured = context; return JSON.stringify(steps++ === 0 ? { tool: 'github.repos', args: {} } : { answer: '已找到' });
  } });
  await make().answer('github 项目', event);
  assert.equal(await make().answer('把刚才那个打开', { ...event, accountId: 'other' }), null);
  assert.equal(await make().answer('把刚才那个打开', event), '已找到');
  assert.equal(captured.context.previousTools[0].tool, 'github.repos');
});
