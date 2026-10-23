import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defaults, validateSettings, SettingsStore } from '../src/settings.mjs';
import { resolveConversation, contactMemoryMode, profileSettings, resolveGroupPolicy } from '../src/group-policy.mjs';
import { SchoolClient, askAI, saveJSON } from '../src/core.mjs';
import { ConversationLearner, learningScope } from '../src/conversation-learning.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { OutgoingMedia } from '../src/outgoing-media.mjs';
import { OnlineMedia, ONLINE_MEDIA } from '../src/online-media.mjs';
import { calendarExport } from '../src/calendar-export.mjs';
import { speechContext } from '../src/speech-direction.mjs';

async function fixture(work) {
  const parent = new URL('../data/test-tmp/', import.meta.url); await mkdir(parent, { recursive: true });
  const path = await mkdtemp(fileURLToPath(new URL('product-', parent))), root = pathToFileURL(join(path, '/'));
  try { await work(root); } finally { await rm(path, { recursive: true, force: true }); }
}
const event = { post_type: 'message', accountId: 'default', message_type: 'private', user_id: '123456', self_id: '654321', message_id: '1', message: [{ type: 'text', data: { text: '我喜欢喝茶' } }] };

test('contact mode and explicit global role override every transport legacy persona; group rules are shared', () => {
  const cfg = defaults({ ALLOWED_GROUPS: '987654' });
  cfg.profiles.push({ id: 'legacy', name: '旧角色', systemPrompt: '旧设定', model: 'gpt-model' });
  cfg.accounts[0].defaultProfileId = 'legacy'; cfg.accounts.push({ ...cfg.accounts[0], id: 'second', url: 'ws://127.0.0.1:3002' });
  cfg.chat.memoryContacts = [{ id: '123456', mode: 'memory', profileId: '' }];
  for (const accountId of ['default', 'second']) {
    assert.equal(resolveConversation(cfg, { ...event, accountId }).profileId, '');
    assert.equal(contactMemoryMode(cfg, { ...event, accountId }), 'memory');
    assert.equal(resolveGroupPolicy(cfg, '987654', accountId).canReply, true);
  }
  assert.equal(contactMemoryMode(cfg, { ...event, user_id: '222222' }), 'normal');
  const invalid = structuredClone(cfg); invalid.chat.memoryContacts[0].profileId = 'missing'; assert.throws(() => validateSettings(invalid));
  cfg.ai.backend = 'mimo-token-plan-cn'; cfg.groups[0].profileId = 'legacy';
  assert.equal(profileSettings(cfg, '987654').ai.mimoModel, cfg.ai.mimoModel);
});

