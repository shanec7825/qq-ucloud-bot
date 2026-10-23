// Isolated fixtures only: no real QQ, external requests, model calls or personal settings.
// --serve-only [--port 6211] keeps this fixture available for browser visual inspection.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { defaults, validateSettings } from '../src/settings.mjs';
import { calendarExport } from '../src/calendar-export.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';
import { registerBridge } from '../napcat-plugin/bridge.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
import { SpeechReferenceStore } from '../src/speech-reference.mjs';

const nativeRoot = resolve('tools/napcat/napcat/static');
const serveOnly = process.argv.includes('--serve-only');
const requestedPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 0;
assert.ok(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535, 'Invalid fixture port');
const tinyGif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const unsafeText = '<img src=x onerror="window.injected=true">';
const now = '2026-10-23T02:00:00.000Z';
let settings = defaults({});
settings.bot.ownerQQ = '123456789';
settings.school.enabled = true;
settings.profiles = [{ id: 'mentor', name: '实验导师', systemPrompt: '先预测，再实验。', model: '' }];
settings.groups = [{ id: '23456789', name: '实验群', enabled: true, historyEnabled: false, template: 'auto', templatePrompt: '', profileId: '' }];
let writes = [], saves = 0, speechPreviews = 0, mediaUploads = 0, schoolLogins = 0, schoolFailure = true;
const speechReferences = new SpeechReferenceStore(new URL('../data/ui-fixtures/clone-fixture/', import.meta.url));
const speechRequests = [];
let referenceChunks = 0;
const referenceWav = Buffer.alloc(120044);
referenceWav.write('RIFF'); referenceWav.writeUInt32LE(referenceWav.length - 8, 4); referenceWav.write('WAVEfmt ', 8);
referenceWav.writeUInt32LE(16, 16); referenceWav.writeUInt16LE(1, 20); referenceWav.writeUInt16LE(1, 22);
referenceWav.writeUInt32LE(24000, 24); referenceWav.writeUInt32LE(48000, 28); referenceWav.writeUInt16LE(2, 32);
referenceWav.writeUInt16LE(16, 34); referenceWav.write('data', 36); referenceWav.writeUInt32LE(referenceWav.length - 44, 40);
const contactRequests = [], mediaItems = [], connectorChecks = {}, calendarPreviews = [], galleryImports = [];
const scope = 'account:default:profile:_:private:123456789';
const learned = [{ id: 'a'.repeat(24), scope, contactId: '123456789', text: '我喜欢先实验再讲原理 ' + unsafeText, kind: 'preference', updatedAt: now, sources: [{ evidence: '我喜欢先实验再讲原理 ' + unsafeText, observedAt: now, messageId: '101', contactId: '123456789' }] }];
const memory = {
  notes: [{ id: 'n1', scope: 'global', text: unsafeText, kind: 'fact', tags: [], enabled: true, updatedAt: now }],
  digests: [{ groupId: '23456789', name: '实验群', digest: { summary: '第二章作业周五截止' } }],
  conversations: [{ scope, entries: [{ speaker: '用户', text: '什么时候截止？', time: now }, { speaker: '机器人', text: '周五 18 点', time: now }], background: [] }],
};
const contacts = { groups: [{ id: '23456789', name: '实验群' }, { id: '34567890', name: '名称很长的课程通知和作业交流讨论群用于验证窄屏适配' }], friends: [{ id: '123456789', name: '课程助教' }, { id: '987654321', name: '学习搭子' }], errors: [] };
const notifications = [
  { id: 'notice-a', groupId: '23456789', groupName: '实验群', title: '提交课程作业', summary: '周五前完成 ' + unsafeText, deadlineText: '周五 18 点', sources: [{ excerpt: '原始通知：周五 18 点截止', time: now }], createdAt: now },
  { id: 'notice-b', groupId: '34567890', groupName: contacts.groups[1].name, title: '课程实验报名', summary: '到课程平台填写报名表', sources: [{ excerpt: '实验报名开放，请填写课程平台表格', time: now }], createdAt: now },
];
const digestItems = [{ id: 'report-a:task-a', groupId: '23456789', groupName: '实验群', title: '第二章整理', summary: '完成第二章习题', sources: [{ excerpt: '请提交第二章作业', time: now }], createdAt: now }];
const reports = [{ id: 'report-a', groupId: '23456789', groupName: '实验群', createdAt: now, items: [{ id: 'task-a', ...digestItems[0] }], delivery: 'local' }];
const todos = [];
const online = [
  { id: 'fine', name: '小埋·开心', pack: '干物妹！小埋', tags: ['开心'] },
  { id: 'success', name: '小埋·抱抱', pack: '干物妹！小埋', tags: ['安慰'] },
  ...Array.from({ length: 28 }, (_, index) => ({ id: 'cell-' + index, name: '工作细胞·示例' + index, pack: '工作细胞', tags: ['收到'] })),
].map(item => ({ ...item, category: '日系动漫', sourceURL: 'https://github.com/lrhtony/BiliEmoji', imageURL: '/fixture/meme.gif' }));
const cloned = data => ({ status: 200, data: structuredClone(data) });
function inbox() {
  return { items: todos, counts: Object.fromEntries(['pending', 'done', 'archived'].map(status => [status, todos.filter(item => item.status === status).length])) };
}
const bridge = { async request(method, path, value) {
  if (method === 'GET' && path === 'state') return cloned({ settings, groupTemplates: [{ id: 'auto', name: '自动' }], secrets: {}, status: { checks: {}, accounts: [], qq: { connected: true } } });
  if (method === 'GET' && path === 'memory') return cloned(memory);
  if (method === 'GET' && path === 'workspace') return cloned({ profiles: settings.profiles, accounts: settings.accounts, bindings: settings.bindings, groups: settings.groups });
  if (method === 'GET' && path === 'chat') return cloned({ settings: { revision: settings.revision, chat: settings.chat, bot: { name: settings.bot.name }, profiles: settings.profiles }, contacts: contacts.friends, memory: { items: learned, status: { running: false, pending: 0 } }, conversations: memory.conversations, digests: memory.digests });
  if (method === 'PUT' && path === 'chat') {
    assert.equal(value.revision, settings.revision);
    settings = validateSettings({ ...settings, revision: settings.revision + 1, chat: { defaultMode: value.defaultMode, memoryContacts: value.memoryContacts } }); saves++;
    return cloned({ ok: true, revision: settings.revision });
  }
  if (method === 'DELETE' && path === 'chat/memory') { assert.equal(value.contactId, '123456789'); learned.splice(0); memory.conversations.splice(0); return cloned({ ok: true }); }
  if (method === 'GET' && path === 'notifications') return cloned({ items: notifications.map(item => ({ ...item, inTodo: todos.some(todo => todo.id === item.id) })), digestItems: digestItems.map(item => ({ ...item, inTodo: todos.some(todo => todo.id === item.id) })) });
  if (method === 'GET' && path === 'inbox') return cloned(inbox());
  if (method === 'GET' && path === 'monitor') return cloned({ running: false, reports, state: {} });
  if (method === 'POST' && path === 'inbox/add') { const item = [...notifications, ...digestItems].find(item => item.id === value.id); assert.ok(item); const next = todos.find(todo => todo.id === item.id) || { ...item, status: 'pending', addedAt: now }; if (!todos.includes(next)) todos.push(next); return cloned({ item: next }); }
  if (method === 'PUT' && path === 'inbox/item') { const item = todos.find(item => item.id === value.id); assert.ok(item); assert.ok(['pending', 'done', 'archived'].includes(value.status)); item.status = value.status; return cloned({ item }); }
  if (method === 'POST' && path === 'inbox/calendar') { calendarPreviews.push(structuredClone(value)); return cloned(calendarExport(todos.find(item => item.id === value.id), value, Date.parse(now))); }
  if (method === 'POST' && path === 'qq/contacts') { contactRequests.push(structuredClone(value)); assert.ok(value.all === true || settings.accounts.some(account => account.id === value.accountId)); return cloned(contacts); }
  if (method === 'GET' && path === 'connectors/status') return cloned({ account: { authenticated: true, method: 'chatgpt' }, providers: Object.fromEntries(['github', 'google_drive'].map(provider => [provider, { available: true, connected: !!connectorChecks[provider] }])) });
  if (method === 'POST' && path === 'connectors/check') { assert.ok(['github', 'google_drive'].includes(value.provider)); connectorChecks[value.provider] = true; return cloned({ ok: true, connected: true, message: '已验证读取权限' }); }
  if (path === 'codex/account' || path === 'codex/login') return cloned({ authenticated: true, loggedIn: true, message: '已登录 ChatGPT 测试账号' });
  if (method === 'GET' && path === 'media') return cloned({ items: mediaItems });
  if (method === 'GET' && path === 'media/online') return cloned({ items: online.map(item => ({ ...item, saved: galleryImports.includes(item.id) })) });
  if (method === 'POST' && path === 'media/online') {
    const source = online.find(item => item.id === value.id); assert.ok(source); galleryImports.push(value.id);
    const item = { id: (galleryImports.length + 1).toString(16).padStart(32, '0'), name: source.name, scope: '*:account:', accountId: '*', kind: 'account', targetId: '', type: 'sticker', size: 43, source: { id: source.id, name: 'Memegen.link', url: 'https://memegen.link/' } }; mediaItems.push(item); return cloned({ item });
  }
  if (method === 'POST' && path === 'media') { mediaUploads++; const item = { ...value, id: 'f'.repeat(32), size: Buffer.from(value.base64, 'base64').length }; delete item.base64; mediaItems.push(item); return cloned({ item }); }
  if (method === 'POST' && path === 'media/preview') return cloned({ dataURL: 'data:image/gif;base64,' + tinyGif });
  if (method === 'DELETE' && /^media\/[a-f0-9]{32}$/.test(path)) { const index = mediaItems.findIndex(item => item.id === path.split('/')[1]); assert.ok(index >= 0); mediaItems.splice(index, 1); return cloned({ ok: true }); }
  if (method === 'POST' && path === 'speech/reference/start') return cloned(speechReferences.startUpload(value));
  if (method === 'POST' && path === 'speech/reference/chunk') { referenceChunks++; return cloned(speechReferences.chunkUpload(value)); }
  if (method === 'POST' && path === 'speech/reference/finish') return cloned({ reference: await speechReferences.finishUpload(value) });
  if (method === 'POST' && path === 'speech/reference/cancel') return cloned(speechReferences.cancelUpload(value));
  if (method === 'POST' && path === 'speech/reference/preview') return cloned(await speechReferences.preview(value.id));
  if (method === 'POST' && path === 'speech/preview') { assert.ok(settings.speech.enabled); assert.ok(value.text); speechRequests.push(structuredClone(value)); speechPreviews++; return cloned({ dataURL: 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQQAAAAAAAAA', style: value.style || (value.autoStyle ? '结合对话轻声安慰，保持声音身份' : '') }); }
  if (method === 'POST' && path === 'ucloud/login') { assert.equal(value.username, 'fixture-student'); assert.equal(value.password, 'fixture-password'); schoolLogins++; schoolFailure = false; return cloned({ ok: true, message: '登录成功' }); }
  if (method === 'POST' && path === 'ucloud/view') {
    if (schoolFailure) return { status: 400, data: { error: 'UCloud 登录凭据失效，请重新登录。' } };
    return cloned(value.section === 'detail' ? { content: '作业正文\n' + unsafeText + '附件说明' } : value.section === 'notices' ? { items: [{ id: 'notice-1', title: '课程通知', content: '<script>window.injected=true</script>报名周五截止', time: now, unread: true }], total: 1, page: 1 } : { items: [{ id: '42', title: '本周练习', course: '操作系统', deadline: '2026-10-25 18:00', type: 3 }] });
  }
  if (method === 'POST' && path.startsWith('check/')) return cloned({ ok: true, message: '测试连接成功' });
  if (method === 'PUT' && path === 'settings') { assert.equal(value.revision, settings.revision); settings = validateSettings({ ...value.settings, revision: settings.revision + 1 }); saves++; return cloned({ settings }); }
  if (method === 'PUT' && path === 'secrets') { writes.push(structuredClone(value)); return cloned({ ok: true }); }
  throw Error('Unexpected side effect ' + method + ' ' + path);
} };

const routes = new Map();
for (const plugin of PLUGIN_MODULES) registerBridge({ router: { post: (path, handler) => routes.set(plugin.id + path, handler) } }, bridge, createNativeConfigAdapter({ module: plugin.module, bridge }));
const contentTypes = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const fixtureBoot = '<script>localStorage.setItem("token",JSON.stringify("fixture"));if(!localStorage.getItem("theme"))localStorage.setItem("theme",JSON.stringify("light"));localStorage.setItem("side-bar-open","false");</script>';
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/fixture/meme.gif') { res.setHeader('content-type', 'image/gif'); return res.end(Buffer.from(tinyGif, 'base64')); }
    if (path.startsWith('/api/Plugin/ext/')) {
      if (req.headers.authorization !== 'Bearer fixture') { res.writeHead(401); return res.end('{}'); }
      let body = ''; for await (const chunk of req) body += chunk;
      if (Buffer.byteLength(body) > 100 * 1024) { res.writeHead(413); return res.end('{"error":"NapCat JSON parser limit"}'); }
      const handler = routes.get(path.slice('/api/Plugin/ext/'.length)); assert.ok(handler, 'Unknown fixture plugin route');
      return await handler({ headers: req.headers, body: JSON.parse(body) }, { setHeader: (...args) => res.setHeader(...args), status(code) { res.statusCode = code; return this; }, json(value) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); } });
    }
    if (path.startsWith('/api/')) {
      const data = path === '/api/Plugin/List' ? { plugins: PLUGIN_MODULES.map(plugin => ({ ...plugin, status: 'active', version: 'fixture', hasConfig: true })), extensionPages: PLUGIN_MODULES.map(plugin => ({ pluginId: plugin.id, pluginName: plugin.name, path: 'settings', title: plugin.name })) } : path === '/api/auth/check' ? { isLogin: true } : path.includes('QQLogin') ? { isLogin: true, nickname: '隔离测试' } : {};
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ code: 0, message: 'ok', data }));
    }
    if (path.startsWith('/webui/')) {
      const relative = path.slice(7), file = resolve(nativeRoot, relative.includes('.') ? decodeURIComponent(relative) : 'index.html'); assert.ok(file.startsWith(nativeRoot + sep));
      res.setHeader('content-type', contentTypes[extname(file)] || 'application/octet-stream');
      const bytes = await readFile(file); return res.end(file.endsWith('index.html') ? bytes.toString().replace('<head>', '<head>' + fixtureBoot) : bytes);
    }
    const name = path.endsWith('/settings') || path === '/' ? 'index.html' : path.split('/').at(-1); assert.ok(['index.html', 'app.js', 'style.css', 'shell-navigation.js', 'copy.mjs', 'qlyra.png'].includes(name));
    res.setHeader('content-type', contentTypes[extname(name)] || 'application/octet-stream');
    const bytes = await readFile(new URL('../napcat-plugin/webui/' + name, import.meta.url)); res.end(name === 'index.html' ? bytes.toString().replace('<head>', '<head>' + fixtureBoot) : bytes);
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
if (serveOnly) {
  console.log(JSON.stringify({ fixtureOnly: true, origin, shell: origin + '/webui/extension', chat: origin + '/plugin/napcat-plugin-qq-agent/page/settings', modules: PLUGIN_MODULES.length }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
} else {
  let browser;
  try {
    await mkdir('data/ui-fixtures', { recursive: true });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => { localStorage.setItem('token', JSON.stringify('fixture')); localStorage.setItem('theme', JSON.stringify('light')); localStorage.setItem('side-bar-open', 'false'); });
    const page = await context.newPage(), errors = [], blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { const request = route.request(); if (new URL(request.url()).origin === origin) return route.continue(); blocked.push(request.url()); return route.abort(); });
    const ready = async () => { await page.locator('.workspace-content').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.page-tabs [role=tab]')].every(button => !button.disabled)); };
    const open = async id => { await page.goto(origin + '/plugin/' + id + '/page/settings'); await ready(); };
    async function tab(name) {
      const target = page.getByRole('tab', { name, exact: true });
      if (!await target.isVisible()) await page.locator('.navigation-group').filter({ has: target }).locator('summary').click();
      await target.click(); await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor(); await ready();
    }
    const saved = async text => page.getByRole('status').filter({ hasText: text || '已保存' }).first().waitFor();
    async function save() { await page.getByRole('button', { name: '保存更改', exact: true }).click(); await saved(); await ready(); }
    const noOverflow = async () => assert.ok(await page.locator('html').evaluate(element => element.scrollWidth <= innerWidth), 'Page must fit viewport');
    const safeText = async () => { assert.equal(await page.evaluate(() => window.injected), undefined); assert.equal(await page.locator('.chat-workspace script,.chat-workspace img,.todo-workspace script,.todo-workspace img,.school-workspace script,.school-workspace img').count(), 0); };
    const theme = async value => { await page.evaluate(value => { localStorage.setItem('theme', JSON.stringify(value)); window.dispatchEvent(new StorageEvent('storage', { key: 'theme' })); }, value); await page.waitForFunction(value => document.documentElement.classList.contains('dark') === (value === 'dark'), value); };

    assert.equal(PLUGIN_MODULES.length, 6);
    await open('napcat-plugin-qq-agent');
    assert.equal(await page.getByRole('tab', { name: '语音', exact: true }).count(), 0);
    for (const hidden of ['身份', '长期记忆', '上下文', '历史读取', '群摘要', '对话记录', '会话分配']) assert.equal(await page.getByRole('tab', { name: hidden, exact: true }).count(), 0);
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/bridge') && response.request().postDataJSON()?.path === 'qq/contacts'), page.getByRole('button', { name: '好友列表', exact: true }).click()]); await page.getByRole('button', { name: /课程助教/ }).waitFor(); assert.deepEqual(contactRequests.at(-1), { all: true });
    await page.getByRole('button', { name: /课程助教/ }).click();
    await page.getByRole('group', { name: '联系人模式', exact: true }).getByRole('button', { name: /记忆/ }).click(); await page.getByLabel('联系人角色', { exact: true }).selectOption('mentor'); await save();
    assert.deepEqual(settings.chat.memoryContacts.find(item => item.id === '123456789'), { id: '123456789', mode: 'memory', profileId: 'mentor' });
    await page.getByRole('button', { name: /学习搭子/ }).click(); await page.getByRole('group', { name: '联系人模式', exact: true }).getByRole('button', { name: /普通/ }).click(); await save(); assert.equal(settings.chat.memoryContacts.find(item => item.id === '987654321').mode, 'normal');
    await page.getByRole('button', { name: /课程助教/ }).click(); await page.getByRole('button', { name: '会话', exact: true }).click(); await page.getByText('什么时候截止？', { exact: true }).waitFor(); await page.locator('.chat-memory-item details summary').click(); assert.ok((await page.locator('.chat-memory-item details').innerText()).includes('我喜欢先实验再讲原理')); await safeText();
    await page.screenshot({ path: 'data/ui-fixtures/chat-memory-desktop.png', fullPage: true });
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '清空', exact: true }).click(); assert.equal(learned.length, 1);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '清空', exact: true }).click(); await saved('已清空'); assert.equal(learned.length, 0);
    await page.getByRole('tab', { name: '角色', exact: true }).focus(); await page.keyboard.press('ArrowDown'); assert.equal(await page.getByRole('tab', { name: '群聊回复', exact: true }).evaluate(element => element === document.activeElement), true); await page.keyboard.press('Enter'); await ready();
    await tab('角色'); await page.getByLabel('名称', { exact: true }).fill('全局助手'); await page.getByLabel('系统提示词', { exact: true }).fill('统一默认语气'); await page.getByRole('button', { name: '保存角色', exact: true }).click(); await saved(); assert.equal(settings.bot.name, '全局助手');
    await page.getByRole('button', { name: '新建', exact: true }).click(); await page.getByLabel('名称', { exact: true }).fill('临时角色'); await page.getByLabel('系统提示词', { exact: true }).fill('自由设定'); await page.getByRole('button', { name: '保存角色', exact: true }).click(); await saved();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除角色', exact: true }).click(); await saved('已删除'); assert.ok(!settings.profiles.some(profile => profile.name === '临时角色'));
    await page.getByRole('button', { name: /默认全局角色/ }).click(); await page.getByLabel('名称', { exact: true }).fill('不应保存'); page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('tab', { name: '群聊回复', exact: true }).click(); assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '不应保存'); page.once('dialog', dialog => dialog.accept()); await tab('群聊回复'); assert.equal(settings.bot.name, '全局助手');

    await open('napcat-plugin-agent-notices'); await page.getByRole('heading', { name: '提交课程作业', exact: true }).waitFor(); assert.equal(await page.locator('.todo-group').count(), 2); await safeText();
    await page.locator('.todo-notice-card').filter({ has: page.getByRole('heading', { name: '提交课程作业', exact: true }) }).getByRole('button', { name: '加入待办', exact: true }).click(); await saved('已加入待办'); assert.equal(todos.length, 1);
    await page.getByRole('button', { name: /^待办/, exact: false }).click(); await page.getByRole('button', { name: '日历', exact: true }).click(); await page.locator('input[type=datetime-local]').nth(0).fill('2026-10-25T10:00'); await page.locator('input[type=datetime-local]').nth(1).fill('2026-10-25T11:00'); await page.getByRole('button', { name: '预览日程', exact: true }).click(); await page.getByRole('link', { name: '打开 Google Calendar', exact: true }).waitFor();
    assert.equal(calendarPreviews.length, 1); const calendarLink = new URL(await page.getByRole('link', { name: '打开 Google Calendar', exact: true }).getAttribute('href')); assert.equal(calendarLink.hostname, 'calendar.google.com'); assert.equal(calendarLink.searchParams.get('action'), 'TEMPLATE'); assert.equal(calendarLink.searchParams.get('dates'), '20261025T020000Z/20261025T030000Z'); assert.ok((await page.locator('.todo-calendar-preview').innerText()).includes('确认保存'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 ICS', exact: true }).click()]); assert.match(download.suggestedFilename(), /^todo-[a-f0-9]{32}\.ics$/);
    await page.getByRole('button', { name: '完成', exact: true }).click(); await page.getByRole('group', { name: '待办状态', exact: true }).getByRole('button', { name: '已完成', exact: true }).click(); await page.getByRole('button', { name: '重开', exact: true }).waitFor(); assert.equal(todos[0].status, 'done');
    await page.getByRole('button', { name: /^整理/, exact: false }).click(); await page.getByRole('heading', { name: '第二章整理', exact: true }).waitFor(); await page.getByRole('button', { name: '加入待办', exact: true }).click(); await saved('已加入待办'); assert.equal(todos.length, 2);
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('switch', { name: '启用即时通知', exact: true }).waitFor();
    for (const label of ['QQ 账号', '提醒发给谁', '接收 QQ', '推送级别']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0);
    await page.getByRole('switch', { name: '启用即时通知', exact: true }).check(); await page.getByRole('button', { name: '从群列表选择', exact: true }).click(); await page.getByRole('button', { name: /实验群 23456789/ }).click(); await page.getByRole('button', { name: /名称很长的课程通知/ }).click(); assert.deepEqual(contactRequests.at(-1), { all: true });
    await page.getByLabel('关注事项', { exact: true }).fill('课程、考试与作业截止'); await page.locator('summary').filter({ hasText: '筛选细节' }).click(); await page.getByLabel('包含关键词', { exact: true }).fill('作业\n考试'); await page.getByLabel('排除关键词', { exact: true }).fill('广告'); await page.getByLabel('指定发送人', { exact: true }).fill('123456789'); await save(); assert.deepEqual(settings.realtime.groups, ['23456789', '34567890']); assert.equal(settings.realtime.includeKeywords, '作业\n考试');
    await page.getByRole('group', { name: '通知设置类型', exact: true }).getByRole('button', { name: '定时整理', exact: true }).click(); await page.getByRole('switch', { name: '启用定时整理', exact: true }).check(); await page.getByLabel('整理模板', { exact: true }).selectOption('custom'); await page.getByLabel('模板要求', { exact: true }).fill('按课程分组，先列行动'); await page.getByRole('group', { name: '输出格式', exact: true }).getByRole('button', { name: '详细依据', exact: true }).click(); await save(); assert.equal(settings.monitor.template, 'custom'); assert.equal(settings.monitor.notify, false); assert.equal(settings.monitor.recipientQQ, '');
    await page.screenshot({ path: 'data/ui-fixtures/todo-settings-desktop.png', fullPage: true });

    for (const [id, provider, section] of [['napcat-plugin-agent-github', 'github', 'github'], ['napcat-plugin-agent-drive', 'google_drive', 'drive']]) {
      await open(id); await page.getByRole('heading', { name: 'ChatGPT Apps', exact: true }).waitFor(); await page.getByRole('button', { name: '使用 ChatGPT Apps', exact: true }).click(); await page.getByRole('button', { name: '已选用', exact: true }).waitFor(); assert.equal(settings[section].authMode, 'chatgpt'); await page.getByRole('button', { name: '检测读取', exact: true }).click(); await saved('已验证读取权限'); assert.equal(connectorChecks[provider], true); assert.ok(await page.locator('.connector-advanced').count());
    }

    await open('napcat-plugin-agent-ucloud'); await page.getByRole('button', { name: '重新连接', exact: true }).click(); await page.getByLabel('学号', { exact: true }).fill('fixture-student'); await page.getByLabel('学校密码', { exact: true }).fill('fixture-password'); await page.getByRole('button', { name: /登录(?:教学云|ucloud)/, exact: false }).click(); await saved('登录成功'); assert.equal(schoolLogins, 1);
    await page.getByRole('tab', { name: '待交作业', exact: true }).click();
    const taskRow = page.locator('.school-record-entry').filter({ hasText: '本周练习' }); await taskRow.getByText('操作系统', { exact: true }).waitFor();
    const submissionLink = taskRow.getByRole('link', { name: '前往提交：本周练习', exact: true });
    const submissionURL = new URL(await submissionLink.getAttribute('href')); assert.equal(submissionURL.origin, 'https://ucloud.bupt.edu.cn'); assert.equal(submissionURL.pathname, '/uclass/course.html'); assert.match(submissionURL.hash, /assignmentId=42(?:&|$)/); assert.equal(await submissionLink.getAttribute('target'), '_blank'); assert.ok((await submissionLink.getAttribute('rel')).includes('noopener'));
    await taskRow.getByRole('button', { name: /本周练习/ }).click(); const schoolArticle = page.getByRole('article', { name: '作业详情' }); await schoolArticle.filter({ hasText: '作业正文' }).waitFor(); assert.equal(await schoolArticle.getByRole('link', { name: '前往提交：本周练习', exact: true }).getAttribute('href'), submissionURL.href); await page.screenshot({ path: 'data/ui-fixtures/ucloud-course-submit.png', fullPage: true, animations: 'disabled' }); await safeText();
    await page.getByRole('tab', { name: '站内通知', exact: true }).click(); await page.getByRole('button', { name: /课程通知/ }).click(); await page.getByRole('article', { name: '通知正文' }).filter({ hasText: '报名周五截止' }).waitFor(); await safeText();

    await open('napcat-plugin-agent-speech');
    await page.getByRole('button', { name: '文字设计音色', exact: true }).click();
    const directive = page.locator('.speech-directive textarea'); await directive.fill('温润的青年声线，普通话，语速稍慢，自然交流');
    await page.getByRole('switch', { name: '启用语音', exact: true }).check(); await save();
    assert.equal(settings.speech.model, 'mimo-v2.5-tts-voicedesign'); assert.ok(settings.speech.style.includes('语速稍慢'));
    await page.getByRole('tab', { name: '试听', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '保存更改', exact: true }).count(), 0);
    await page.getByRole('button', { name: '生成试听', exact: true }).click(); await page.getByLabel('小米语音试听', { exact: true }).waitFor(); assert.equal(speechPreviews, 1);
    await page.getByRole('tab', { name: '声音设置', exact: true }).click();
    await page.getByRole('button', { name: '上传音频复刻', exact: true }).click();
    await page.getByLabel('选择参考音频', { exact: true }).setInputFiles({ name: '我的参考声音.wav', mimeType: 'audio/wav', buffer: referenceWav });
    await page.getByLabel('参考音频原声', { exact: true }).waitFor(); assert.ok(referenceChunks >= 3, 'normal audio must pass as small chunks');
    await page.getByRole('tab', { name: '试听', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '生成试听', exact: true }).isEnabled(), false);
    await page.getByRole('tab', { name: '声音设置', exact: true }).click();
    await page.locator('.speech-expression summary').click();
    await directive.fill('保持参考音色，自然轻声，语速稍慢'); await save();
    assert.equal(settings.speech.model, 'mimo-v2.5-tts-voiceclone'); assert.match(settings.speech.referenceAudio, /^ref_/);
    await page.locator('.speech-expression summary').click();
    await page.screenshot({ path: 'data/ui-fixtures/qlyra-speech-settings-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'data/ui-fixtures/qlyra-speech-settings-mobile.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('tab', { name: '试听', exact: true }).click();
    await page.locator('.speech-preview-context summary').click(); await page.getByLabel('上一句对话（可选）', { exact: true }).fill('今天考试没发挥好，有点难过。');
    await page.getByRole('button', { name: '生成试听', exact: true }).click(); await page.getByLabel('小米语音试听', { exact: true }).waitFor();
    assert.match(speechRequests.at(-1).conversation, /难过/); assert.equal(speechRequests.at(-1).autoStyle, true);
    await page.getByLabel('本次表达要求（可选）', { exact: true }).fill('轻声安慰，尾句稍慢');
    await page.getByRole('button', { name: '生成试听', exact: true }).click(); await page.getByLabel('小米语音试听', { exact: true }).waitFor();
    assert.equal(speechRequests.at(-1).style, '轻声安慰，尾句稍慢');
    await page.screenshot({ path: 'data/ui-fixtures/qlyra-speech-clone-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'data/ui-fixtures/qlyra-speech-clone-mobile.png', fullPage: true, animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.setViewportSize({ width: 1280, height: 900 });

    await open('napcat-plugin-qq-agent'); await tab('图片与表情包');
    await page.locator('.online-gallery-grid article').first().waitFor(); assert.equal(await page.locator('.online-gallery-grid article').count(), 24);
    await page.getByRole('button', { name: '继续查看（还剩 6 个）', exact: true }).click(); assert.equal(await page.locator('.online-gallery-grid article').count(), 30);
    await page.getByLabel('筛选情绪', { exact: true }).selectOption('开心'); assert.equal(await page.locator('.online-gallery-grid article').count(), 1);
    await page.getByLabel('筛选情绪', { exact: true }).selectOption('全部'); await page.getByLabel('筛选作品', { exact: true }).selectOption('干物妹！小埋');
    await page.getByLabel('搜索名字或角色', { exact: true }).fill('抱抱'); assert.equal(await page.locator('.online-gallery-grid article').count(), 1);
    await page.getByLabel('搜索名字或角色', { exact: true }).fill('');
    await page.getByRole('button', { name: '启用筛选结果（2）', exact: true }).click(); await saved('已启用 2 个'); assert.deepEqual(galleryImports, ['fine', 'success']); assert.ok(mediaItems.every(item => item.accountId === '*'));
    await page.screenshot({ path: 'data/ui-fixtures/qlyra-anime-gallery-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'data/ui-fixtures/qlyra-anime-gallery-mobile.png', fullPage: true, animations: 'disabled' }); await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.media-upload-details summary').click(); await page.getByLabel('素材文件', { exact: true }).setInputFiles({ name: '开心.gif', mimeType: 'image/gif', buffer: Buffer.from(tinyGif, 'base64') }); await page.getByRole('button', { name: '上传素材', exact: true }).click(); await saved('上传成功'); assert.equal(mediaUploads, 1); const uploaded = page.locator('.media-card').filter({ has: page.getByRole('heading', { name: '开心', exact: true }) }); await uploaded.getByRole('button', { name: '预览', exact: true }).click(); await uploaded.locator('.media-preview').waitFor(); page.once('dialog', dialog => dialog.accept()); await uploaded.getByRole('button', { name: '删除', exact: true }).click(); await saved('已删除素材'); assert.equal(mediaItems.length, 2);

    // Existing native NapCat host: repeated title clicks stay in this tab, including speech.
    await page.goto(origin + '/webui/extension'); const frameElement = page.locator('iframe[title="extension-page"]'); await frameElement.waitFor(); const frame = frameElement.contentFrame(); await frame.locator('.workspace-content').waitFor();
    let popups = 0; page.on('popup', () => popups++);
    for (const plugin of [...PLUGIN_MODULES.slice(1), PLUGIN_MODULES[0], PLUGIN_MODULES[1], PLUGIN_MODULES[0]]) {
      await page.locator(`button[role=tab][data-key="${plugin.id}:settings"] span[title]`).click(); await page.waitForFunction(id => [...document.querySelectorAll('iframe')].some(frame => frame.getAttribute('src')?.includes('/' + id + '/page/settings')), plugin.id); await frame.locator('.workspace-content').waitFor(); assert.equal(new URL(page.url()).pathname, '/webui/extension'); assert.equal(popups, 0, 'Extension title opened an unexpected popup');
    }
    await frame.getByRole('tab', { name: '角色', exact: true }).click(); await frame.getByLabel('名称', { exact: true }).fill('嵌入页未保存草稿'); page.once('dialog', dialog => dialog.dismiss()); await frame.getByRole('tab', { name: '群聊回复', exact: true }).click(); assert.equal(await frame.getByLabel('名称', { exact: true }).inputValue(), '嵌入页未保存草稿'); page.once('dialog', dialog => dialog.accept()); await frame.getByRole('tab', { name: '群聊回复', exact: true }).click(); await frame.getByRole('heading', { name: '群聊回复', exact: true, level: 1 }).waitFor();
    const colors = await page.evaluate(() => { const frame = document.querySelector('iframe'), root = frame.contentDocument.documentElement; return { host: getComputedStyle(document.documentElement).getPropertyValue('--heroui-primary').trim(), inner: frame.contentWindow.getComputedStyle(root).getPropertyValue('--heroui-primary').trim() }; }); assert.ok(colors.host); assert.equal(colors.inner, colors.host);
    await page.evaluate(() => { localStorage.setItem('theme', JSON.stringify('dark')); document.documentElement.classList.add('dark'); }); await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement.classList.contains('dark')); await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); assert.ok(await frame.locator('html').evaluate(element => element.scrollWidth <= innerWidth)); await page.screenshot({ path: 'data/ui-fixtures/native-shell-mobile-dark.png', fullPage: true, animations: 'disabled' });

    for (const plugin of PLUGIN_MODULES) {
      await open(plugin.id);
      for (const [value, width] of [['light', 1280], ['dark', 320]]) {
        await page.setViewportSize({ width, height: 900 }); await theme(value); await noOverflow(); await page.screenshot({ path: 'data/ui-fixtures/' + plugin.module + '-' + value + '-' + width + '.png', fullPage: true, animations: 'disabled' });
      }
    }
    await open('napcat-plugin-qq-agent'); await page.emulateMedia({ reducedMotion: 'reduce' }); assert.ok(await page.locator('.page-tabs button').first().evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) <= .001));
    const denied = await context.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { headers: { authorization: 'Bearer fixture', origin: 'https://evil.test' }, data: { operation: 'load' } }); assert.equal(denied.status(), 403);
    const unauthorized = await context.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { data: { operation: 'load' } }); assert.equal(unauthorized.status(), 401);
    await safeText(); assert.deepEqual(errors, []); assert.deepEqual(blocked, [], 'Fixture must not access external services');
    console.log(JSON.stringify({ passed: true, modules: PLUGIN_MODULES.length, saves, fixtureOnly: true, perContactModes: true, globalRole: true, todoGroups: true, todoStatus: true, calendarPreviewOnly: true, sharedSourcePicker: true, localDigests: true, connectorApps: true, ucloudReconnect: true, speechViewsSeparated: true, cloneChunkUpload: referenceChunks, conversationPreview: true, onlineGallery: true, mediaUpload: true, mediaPreview: true, mediaDelete: true, nativeShell: true, inPlaceExtensionTitles: true, embeddedConfirm: true, safeText: true, inheritedTheme: true, mobileDark: true, originGuard: true, externalRequests: blocked.length, writes: writes.length }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
