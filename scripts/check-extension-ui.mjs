// Isolated fixtures only: no real QQ, model calls or personal settings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { defaults, validateSettings } from '../src/settings.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';
import { registerBridge } from '../napcat-plugin/bridge.mjs';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
import { PAGE_COPY } from '../napcat-plugin/webui/copy.mjs';
const nativeRoot = resolve('tools/napcat/napcat/static');
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
    if (path.startsWith('/api/')) {
      const data = path === '/api/Plugin/List' ? { plugins:PLUGIN_MODULES.map(p => ({...p,status:'active',version:'fixture',hasConfig:true})), extensionPages:PLUGIN_MODULES.map(p => ({pluginId:p.id,pluginName:p.name,path:'settings',title:({core:'机器人',github:'GitHub',drive:'云盘',ucloud:'教学云',notices:'群消息'})[p.module]})) } : path === '/api/auth/check' ? {isLogin:true} : path.includes('QQLogin') ? {isLogin:true,nickname:'隔离测试'} : {};
      res.setHeader('content-type','application/json'); return res.end(JSON.stringify({code:0,message:'ok',data}));
    }
    if (path.startsWith('/webui/')) {
      const relative = path.slice(7), file = resolve(nativeRoot,relative.includes('.') ? decodeURIComponent(relative) : 'index.html');
      assert.ok(file.startsWith(nativeRoot+sep));
      res.setHeader('content-type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)] || 'application/octet-stream');
      return res.end(await readFile(file));
    }
    const name = path.endsWith('/settings') ? 'index.html' : path.split('/').at(-1);
    assert.ok(['index.html','app.js','style.css','copy.mjs'].includes(name));
    res.setHeader('content-type', /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(new URL('../napcat-plugin/webui/' + name, import.meta.url)));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error:error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel:'msedge', headless:true });
  const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await context.addInitScript(() => { localStorage.setItem('token', JSON.stringify('fixture')); localStorage.setItem('theme',JSON.stringify('light')); localStorage.setItem('side-bar-open','false'); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const ready = () => page.getByRole('button',{name:'保存更改',exact:true}).waitFor();
  const open = async id => { await page.goto(origin + '/plugin/' + id + '/page/settings'); await ready(); await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled); };
  const select = async (label,option) => { await page.getByRole('button',{name:new RegExp(label)}).click(); await page.getByRole('option',{name:option,exact:true}).click(); await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled); };
  const tab = async name => { await select('设置分类',name); await page.waitForFunction(text => document.querySelector('#description')?.textContent === text,PAGE_COPY[Object.keys(PAGE_COPY).find(p => PAGE_COPY[p].title === name)].description); };
  const save = async () => { await page.getByRole('button',{name:'保存更改',exact:true}).click(); await page.getByRole('status').filter({hasText:'已保存。'}).waitFor(); };
  await open('napcat-plugin-qq-agent'); await tab('角色与语气');
  await page.getByLabel('角色名称',{exact:true}).fill('实验导师'); await page.getByLabel('角色设定',{exact:true}).fill('逐步讲解\n先预测再实验'); await save();
  await tab('QQ 账号连接'); await page.getByLabel('账号备注',{exact:true}).fill('第二 QQ'); await page.getByLabel('OneBot 连接地址',{exact:true}).fill('ws://127.0.0.1:3002');
  const token = page.getByLabel('OneBot Token',{exact:true}); assert.equal(await token.getAttribute('type'),'password'); await token.fill('fixture-secret');
  await select('默认角色','实验导师'); await save();
  const account = settings.accounts.find(a => a.name === '第二 QQ'); assert.ok(account); assert.equal(writes.at(-1)['onebotToken:' + account.id],'fixture-secret'); assert.equal(await token.inputValue(),'');
  await tab('会话角色分配'); await select('使用哪个 QQ','第二 QQ'); await select('用于哪种聊天','私聊'); await page.getByLabel('群号或好友 QQ',{exact:true}).fill('123456789'); await select('使用角色','实验导师'); await save();
  assert.ok(settings.bindings.some(b => b.accountId === account.id && b.kind === 'private' && b.profileId === account.defaultProfileId));
  await tab('机器人身份'); await page.getByLabel('机器人名字',{exact:true}).fill('不应保存');
  page.once('dialog',d => d.dismiss()); await select('设置分类','角色与语气'); assert.equal(await page.getByLabel('机器人名字',{exact:true}).inputValue(),'不应保存');
  page.once('dialog',d => d.accept()); await tab('长期记忆'); await select('选择记忆',memory.notes[0].text); assert.equal(await page.locator('#fields img').count(),0); assert.equal(await page.evaluate(() => window.injected),undefined);
  for (const p of PLUGIN_MODULES) { await open(p.id); assert.equal(await page.locator('aside,header,footer,nav').count(),0); assert.ok(await page.locator('[data-slot="trigger"]').count() > 0); }
  await open('napcat-plugin-qq-agent'); await tab('群聊回复'); await page.getByLabel('群号',{exact:true}).fill('23456789'); await page.getByLabel('群备注',{exact:true}).fill('实验群'); await save();
  await select('选择群聊','实验群'); await page.screenshot({path:'data/extension-native-controls.png',fullPage:true});
  // Verify inside the unchanged, installed NapCat extension shell.
  await page.goto(origin+'/webui/extension');
  const frameElement = page.locator('iframe[title="extension-page"]'); await frameElement.waitFor();
  const frame = await frameElement.contentFrame();
  await frame.getByRole('button',{name:'保存更改',exact:true}).waitFor();
  await page.waitForFunction(() => { const f=document.querySelector('iframe'); return f?.contentDocument?.querySelector('button[type=submit]')?.disabled === false; });
  await frame.getByRole('button',{name:/设置分类/}).click(); await frame.getByRole('option',{name:'群聊回复',exact:true}).click();
  await frame.getByRole('button',{name:/选择群聊/}).click(); await frame.getByRole('option',{name:'实验群',exact:true}).click();
  assert.equal(await frame.locator('aside,header,footer,nav').count(),0);
  const compare = await page.evaluate(() => { const f=document.querySelector('iframe'),doc=f.contentDocument; return {host:getComputedStyle(document.documentElement).getPropertyValue('--heroui-primary').trim(),inner:f.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--heroui-primary').trim()}; }); assert.ok(compare.host); assert.equal(compare.host,compare.inner);
  const capture = async path => {
    await page.waitForFunction(() => {
      const element=document.querySelector('iframe'), r=element?.getBoundingClientRect(); if(!r) return false;
      for(let e=element;e;e=e.parentElement) if(Number(getComputedStyle(e).opacity)<0.99) return false;
      const sig=JSON.stringify([r.x,r.y,r.width,r.height]), old=window.__captureState;
      window.__captureState={sig,count:old?.sig===sig?old.count+1:0}; return window.__captureState.count>=3;
    },null,{polling:'raf'});
    await page.screenshot({path,fullPage:true,animations:'disabled'});
  };
  await capture('data/napcat-extension-native-light.png');
  await page.evaluate(() => {localStorage.setItem('theme',JSON.stringify('dark'));document.documentElement.classList.add('dark');});
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement.classList.contains('dark'));
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await frame.locator('html').evaluate(e => e.scrollWidth<=innerWidth));
  await capture('data/napcat-extension-native-mobile-dark.png');
  const denied = await context.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { headers:{ authorization:'Bearer fixture', origin:'https://evil.test' }, data:{ operation:'load' } }); assert.equal(denied.status(),403);
  const unauth = await browser.newContext(); const response = await unauth.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { data:{ operation:'load' } }); assert.equal(response.status(),401); await unauth.close();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed:true, modules:5, saves, independentAccountToken:true, bindings:true, dirtyGuard:true, safeText:true, nativeShell:true, realHeroUI:true, inheritedTheme:true, mobileDark:true, originGuard:true, fixtureOnly:true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
