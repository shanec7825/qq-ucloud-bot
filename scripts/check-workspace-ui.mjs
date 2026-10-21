import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SettingsStore } from '../src/settings.mjs';
import { SecretVault } from '../src/secret-vault.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';
// Isolated real stores and HTTP API; only NapCat transport is intercepted. No QQ/model calls.
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const folder = await mkdtemp(fileURLToPath(new URL('../data/workspace-test-', import.meta.url))), root = pathToFileURL(join(folder, '/'));
let browser, admin, runtime;
const errors = [];
try {
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  const vault = new SecretVault(root, {}, { protect: value => Buffer.from(value).toString('base64'), unprotect: value => Buffer.from(value, 'base64').toString('utf8') }); await vault.load();
  runtime = new BotRuntime(store, vault, { root });
  runtime.connectors.ready = async () => {};
  runtime.groups = async () => [{ id: '300000001', name: '课程讨论群' }];
  runtime.ai = async () => { throw new Error('Browser fixture must never call a model'); };
  await runtime.start();
  const reports = [{ id: 'report:opaque/a', groupId: '300000001', groupName: '课程讨论群', createdAt: new Date().toISOString(), items: [{ id: 'item:opaque/b', title: '提交实验报告', summary: '请交第一章实验报告', priority: 'normal', deadlineText: '周五晚八点', sources: [{ time: '2026-10-21 10:00', excerpt: '老师原话：周五晚八点前提交。' }] }] }];
  runtime.monitor.reports = async () => structuredClone(reports);
  admin = await startAdmin({ store, vault, runtime, root, port: 0 });
  browser = await chromium.launch({ channel: process.env.CAPTURE_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(admin.origin + '/#key=' + admin.accessKey);
  await page.locator('#shell').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id, index) => ids.indexOf(id) !== index); }), []);
  const nav = async tab => { await page.locator(`[data-tab="${tab}"]`).click(); await page.locator(`[data-view="${tab}"]`).waitFor({ state: 'visible' }); };
  const save = async () => { await page.locator('#save-settings').click(); await page.waitForFunction(() => document.querySelector('#save-state').textContent === '配置已保存'); };
  await nav('customization'); await page.locator('#add-profile').click();
  await page.locator('[data-profile-field="id"]').fill('study');
  await page.locator('[data-profile-field="name"]').fill('学习助手');
  await page.locator('[data-profile-field="systemPrompt"]').fill('先给直观例子。');
  await nav('groups'); await page.locator('#new-group-id').fill('300000001'); await page.locator('#new-group-name').fill('课程讨论群'); await page.locator('#add-group').click();
  await page.locator('[data-group-profile="300000001"]').selectOption('study');
  await nav('bot'); await page.locator('[data-setting="bot.name"]').fill('草稿机器人');
  await nav('customization'); assert.equal(await page.locator('[data-profile-field="name"]').inputValue(), '学习助手');
  await save(); assert.equal(store.get().groups[0].profileId, 'study');
  await page.reload(); await page.locator('#shell').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-profile-field="id"]').isEditable(), false);
  await page.getByRole('button', { name: '删除方案', exact: true }).click();
  await page.getByText('这个方案仍被群组使用，请先到群组页切换方案。', { exact: true }).waitFor();
  assert.equal(await page.locator('.profile-card').count(), 1);
  await nav('groups'); await page.locator('[data-group-profile="300000001"]').selectOption(''); await nav('customization'); assert.equal(await page.locator('[data-profile-field="id"]').isEditable(), false); await nav('groups'); await page.locator('[data-group-profile="300000001"]').selectOption('study');
  await nav('memory'); await page.locator('#note-scope option[value="profile:study"]').waitFor({ state: 'attached' });
  await page.locator('#note-scope').selectOption('profile:study'); await page.locator('#note-kind').selectOption('preference'); await page.locator('#note-tags').fill('教材, 页码'); await page.locator('#note-enabled').uncheck(); await page.locator('#note-text').fill('教材回答附页码');
  await nav('groups'); await nav('memory'); assert.equal(await page.locator('#note-text').inputValue(), '教材回答附页码');
  await page.locator('#save-note').click(); await page.locator('#note-list .note').waitFor();
  const notes = await runtime.notes.list(); assert.equal(notes[0].scope, 'profile:study'); assert.equal(notes[0].kind, 'preference'); assert.equal(notes[0].enabled, false); assert.deepEqual(notes[0].tags, ['教材', '页码']);
  await page.locator('#memory-search').fill('不存在'); assert.equal(await page.locator('#note-list .note').count(), 0);
  await page.locator('#memory-search').fill('页码'); await page.locator('#memory-kind-filter').selectOption('fact'); assert.equal(await page.locator('#note-list .note').count(), 0);
  await page.locator('#memory-kind-filter').selectOption('preference'); await page.locator('#memory-filter').selectOption('profile:study'); assert.equal(await page.locator('#note-list .note').count(), 1);
  await page.locator('#digest-text').fill('未保存的摘要草稿'); await page.locator('#note-list').getByRole('button', { name: '启用', exact: true }).click(); await page.locator('#note-list').getByRole('button', { name: '停用', exact: true }).waitFor(); assert.equal(await page.locator('#digest-text').inputValue(), '未保存的摘要草稿'); await nav('groups'); await nav('memory'); assert.equal(await page.locator('#digest-text').inputValue(), '未保存的摘要草稿'); await page.locator('#save-digest').click(); await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('群历史摘要已保存'));
  await page.screenshot({ path: 'data/workspace-memory-desktop.png', fullPage: true });
  await nav('monitor'); await page.locator('#inbox-list .inbox-item').waitFor();
  const inboxId = await page.locator('#inbox-list .inbox-item').getAttribute('data-inbox-id'); assert.equal(inboxId, 'report:opaque/a:item:opaque/b');
  await page.getByText('查看来源与依据', { exact: true }).click(); await page.locator('#inbox-list').getByText('2026-10-21 10:00 · 老师原话：周五晚八点前提交。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '标为完成', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#inbox-counts').textContent.includes('已完成 1'));
  await page.reload(); await page.locator('#shell').waitFor({ state: 'visible' }); await page.locator('#inbox-status').selectOption('done'); await page.locator('#inbox-list .inbox-item').waitFor();
  assert.equal((await runtime.inbox.list()).items[0].status, 'done'); assert.deepEqual(await runtime.monitor.reports(), reports);
  await page.getByRole('button', { name: '归档', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#inbox-counts').textContent.includes('已归档 1'));
  await page.locator('#inbox-status').selectOption('archived'); await page.getByRole('button', { name: '恢复待处理', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#inbox-counts').textContent.includes('待处理 1'));
  await page.locator('#inbox-status').selectOption('pending');
  for (const width of [375, 1440]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme });
    for (const tab of ['bot', 'groups', 'memory', 'monitor', 'customization', 'connections']) { await nav(tab); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${colorScheme} ${tab} overflow`); }
    await page.screenshot({ path: `data/workspace-${width}-${colorScheme}.png`, fullPage: true });
  }
  await nav('customization'); await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' }); await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); document.querySelector('#feedback').hidden = true; }); await page.screenshot({ path: 'data/workspace-overview.png' });
  // Production packaging transformation, with fake authenticated NapCat bridge forwarding to the isolated admin API.
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const plugins = { core: 'napcat-plugin-qq-agent', github: 'napcat-plugin-agent-github', drive: 'napcat-plugin-agent-drive', ucloud: 'napcat-plugin-agent-ucloud', notices: 'napcat-plugin-agent-notices' };
  const session = await context.request.get(admin.origin + '/api/session'); const csrf = (await session.json()).csrf;
  for (const [module, pluginId] of Object.entries(plugins)) {
    const embedded = await context.newPage(); embedded.on('pageerror', error => errors.push(error.message));
    await embedded.addInitScript(() => localStorage.setItem('token', JSON.stringify('fixture-token')));
    await embedded.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../web/app.js', import.meta.url), 'utf8') }));
    await embedded.route('**/style.css', async route => route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../web/style.css', import.meta.url), 'utf8') }));
    await embedded.route('**/napcat.css', async route => route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../web/napcat.css', import.meta.url), 'utf8') }));
    await embedded.route('**/embedded-' + module, route => route.fulfill({ contentType: 'text/html', body: html.replace('<body>', `<body data-napcat="true" data-module="${module}">`).replace('</head>', '<link rel="stylesheet" href="/napcat.css"></head>') }));
    await embedded.route('**/api/Plugin/ext/**/bridge', async route => {
      assert.ok(route.request().url().includes(pluginId)); const { path, method, value } = route.request().postDataJSON();
      const response = await context.request.fetch(admin.origin + '/api/' + path, { method, headers: { 'x-csrf-token': csrf, origin: admin.origin }, ...(value === undefined ? {} : { data: value }) });
      await route.fulfill({ status: response.status(), contentType: 'application/json', body: await response.text() });
    });
    await embedded.goto(admin.origin + '/embedded-' + module, { waitUntil: 'domcontentloaded' }); await embedded.locator('#shell').waitFor({ state: 'visible' });
    const view = module === 'core' ? 'bot' : module === 'notices' ? 'monitor' : 'connections'; await embedded.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
    for (const width of [375, 1440]) for (const colorScheme of ['light', 'dark']) { await embedded.setViewportSize({ width, height: 1000 }); await embedded.emulateMedia({ colorScheme }); await embedded.evaluate(dark => document.documentElement.dataset.theme = dark ? 'dark' : 'light', colorScheme === 'dark'); assert.equal(await embedded.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `embedded ${module} ${width} overflow`); }
    if (module !== 'core' && module !== 'notices') assert.deepEqual(await embedded.locator('[data-service]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.service)), [module]);
    await embedded.screenshot({ path: `data/workspace-embedded-${module}.png`, fullPage: true });
    if (module === 'core') {
      await embedded.route('**/host-core', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><iframe src="/embedded-core" style="width:100%;height:900px"></iframe></body></html>' }));
      await embedded.goto(admin.origin + '/host-core'); const frame = embedded.frameLocator('iframe'); await frame.locator('#shell').waitFor({ state: 'visible' });
      await embedded.evaluate(() => document.documentElement.classList.add('dark')); await frame.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });
      await embedded.evaluate(() => document.documentElement.classList.remove('dark')); await frame.locator('html[data-theme="light"]').waitFor({ state: 'attached' });
    }
    await embedded.close();
  }
  const home = await context.newPage(); home.on('pageerror', error => errors.push(error.message)); await home.addInitScript(() => { window.chrome = { webview: { postMessage: value => window.lastAction = value } }; }); await home.goto(pathToFileURL(join(process.cwd(), 'desktop/assets/home.html')).href); await home.evaluate(() => window.renderStatus({ qqLoggedIn: true, botConnected: true, model: 'fixture-model', workspace: 'D:\\fixture' })); for (const width of [375, 1440]) for (const colorScheme of ['light', 'dark']) { await home.setViewportSize({ width, height: 1000 }); await home.emulateMedia({ colorScheme }); assert.equal(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.ok(await home.locator('.actions button').first().evaluate(node => node.getBoundingClientRect().height < 80)); await home.screenshot({ path: 'data/workspace-desktop-home-' + width + '-' + colorScheme + '.png', fullPage: true }); } await home.setViewportSize({ width: 1440, height: 1000 }); await home.emulateMedia({ colorScheme: 'light' }); await home.evaluate(() => window.scrollTo(0, 0)); await home.screenshot({ path: 'data/desktop-home.png' }); await home.close();
  assert.deepEqual(errors, []); console.log('Workspace browser checks passed: profiles/bind/guard/reload, metadata/scope/filter/drafts, inbox opaque IDs/status/source persistence, all 6 pages at 375/1440 light/dark and all 5 mocked NapCat modules. No QQ/model calls.');
} finally { await browser?.close(); runtime?.stop(); await admin?.close(); await rm(folder, { recursive: true, force: true }); }
