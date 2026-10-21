// Isolated fixtures only: no real QQ, model calls or personal settings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { defaults, validateSettings } from '../src/settings.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';
import { registerBridge } from '../napcat-plugin/bridge.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
let settings = defaults({}), writes = [], saves = 0;
const memory = { notes: [{ id:'n1', scope:'global', text:'<img src=x onerror="window.injected=true">', kind:'fact', tags:[], enabled:true, updatedAt:'1' }], digests:[], conversations:[] };
const bridge = { async request(method, path, value) {
  if (method === 'GET') return { status:200, data:structuredClone(path === 'state' ? { settings, groupTemplates:[{ id:'auto', name:'自动' }] } : path === 'memory' ? memory : path === 'inbox' ? { items:[] } : { reports:[] }) };
  if (method === 'PUT' && path === 'settings') { assert.equal(value.revision, settings.revision); try { settings = validateSettings({ ...value.settings, revision:settings.revision + 1 }); } catch(error) { console.error(JSON.stringify(value.settings.profiles)); throw error; } saves++; return { status:200, data:{ ok:true } }; }
  if (method === 'PUT' && path === 'secrets') { writes.push(value); return { status:200, data:{ ok:true } }; }
  throw Error('Unexpected side effect ' + method + ' ' + path);
} };
const routes = new Map();
for (const p of PLUGIN_MODULES) registerBridge({ router:{ post:(path, handler) => routes.set(p.id + path, handler) } }, bridge, createNativeConfigAdapter({ module:p.module, bridge }));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/Plugin/ext/')) {
      if (req.headers.authorization !== 'Bearer fixture') { res.writeHead(401); return res.end('{}'); }
      let body = ''; for await (const chunk of req) body += chunk;
      const key = path.slice('/api/Plugin/ext/'.length), handler = routes.get(key); assert.ok(handler);
      return await handler({ headers:req.headers, body:JSON.parse(body) }, { setHeader:(...args) => res.setHeader(...args), status(code) { res.statusCode = code; return this; }, json(value) { res.setHeader('content-type','application/json'); res.end(JSON.stringify(value)); } });
    }
    const name = path.endsWith('/settings') ? 'index.html' : path.split('/').at(-1);
    assert.ok(['index.html','app.js','style.css'].includes(name));
    res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(new URL('../napcat-plugin/webui/' + name, import.meta.url)));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error:error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel:'msedge', headless:true });
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await context.addInitScript(() => localStorage.setItem('token', JSON.stringify('fixture')));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const open = id => page.goto(origin + '/plugin/' + id + '/page/settings');
  const tab = async name => { await page.getByRole('button', { name, exact:true }).click(); await page.getByRole('heading', { name, exact:true }).waitFor(); await page.waitForFunction(() => !document.querySelector('#save').disabled); };
  const save = async () => { await page.getByRole('button', { name:'保存当前设置' }).click(); await page.waitForFunction(() => !document.querySelector('#save').disabled); assert.equal(await page.locator('#feedback').textContent(), '已保存当前设置。'); };
  await open('napcat-plugin-qq-agent'); await tab('人格池');
  await page.getByLabel('名称', { exact:true }).fill('实验导师'); await page.getByLabel('人格设定', { exact:true }).fill('逐步讲解\n先预测再实验'); await save();
  await tab('QQ 账号'); await page.getByLabel('名称', { exact:true }).fill('第二 QQ'); await page.getByLabel('连接地址', { exact:true }).fill('ws://127.0.0.1:3002');
  const token = page.getByLabel('替换连接密钥'); assert.equal(await token.getAttribute('type'), 'password'); await token.fill('fixture-secret');
  await page.getByLabel('默认人格', { exact:true }).selectOption({ label:'实验导师' }, { timeout:3000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; }); await save();
  const account = settings.accounts.find(a => a.name === '第二 QQ'); assert.ok(account); assert.equal(writes.at(-1)['onebotToken:' + account.id], 'fixture-secret'); assert.equal(await token.inputValue(), '');
  await page.screenshot({ path:'data/extension-accounts.png', fullPage:true });
  await tab('群聊 / 私聊人格'); await page.getByLabel('QQ 账号', { exact:true }).selectOption(account.id); await page.getByLabel('类型', { exact:true }).selectOption('private'); await page.getByLabel('群号 / 对方 QQ', { exact:true }).fill('123456789'); await page.getByLabel('使用人格', { exact:true }).selectOption({ label:'实验导师' }); await save();
  assert.ok(settings.bindings.some(b => b.accountId === account.id && b.kind === 'private' && b.profileId === account.defaultProfileId));
  await tab('基本设置'); await page.getByLabel('名称', { exact:true }).fill('不应保存');
  page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name:'人格池', exact:true }).click(); assert.equal(await page.getByLabel('名称', { exact:true }).inputValue(), '不应保存');
  page.once('dialog', d => d.accept()); await tab('记忆管理'); await page.getByLabel('选择记录').selectOption('n1'); await page.waitForFunction(() => !document.querySelector('#save').disabled); assert.equal(await page.locator('#fields img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
  for (const p of PLUGIN_MODULES) { await open(p.id); await page.waitForFunction(() => !document.querySelector('#save').disabled); assert.equal(await page.locator('#navigation button').count() > 0, true); }
  await open('napcat-plugin-qq-agent'); await tab('QQ 账号'); await page.setViewportSize({ width:390, height:844 }); await page.emulateMedia({ colorScheme:'dark' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path:'data/extension-mobile-dark.png', fullPage:true });
  const denied = await context.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { headers:{ authorization:'Bearer fixture', origin:'https://evil.test' }, data:{ operation:'load' } }); assert.equal(denied.status(),403);
  const unauth = await browser.newContext(); const response = await unauth.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { data:{ operation:'load' } }); assert.equal(response.status(),401); await unauth.close();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed:true, modules:5, saves, independentAccountToken:true, bindings:true, dirtyGuard:true, safeText:true, mobileDark:true, originGuard:true, fixtureOnly:true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
