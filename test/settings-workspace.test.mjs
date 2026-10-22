import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { SchoolClient } from '../src/core.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';
import { defaults } from '../src/settings.mjs';
import { allowedRoute } from '../napcat-plugin/bridge.mjs';

test('contact choices stay within the selected account and report partial failures', async () => {
  const calls = [], runtime = Object.create(BotRuntime.prototype);
  runtime.proxy = { async call(action, args, options) { calls.push({ action, args, options }); if (action === 'get_friend_list') return [{ user_id: 12345678, nickname: '同学', remark: '课程助教' }]; throw Error('offline'); } };
  const result = await runtime.contacts('second');
  assert.deepEqual(result.friends, [{ id: '12345678', name: '课程助教' }]);
  assert.deepEqual(result.groups, []); assert.equal(result.errors.length, 1);
  assert.ok(calls.every(c => c.options.accountId === 'second'));
  assert.ok(calls.every(c => !/send|delete/.test(c.action)));
});

test('school notifications use the signed-in identity and return text without resource credentials', async () => {
  const folder = await mkdtemp(resolve('data/school-reader-test-')), file = pathToFileURL(folder + sep + 'session.json'), calls = [];
  try {
    await writeFile(file, JSON.stringify({ userId: '12345678901234567890', headers: { 'blade-auth': 'fixture-token' } }));
    const client = new SchoolClient(file, async (url, options) => { calls.push({ url: new URL(url), options }); return new Response(JSON.stringify({ code: 200, data: { records: [{ id: '42', newsTitle: '<b>作业提醒</b>', newsInfo: '<script>bad()</script><p>明天截止</p>', newsCopyTime: '2026-10-22 08:00', isRead: 0, token: 'must-not-export' }], total: 21 } })); });
    const result = await client.notices(2);
    assert.equal(result.items[0].title, '作业提醒'); assert.equal(result.items[0].content, '明天截止'); assert.equal(result.items[0].unread, true);
    assert.equal(result.page, 2); assert.equal(result.total, 21); assert.ok(!JSON.stringify(result).includes('must-not-export'));
    assert.equal(calls[0].url.searchParams.get('newsCopyPersonId'), '12345678901234567890');
    assert.equal(calls[0].url.searchParams.get('current'), '2'); assert.match(calls[0].url.pathname, /\/news\/list$/);
    assert.equal(calls[0].options.body, '{}'); assert.equal(calls.length, 1);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('workspace read endpoints require admin authentication, enabled accounts and valid IDs', async () => {
  const folder = await mkdtemp(resolve('data/settings-reader-test-')), root = pathToFileURL(folder + sep), settings = defaults({}), calls = [];
  settings.school.enabled = true;
  const runtime = { config: () => settings, contacts: async id => { calls.push(id); return { groups: [], friends: [], errors: [] }; }, school: {
    tasks: async () => ({ fixture: true }), notices: async page => ({ items: [], page }), detail: async id => { calls.push(id); return '作业正文'; },
  } };
  const admin = await startAdmin({ store: { get: () => settings }, vault: {}, runtime, root, port: 0 });
  let cookie, csrf;
  const call = (path, value) => fetch(admin.origin + '/api/' + path, { method: 'POST', headers: { origin: admin.origin, 'content-type': 'application/json', ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}) }, body: JSON.stringify(value) });
  try {
    assert.equal((await call('ucloud/view', { section: 'tasks' })).status, 401);
    const login = await call('session', { key: admin.accessKey }); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
    assert.equal((await call('qq/contacts', { accountId: 'missing' })).status, 400);
    assert.equal((await call('qq/contacts', { accountId: 'default' })).status, 200);
    for (const value of [{ section: 'detail', id: '../secret' }, { section: 'notices', page: -1 }, { section: 'notices', userId: 'forged' }, { section: 'submit' }]) assert.equal((await call('ucloud/view', value)).status, 400);
    const detail = await call('ucloud/view', { section: 'detail', id: '12345678901234567890' }); assert.equal((await detail.json()).content, '作业正文');
    assert.deepEqual(calls, ['default', '12345678901234567890']);
    runtime.school.notices = async () => { throw Object.assign(Error('RENEWAL_REJECTED'),{code:'RENEWAL_REJECTED',status:401}); };
    const expired = await call('ucloud/view',{section:'notices'}); assert.equal(expired.status,400); assert.match((await expired.json()).error,/登录已过期/);
    settings.school.enabled = false; assert.equal((await call('ucloud/view', { section: 'tasks' })).status, 400);
    assert.equal(allowedRoute('POST', 'ucloud/view'), true); assert.equal(allowedRoute('POST', 'qq/contacts'), true); assert.equal(allowedRoute('POST', 'ucloud/submit'), false);
  } finally { await admin.close(); await rm(folder, { recursive: true, force: true }); }
});
