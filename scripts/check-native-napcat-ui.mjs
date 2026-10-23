// Original installed NapCat frontend, served on isolated loopback with fake APIs only.
// Hidden compatibility pages are covered by native-config unit tests, not this UI journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { defaults, validateSettings } from '../src/settings.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';

const root = resolve('tools/napcat/napcat/static');
const continueFromSpeech = process.argv.includes('--continue-from-speech');
await readFile(resolve(root, 'index.html'));
await mkdir('data/ui-fixtures', { recursive: true });
let settings = defaults({ ALLOWED_GROUPS: '123456,234567' }), saves = 0;
const secretWrites = [], schoolLogins = [], unexpected = [];
settings.profiles = [{ id: 'study', name: '学习助手', model: 'gpt-6-luna', systemPrompt: '逐步讲解' }];
settings.groups[0].name = '测试学习群'; settings.groups[1].name = '测试通知群';
const notes = [{ id: 'note-a', scope: 'global', text: '<img src=x onerror="window.__injected=true">安全记忆预览', kind: 'fact', tags: [], enabled: true, updatedAt: '2026-01-01' }];
const sourceText = '<img src=x onerror=window.__injected=true>原始群通知';
const bridge = { async request(method, path, value) {
  if (method === 'GET') {
    const data = path === 'state' ? { settings, groupTemplates: [{ id: 'auto', name: '自动' }], secrets: {}, status: {} }
      : path === 'memory' ? { notes, digests: [], conversations: [] }
        : path === 'inbox' ? { items: [{ id: 'item-a', title: '截止通知测试', text: '仅测试事项', sources: [{ excerpt: sourceText }], status: 'pending' }] }
          : path === 'monitor' ? { running: false, reports: [], state: {} } : {};
    return { status: 200, data: structuredClone(data) };
  }
  if (method === 'PUT' && path === 'settings') {
    if (value.revision !== settings.revision) return { status: 409, data: { error: '配置冲突' } };
    settings = validateSettings({ ...value.settings, revision: settings.revision + 1 }); saves++;
    return { status: 200, data: { settings: structuredClone(settings) } };
  }
  if (method === 'PUT' && path === 'secrets') { secretWrites.push(structuredClone(value)); return { status: 200, data: { ok: true } }; }
  if (method === 'POST' && path === 'ucloud/login') { assert.equal(value.username, 'fixture-student'); assert.equal(value.password, 'fixture-password'); schoolLogins.push({ username: value.username }); return { status: 200, data: { ok: true, message: '登录成功' } }; }
  if (method === 'POST' && path === 'qq/contacts') return { status: 200, data: { groups: [{ id: '123456', name: '测试学习群' }], friends: [{ id: '123456789', name: '测试管理员' }], errors: [] } };
  throw Error('Unexpected isolated test side effect: ' + method + ' ' + path);
} };
const adapters = new Map(PLUGIN_MODULES.map(plugin => [plugin.id, createNativeConfigAdapter({ module: plugin.module, bridge })])), streams = new Map();
const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: status === 200 ? 0 : -1, message: status === 200 ? 'ok' : data.error, data })); };
let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5);
      if (path.startsWith('Plugin/Config')) {
        if (req.headers.authorization !== 'Bearer isolated-test-only') return json(res, { error: '请先登录' }, 401);
        if (req.headers.origin && req.headers.origin !== origin) return json(res, { error: '请求来源无效' }, 403);
      }
      let body = {};
      if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; }
      if (path === 'Plugin/List') return json(res, { plugins: PLUGIN_MODULES.map(plugin => ({ ...plugin, status: 'active', version: 'fixture', author: 'Offline fixture', hasConfig: true, icon: '/webui/favicon.ico' })), extensionPages: [] });
      if (path === 'Plugin/Config' && req.method === 'GET') { const adapter = adapters.get(url.searchParams.get('id')); assert.ok(adapter); const config = await adapter.getConfig(); return json(res, { config, schema: adapter.schema(config), supportReactive: true }); }
      if (path === 'Plugin/Config' && req.method === 'POST') { const adapter = adapters.get(body.id); assert.ok(adapter); await adapter.setConfig(body.config); return json(res, {}); }
      if (path === 'Plugin/Config/SSE') {
        const adapter = adapters.get(url.searchParams.get('id')), config = JSON.parse(url.searchParams.get('config')), sessionId = config._session; assert.ok(adapter);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('event: connected\ndata: ' + JSON.stringify({ sessionId }) + '\n\n');
        const ui = { updateSchema: async schema => res.write('event: schema\ndata: ' + JSON.stringify({ type: 'full', schema }) + '\n\n') };
        streams.set(sessionId, ui); req.on('close', () => streams.delete(sessionId)); await adapter.controller(ui, config); return;
      }
      if (path === 'Plugin/Config/Change') { const ui = streams.get(body.sessionId); assert.ok(ui); await adapters.get(body.id).onConfigChange(ui, body.key, body.value, body.currentConfig); return json(res, {}); }
      return json(res, path === 'auth/check' ? { isLogin: true } : path.includes('QQLogin') ? { isLogin: true, nickname: '离线测试' } : {});
    }
    const relative = url.pathname.startsWith('/webui/') ? url.pathname.slice(7) : '';
    const file = resolve(root, relative.includes('.') ? decodeURIComponent(relative) : 'index.html');
    if (!file.startsWith(root + sep)) throw Error('Invalid path');
    const content = await readFile(file); res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CAPTURE_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => { localStorage.setItem('token', JSON.stringify('isolated-test-only')); localStorage.setItem('theme', JSON.stringify('light')); localStorage.setItem('side-bar-open', 'false'); });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (unexpected.push(route.request().url()), route.abort()));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/webui/plugins');
  const dialog = page.getByRole('dialog');
  async function open(module) {
    const plugin = PLUGIN_MODULES.find(plugin => plugin.module === module), card = page.locator('div.group.w-full').filter({ has: page.getByRole('heading', { name: plugin.name, exact: true }) });
    await card.waitFor(); await card.getByRole('button').first().click(); await dialog.waitFor(); await dialog.getByRole('button', { name: '保存', exact: true }).waitFor(); assert.equal(await dialog.locator('iframe').count(), 0);
  }
  async function select(label, option) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await dialog.getByRole('button', { name: label === '选择记录' ? /(?:^|\s)选择(?:群聊|角色|QQ 账号|待办|整理记录)$/ : new RegExp('(?:^|\\s)' + escaped + '$') }).click();
    try { await page.getByRole('option', { name: option, exact: true }).click({ timeout: 7000 }); }
    catch (error) { await page.screenshot({ path: 'data/ui-fixtures/native-settings-failure.png', fullPage: true }); console.error(JSON.stringify({ label, option, options: await page.getByRole('option').allTextContents(), buttons: await dialog.getByRole('button').allTextContents() })); throw error; }
  }
  const close = () => dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const save = async () => { await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  async function nativeSwitch(label) {
    // The installed NapCat boolean renderer leaves its HeroUI switch unnamed.
    // Locate the exact visual field row, and require exactly one row and switch.
    const row = dialog.locator('div.flex.justify-between.items-center').filter({ has: page.getByText(label, { exact: true }) });
    assert.equal(await row.count(), 1, 'Expected one native boolean field: ' + label);
    const control = row.getByRole('switch');
    assert.equal(await control.count(), 1, 'Expected one switch in field: ' + label);
    return control;
  }
  async function capture(name) {
    await page.evaluate(() => { delete window.__nativeDialogStability; });
    await page.waitForFunction(() => {
      const element = document.querySelector('[role="dialog"]'); if (!element) return false;
      const rect = element.getBoundingClientRect(), opacities = [];
      for (let node = element; node; node = node.parentElement) opacities.push(Number(getComputedStyle(node).opacity));
      const signature = JSON.stringify([rect.x, rect.y, rect.width, rect.height, opacities]), previous = window.__nativeDialogStability;
      const stable = previous?.signature === signature && rect.width > 0 && opacities.every(value => value >= .99) ? previous.stable + 1 : 0;
      window.__nativeDialogStability = { signature, stable }; return stable >= 3;
    }, null, { polling: 'raf', timeout: 10000 });
    await page.screenshot({ path: 'data/ui-fixtures/native-' + name + '.png', fullPage: true, animations: 'disabled' });
  }

  assert.equal(PLUGIN_MODULES.length, 6);
  if (!continueFromSpeech) {
  await open('core');
  await dialog.getByText('在工作台按联系人选择普通模式或自动记忆。', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('名称', { exact: true }).count(), 0, 'Default chat card must not edit a new persona');
  await dialog.getByRole('button', { name: /设置分类/ }).click();
  const categories = await page.getByRole('option').allTextContents();
  for (const label of ['chat', '角色', '群聊回复', 'QQ 连接', '回答模型', '管理与权限']) assert.ok(categories.includes(label), label);
  for (const label of ['身份', '默认全局角色', '默认连接', '会话分配', '长期记忆', '上下文', '历史读取', '群摘要', '对话记录', '语音']) assert.ok(!categories.includes(label), label);
  await page.getByRole('option', { name: '角色', exact: true }).click();
  assert.equal(await dialog.getByLabel('名称', { exact: true }).inputValue(), settings.bot.name);
  assert.equal(await dialog.getByLabel('管理员 QQ', { exact: true }).count(), 0);
  await dialog.getByLabel('名称', { exact: true }).fill('原生保存测试'); await dialog.getByLabel('系统提示词', { exact: true }).fill('默认全局角色的回答设定'); await capture('global-role'); await save();
  assert.equal(settings.bot.name, '原生保存测试'); assert.equal(settings.bot.systemPrompt, '默认全局角色的回答设定'); assert.equal(settings.profiles.length, 1);

  await open('core'); await select('设置分类', '角色'); await select('选择记录', '新增角色');
  await dialog.getByLabel('名称', { exact: true }).fill('代码导师'); await dialog.getByLabel('系统提示词', { exact: true }).fill('先让用户预测，再逐步讲解代码。'); await capture('persona'); await save();
  const persona = settings.profiles.find(profile => profile.name === '代码导师'); assert.ok(persona); assert.equal(persona.systemPrompt, '先让用户预测，再逐步讲解代码。'); assert.equal(settings.bot.name, '原生保存测试'); assert.equal(settings.profiles.length, 2);
  await open('core'); await select('设置分类', '群聊回复'); await select('选择记录', '测试学习群'); await dialog.getByLabel('群备注', { exact: true }).fill('已绑定群'); await select('角色', '学习助手'); await capture('groups'); await save(); assert.equal(settings.groups[0].profileId, 'study');

  await open('core'); await select('设置分类', 'QQ 连接'); await dialog.getByLabel('账号备注', { exact: true }).fill('第二账号'); await dialog.getByLabel('OneBot 连接地址', { exact: true }).fill('ws://127.0.0.1:3002'); await dialog.getByLabel('OneBot Token', { exact: true }).fill('isolated-fixture-token'); await select('默认角色', '代码导师'); await capture('account'); await save();
  const account = settings.accounts.find(account => account.name === '第二账号'); assert.ok(account); assert.equal(account.defaultProfileId, persona.id); assert.equal(secretWrites.at(-1)['onebotToken:' + account.id], 'isolated-fixture-token'); assert.equal(secretWrites.at(-1).onebotToken, undefined);
  await open('core'); await select('设置分类', 'QQ 连接'); await select('选择记录', '第二账号'); assert.equal(await dialog.getByLabel('OneBot Token', { exact: true }).inputValue(), ''); assert.equal((await dialog.innerText()).includes('isolated-fixture-token'), false); await close();
  await open('core'); await select('设置分类', '管理与权限'); await dialog.getByLabel('管理员 QQ', { exact: true }).fill('123456789'); await save(); assert.equal(settings.bot.ownerQQ, '123456789'); assert.equal(settings.bot.name, '原生保存测试');

  await open('core'); await select('设置分类', '回答模型'); await select('模型来源', 'API'); await dialog.getByLabel('API 地址', { exact: true }).fill('https://example.test/v1'); await dialog.getByLabel('模型名', { exact: true }).fill('fixture-chat-model'); await dialog.getByLabel('API Key', { exact: true }).fill('isolated-model-key'); await capture('model'); await save(); assert.equal(settings.ai.backend, 'api'); assert.equal(settings.ai.apiModel, 'fixture-chat-model'); assert.equal(secretWrites.at(-1).openaiKey, 'isolated-model-key');
  await open('core'); await select('设置分类', '回答模型'); assert.equal(await dialog.getByLabel('API Key', { exact: true }).inputValue(), ''); assert.equal((await dialog.innerText()).includes('isolated-model-key'), false); await close();

  await open('ucloud'); const schoolSwitch = await nativeSwitch('连接教学云'); if (!await schoolSwitch.isChecked()) await schoolSwitch.check(); await dialog.getByLabel('学号', { exact: true }).fill('fixture-student'); await dialog.getByLabel('学校密码', { exact: true }).fill('fixture-password'); await select('保存并执行', '登录教学云'); await capture('ucloud'); await save(); assert.equal(settings.school.enabled, true); assert.equal(schoolLogins.length, 1);
  await open('ucloud'); assert.equal(await dialog.getByLabel('学校密码', { exact: true }).inputValue(), ''); await close();

  await open('notices'); const noticeSwitch = await nativeSwitch('即时提醒'); if (!await noticeSwitch.isChecked()) await noticeSwitch.check(); await dialog.getByLabel('关注群', { exact: true }).fill('123456'); await dialog.getByLabel('包含关键词', { exact: true }).fill('作业，考试'); await dialog.getByLabel('排除关键词', { exact: true }).fill('广告'); await capture('notices'); await save(); assert.equal(settings.realtime.enabled, true); assert.deepEqual(settings.realtime.groups, ['123456']); assert.equal(settings.realtime.includeKeywords, '作业，考试'); assert.equal(settings.monitor.enabled, false);
  await open('notices'); await select('设置分类', '待办'); await select('选择记录', '仅测试事项'); await dialog.getByText(sourceText, { exact: false }).waitFor(); assert.equal(await page.evaluate(() => !!window.__injected), false); assert.equal(await dialog.locator('img[src=x]').count(), 0); await capture('notification-source'); await close();

  for (const [module, section] of [['github', 'github'], ['drive', 'drive']]) { await open(module); await select('连接方式', 'ChatGPT 连接'); await capture(module + '-apps'); await save(); assert.equal(settings[section].authMode, 'chatgpt'); }
  }
  await open('speech'); assert.ok(await dialog.getByLabel('语音指令', { exact: true }).count()); const speechSwitch = await nativeSwitch('启用语音'); if (!await speechSwitch.isChecked()) await speechSwitch.check(); await dialog.getByLabel('语音指令', { exact: true }).fill('温润的青年声线，普通话，语速稍慢'); await dialog.getByLabel('MiMo API / Token Plan Key', { exact: true }).fill('tp-isolated-speech-key'); await capture('speech'); await save(); assert.equal(settings.speech.enabled, true); assert.ok(settings.speech.style.includes('语速稍慢')); assert.equal(secretWrites.at(-1).mimoKey, 'tp-isolated-speech-key');
  await open('speech'); assert.equal(await dialog.getByLabel('MiMo API / Token Plan Key', { exact: true }).inputValue(), ''); assert.equal((await dialog.innerText()).includes('tp-isolated-speech-key'), false); await close();

  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { localStorage.setItem('theme', JSON.stringify('dark')); document.documentElement.classList.add('dark'); });
  for (const plugin of PLUGIN_MODULES) { await open(plugin.module); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await capture('mobile-dark-' + plugin.module); await close(); }
  const adapter = adapters.get(PLUGIN_MODULES[0].id), stale = await adapter.getConfig(), fresh = await adapter.getConfig(); await adapter.setConfig(fresh); await assert.rejects(() => adapter.setConfig(stale), /更新|冲突/);
  for (const plugin of PLUGIN_MODULES) { const adapter = adapters.get(plugin.id), config = await adapter.getConfig(), encoded = JSON.stringify(adapter.schema(config)); for (const secret of ['isolated-fixture-token', 'isolated-model-key', 'tp-isolated-speech-key', 'fixture-password']) assert.equal(encoded.includes(secret), false); }
  const configUrl = origin + '/api/Plugin/Config?id=' + PLUGIN_MODULES[0].id;
  const unauthenticated = await context.request.get(configUrl); assert.equal(unauthenticated.status(), 401);
  const denied = await context.request.post(origin + '/api/Plugin/Config', { headers: { authorization: 'Bearer isolated-test-only', origin: 'https://evil.test' }, data: { id: PLUGIN_MODULES[0].id, config: {} } }); assert.equal(denied.status(), 403);
  assert.deepEqual(errors, []); assert.equal(unexpected.filter(url => !url.startsWith('https://avatar.vercel.sh/')).length, 0);
  console.log(JSON.stringify({ passed: true, scope: continueFromSpeech ? 'speech-and-remaining-checks' : 'all', frontend: 'original installed NapCat assets', saves, modules: PLUGIN_MODULES.length, staleFormRejected: true, authRequired: true, originGuard: true, secretsNeverReturned: true, independentSpeechCard: true, mobileDark: true, knownHostA11y: 'Native boolean switches lack accessible names; matched by exact field row', ...(!continueFromSpeech ? { defaultChatCard: true, visibleCategoriesOnly: true, defaultGlobalRoleSaved: true, customRolePreservedGlobal: true, administratorSaved: true, accountTokenRouted: true, modelSaved: true, ucloudLogin: true, notificationFilters: true, sourceTextSafe: true, chatgptConnectorModes: true } : {}), modelRequests: 0, qqMessagesSent: 0, liveServiceConnections: 0 }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
