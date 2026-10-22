import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { defaults, validateSettings, modelEnv } from '../src/settings.mjs';
import { profileSettings } from '../src/group-policy.mjs';
import { selectedModel } from '../src/ai-providers.mjs';
import { askDeepSeek } from '../src/deepseek-ai.mjs';
import { askHarness } from '../src/deepseek-harness.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';

test('旧设置补齐 DeepSeek 字段，切换来源保留各模型与原 API 地址', () => {
  const old = defaults({}); for (const key of ['deepseekModel','deepseekThinking','harnessModel','harnessAuth']) delete old.ai[key];
  const config = validateSettings(old);
  assert.equal(old.ai.deepseekModel, undefined); assert.equal(config.ai.backend, 'codex');
  assert.equal(config.ai.deepseekModel, 'deepseek-flash'); assert.equal(config.ai.deepseekThinking, false);
  config.ai.apiModel = 'old-api'; config.ai.deepseekModel = 'deepseek-v4-pro'; config.ai.harnessModel = 'deepseek-flash';
  for (const backend of ['codex', 'api', 'deepseek', 'deepseek-harness']) {
    config.ai.backend = backend; const next = validateSettings(config);
    assert.equal(next.ai.apiModel, 'old-api'); assert.equal(next.ai.deepseekModel, 'deepseek-v4-pro'); assert.equal(next.ai.baseURL, 'https://api.openai.com/v1');
  }
  assert.equal(defaults({ AI_BACKEND: 'deepseek' }).ai.backend, 'deepseek');
  assert.throws(() => validateSettings({ ...config, ai: { ...config.ai, harnessAuth: 'unknown' } }));
});

test('角色模型覆盖作用于当前提供方，DeepSeek 密钥与 OpenAI 密钥分开', () => {
  const config = defaults({}); config.groups = [{ id: '12345', enabled: true, profileId: 'p' }]; config.profiles = [{ id: 'p', name: '角色', systemPrompt: '风格', model: 'role-model' }];
  for (const backend of ['codex','api','deepseek','deepseek-harness']) {
    config.ai.backend = backend; const next = profileSettings(config, '12345');
    assert.equal(selectedModel(next), 'role-model'); assert.notEqual(selectedModel(config), 'role-model');
  }
  const env = modelEnv(config, { openaiKey: 'openai-only', deepseekKey: 'deepseek-only' }, {});
  assert.equal(env.OPENAI_API_KEY, 'openai-only'); assert.equal(env.DEEPSEEK_API_KEY, 'deepseek-only');
});

test('DeepSeek API 使用官方地址、独立密钥与思考开关，不受 OpenAI 地址影响', async () => {
  for (const thinking of ['false','true']) {
    const answer = await askDeepSeek('你好', {}, { DEEPSEEK_API_KEY: 'deepseek-only', OPENAI_API_KEY: 'wrong-key', OPENAI_BASE_URL: 'https://wrong.test', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_THINKING: thinking }, async (url, options) => {
      assert.equal(url.href, 'https://api.deepseek.com/chat/completions'); assert.equal(options.headers.authorization, 'Bearer deepseek-only'); assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body); assert.equal(body.model, 'deepseek-flash'); assert.equal(body.thinking.type, thinking === 'true' ? 'enabled' : 'disabled'); assert.equal(body.stream, false);
      assert.ok(!options.body.includes('wrong-key')); return Response.json({ choices: [{ message: { content: '你好' } }] });
    }); assert.equal(answer, '你好');
  }
  await assert.rejects(() => askDeepSeek('你好', {}, { OPENAI_API_KEY: 'not-deepseek' }), /DeepSeek API Key/);
  await assert.rejects(() => askDeepSeek('你好', {}, { DEEPSEEK_API_KEY: 'k' }, async () => new Response('', { status: 401 })), /HTTP 401/);
});

