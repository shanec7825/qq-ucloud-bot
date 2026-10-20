import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SettingsStore } from '../src/settings.mjs';
import { moduleActive } from '../src/plugin-modules.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { askAI } from '../src/core.mjs';

async function fixture(run) {
  const folder = await mkdtemp(join(tmpdir(), 'qq-agent-modules-')), root = pathToFileURL(folder + '/');
  try { await run(root); } finally { await rm(folder, { recursive: true, force: true }); }
}

test('模块开关独立生效，未安装/已停用默认拒绝，不覆盖保存的名字与服务配置', () => fixture(async root => {
  const store = new SettingsStore(new URL('settings.json', root), { OWNER_QQ: '100000001' }); await store.load();
  assert.equal(moduleActive(root, 'github'), true);
  await writeFile(new URL('napcat-ui.json', root), JSON.stringify({ managedModules: true })); await mkdir(new URL('napcat-modules/', root));
  assert.equal(moduleActive(root, 'github'), false);
  await writeFile(new URL('napcat-modules/github.json', root), JSON.stringify({ active: true }));
  const before = store.get(), runtime = new BotRuntime(store, { get: () => '' }, { root });
  assert.equal(runtime.config().github.enabled, true); assert.equal(runtime.config().drive.enabled, false); assert.equal(runtime.dependencies().enabled, false);
  await writeFile(new URL('napcat-modules/github.json', root), JSON.stringify({ active: false })); assert.equal(runtime.config().github.enabled, false);
  assert.deepEqual(store.get(), before); runtime.stop();
}));

test('更换回答模型为兼容 API 仍可使用 ChatGPT 资料连接器，仅传所选正文，不转交连接凭据', () => fixture(async root => {
  const store = new SettingsStore(new URL('settings.json', root), { OWNER_QQ: '100000001' }); await store.load();
  const next = store.get(); next.ai.backend = 'api'; next.ai.apiModel = 'compatible-model'; next.drive.authMode = 'chatgpt'; next.school.enabled = false; await store.update(next, next.revision);
  const sent = [], runtime = new BotRuntime(store, { get: name => name === 'openaiKey' ? 'fake-api-key' : name === 'onebotToken' ? 'fake-onebot' : '' }, { root,
    botFactory: () => ({ connect() {}, close() {}, send: async (_target, text) => sent.push(text), call: async () => [] }) });
  let reads = 0, body;
  runtime.native.driveQuestion = async () => { reads++; return '所选教材正文：偏序关系满足自反、反对称、传递。'; };
  runtime.ai = async (question, context, config) => askAI(question, context, { ...runtime.env(config), OPENAI_BASE_URL: 'https://api.example.test/v1' }, async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '根据正文，自反、反对称、传递。' } }] }) }; });
  runtime.bot = runtime.botFactory();
  await runtime.handler({ post_type: 'message', message_type: 'private', user_id: '100000001', self_id: '100000002', message_id: 1, message: [{ type: 'text', data: { text: '读取我的网盘课程内容.pdf' } }] });
  assert.equal(reads, 1); assert.equal(body.model, 'compatible-model'); assert.ok(body.messages[1].content.includes('所选教材正文')); assert.ok(!body.messages[1].content.includes('fake-api-key')); assert.equal(sent.length, 1); runtime.stop();
}));