test('MiMo requests explicitly disable extra reasoning and reject incomplete outputs', async () => {
  const env = { AI_BACKEND: 'mimo-token-plan-cn', OPENAI_API_KEY: 'tp-test', OPENAI_MODEL: 'mimo-v2.6-pro', OPENAI_BASE_URL: 'https://token-plan-cn.xiaomimimo.com/v1' };
  let body;
  const fetcher = async (_url, options) => { body = JSON.parse(options.body); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }); };
  assert.equal(await askAI('test', {}, env, fetcher), 'ok'); assert.equal(body.thinking.type, 'disabled'); assert.equal(body.stream, false);
  await assert.rejects(askAI('test', {}, env, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{partial' } }] })), /未完整/);
});

test('missing or malformed UCloud credentials give a direct login action without file paths', () => fixture(async root => {
  const client = new SchoolClient(new URL('missing.json', root), () => { throw Error('must not fetch'); });
  await assert.rejects(client.tasks(), error => /尚未登录|重新登录/.test(error.message) && !/file:|npm|capture|[A-Z]:\\/.test(error.message));
  await saveJSON(client.file, { userId: '123' }); await assert.rejects(client.notices(), /认证/);
}));

test('unified voice directive migrates once and becomes authoritative over hidden legacy fields', () => {
  const cfg = defaults({}); delete cfg.speech.directiveVersion; cfg.speech.model = 'mimo-v2.5-tts-voicedesign'; cfg.speech.voiceDescription = '温润青年声线'; cfg.speech.style = '语速慢';
  const migrated = validateSettings(cfg); assert.equal(migrated.speech.style, '温润青年声线；语速慢');
  migrated.speech.style = '清亮女声，自然欢快'; const saved = validateSettings(migrated);
  assert.equal(saved.speech.style, '清亮女声，自然欢快'); assert.doesNotMatch(speechContext(saved.speech), /温润青年/);
});

test('normal contacts never read speech memory and runtime forwards the actual retrieval query', () => fixture(async root => {
  const store = new SettingsStore(new URL('settings.json', root), { ALLOWED_GROUPS: '987654' }); await store.load();
  const initial = store.get(); initial.speech.enabled = true; await store.update(initial, initial.revision);
  const runtime = new BotRuntime(store, { get: () => '' }, { root }); runtime.apply();
  runtime.memory.get = () => [{ speaker: 'other', text: 'PRIVATE_GROUP_MEMORY' }]; let context;
  runtime.ai = async (_question, value) => { context = value; return '{"style":"自然"}'; };
  try {
    await runtime.dependencies({ ...event, message_type: 'group', group_id: '987654' }).speech.plan('你好', event);
    assert.deepEqual(context.conversation, []);
    const cfg = store.get(); cfg.chat.memoryContacts = [{ id: event.user_id, mode: 'memory', profileId: '' }]; await store.update(cfg, cfg.revision); runtime.apply();
    runtime.learner.context = async (_event, options) => { context = options; return []; };
    await runtime.dependencies(event).notes.context(event, '我最喜欢什么茶'); assert.equal(context.query, '我最喜欢什么茶');
  } finally { runtime.stop(); }
}));

test('clearing a contact invalidates its first in-flight learning batch even before durable entries exist', () => fixture(async root => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const learner = new ConversationLearner({ root, ai: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  try {
    learner.observe(event, { mode: 'memory' }); const pending = learner.flush({ force: true }); await ready;
    await learner.clearContact(event.user_id); finish(JSON.stringify({ memories: [{ key: 'tea', kind: 'preference', confidence: 0.95, source: 'm1', evidence: '我喜欢喝茶' }] }));
    await pending; assert.deepEqual(await learner.list(), []);
  } finally { learner.close(); }
}));

test('disabling the independent speech module disables explicit synthesis as well as automatic replies', () => fixture(async root => {
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  const cfg = store.get(); cfg.speech.enabled = true; await store.update(cfg, cfg.revision);
  await saveJSON(new URL('napcat-ui.json', root), { managedModules: true });
  await saveJSON(new URL('napcat-modules/core.json', root), { active: true });
  await saveJSON(new URL('napcat-modules/speech.json', root), { active: false });
  const runtime = new BotRuntime(store, { get: () => 'tp-fixture' }, { root });
  try { assert.equal(runtime.dependencies(event).speech, null); await assert.rejects(runtime.speech.synthesize('hello'), /启用/); }
  finally { runtime.stop(); }
}));

test('online media only imports fixed public templates, deduplicates and shares across transports', () => fixture(async root => {
  const media = new OutgoingMedia(root); let requests = 0;
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const online = new OnlineMedia(media, async (url, options) => { requests++; assert.equal(new URL(url).hostname, 'api.memegen.link'); assert.equal(options.redirect, 'error'); return new Response(gif); });
  assert.throws(() => online.add('https://127.0.0.1/private'));
  const [one, two] = await Promise.all([online.add(ONLINE_MEDIA[0].id), online.add(ONLINE_MEDIA[0].id)]); assert.equal(one.id, two.id); assert.equal(requests, 1);
  assert.equal((await online.catalog())[0].saved, true);
  for (const accountId of ['default', 'second']) assert.equal((await media.available({ ...event, accountId }))[0].id, one.id);
}));

test('calendar export requires explicit valid dates, preserves code and escapes ICS control lines', () => {
  const item = { id: 'a', title: '作业\nBEGIN:VEVENT', summary: '代码：\nconst n = 1;', sources: [{ excerpt: '周五截止' }] };
  assert.throws(() => calendarExport(item, {})); assert.throws(() => calendarExport(item, { start: '2026-02-30', end: '2026-03-02', allDay: true }));
  const preview = calendarExport(item, { start: '2026-10-23T10:00+08:00', end: '2026-10-23T11:00+08:00' }, 0);
  assert.equal(new URL(preview.googleUrl).hostname, 'calendar.google.com'); assert.match(preview.ics, /const n = 1/); assert.equal(preview.ics.split('\r\nBEGIN:VEVENT').length, 2); assert.equal(preview.mode, 'preview');
});