function harnessFixture({ failure, terminal = 'completed', errorCode, tools = false, hang = false, server = 'deepseek-harness-sdk-runtime' } = {}) {
  const calls = [], child = new EventEmitter(); let killed = 0, cleaned = 0, received = '';
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { killed++; child.emit('close', 143); };
  const notify = (sessionId, { type, ...data }) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session.event', params: { sessionId, event: { type, data } } }) + '\n');
  child.stdin.on('data', chunk => {
    received += chunk; for (const line of chunk.toString().trim().split('\n')) {
      const frame = JSON.parse(line); calls.push(frame);
      queueMicrotask(() => {
        if (hang) return;
        child.stdout.write('[llm-deepseek-account] model listing loaded\nnull\n');
        if (frame.method === 'session/prompt') {
          notify('another-session', { type: 'assistant/message', message: { content: [{ type: 'text', text: '其他会话秘密' }] } });
          notify(frame.params.sessionId, { type: 'request/header', header: { ...(tools ? { tools: [{ name: 'shell' }] } : {}) } });
          notify(frame.params.sessionId, { type: 'assistant/message', message: { content: [{ type: 'text', text: '最终答案' }] } });
          notify(frame.params.sessionId, { type: 'turn/end', reason: { kind: terminal, ...(errorCode ? { error: { code: errorCode } } : {}) } });
        }
        child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...(failure ? { error: { code: -32603, message: 'PRIVATE_UPSTREAM_SECRET' } } : { result: frame.method === 'initialize' ? { serverInfo: { name: server } } : {} }) }) + '\n');
      });
    }
  });
  const options = { timeoutMs: 1000, prepare: async () => ({ binary: 'node', args: ['dsh.js','--profile','sdk-minimal'], cwd: 'isolated', env: {}, cleanup: async () => { cleaned++; } }),
    spawner: (_binary, args, options) => { assert.equal(options.shell, false); assert.ok(!args.some(arg => arg.includes('私人问题'))); return child; } };
  return { calls, options, child, killed: () => killed, cleaned: () => cleaned, received: () => received };
}

test('Harness 经 SDK stdin 传入问题，只接受本会话成功终态并清理进程', async () => {
  const f = harnessFixture();
  assert.equal(await askHarness('私人问题', {}, { DEEPSEEK_HARNESS_AUTH: 'account', DEEPSEEK_HARNESS_MODEL: 'chosen-model' }, f.options), '最终答案');
  assert.equal(f.calls[0].params.provider, 'deepseek-account'); assert.equal(f.calls[0].params.model, 'chosen-model');
  assert.deepEqual(f.calls.map(row => row.method), ['initialize','session/prompt','session/wait']);
  assert.ok(f.received().includes('私人问题')); assert.equal(f.killed(), 1); await setImmediate(); assert.equal(f.cleaned(), 1);
});

test('Harness 拒绝错误提供方、失败终态、工具目录和协议错误，不转发原始诊断', async () => {
  for (const config of [{ failure: true }, { terminal: 'error' }, { terminal: 'max-tokens' }, { tools: true }, { server: 'wrong-peer' }]) {
    const f = harnessFixture(config);
    await assert.rejects(() => askHarness('问题', {}, {}, f.options), error => !error.message.includes('PRIVATE_UPSTREAM_SECRET') && /Harness/.test(error.message));
    assert.equal(f.killed(), 1); await setImmediate(); assert.equal(f.cleaned(), 1);
  }
  const f = harnessFixture({ hang: true }); f.options.timeoutMs = 10;
  await assert.rejects(() => askHarness('问题', {}, {}, f.options), /超时/); assert.equal(f.killed(), 1);
});

test('Harness 账号额度不足显示可处理原因，不冒充连接成功', async () => {
  const f=harnessFixture({terminal:'error',errorCode:'ACCOUNT_QUOTA'});
  await assert.rejects(()=>askHarness('问题',{}, {},f.options),/账号额度不足/);
});

test('原生配置页切换 DeepSeek 后隐藏无关凭据，保存使用独立密钥', async () => {
  const state = { settings: defaults({}), status: {} }, calls = [];
  const bridge = { async request(method, path, value) { calls.push({ method, path, value }); return { status: 200, data: path === 'state' ? state : path === 'memory' ? { notes:[],digests:[],conversations:[] } : path === 'inbox' ? {items:[]} : {} }; } };
  const adapter = createNativeConfigAdapter({ bridge }), form = await adapter.getConfig(); form.page = 'ai';
  const field = suffix => adapter.schema(form).find(row => row.key.endsWith('__' + suffix));
  assert.equal(field('backend').options.length, 6); form[field('backend').key] = 'deepseek';
  assert.equal(field('deepseekModel').default, 'deepseek-flash'); assert.equal(field('openaiKey'), undefined); assert.equal(field('mimoKey'), undefined);
  form[field('deepseekKey').key] = 'new-deepseek-key'; await adapter.setConfig(form);
  assert.equal(calls.find(row => row.path === 'secrets').value.deepseekKey, 'new-deepseek-key');
  const other = await adapter.getConfig(); other.page = 'ai';
  const backend = adapter.schema(other).find(row => row.key.endsWith('__backend')); other[backend.key] = 'deepseek-harness';
  let schema = adapter.schema(other), auth = schema.find(row => row.key.endsWith('__harnessAuth')); other[auth.key] = 'account'; schema = adapter.schema(other);
  assert.equal(schema.some(row => row.key.endsWith('__deepseekKey')), false);
  assert.ok(schema.find(row => row.key.startsWith('action_')).options.every(row => ['none','check/model'].includes(row.value)));
});
