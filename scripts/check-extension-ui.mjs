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
const mediaItems=[],tinyGif='R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let mediaUploads=0,speechPreviews=0;
const memory = { notes: [{ id:'n1', scope:'global', text:'<img src=x onerror="window.injected=true">', kind:'fact', tags:[], enabled:true, updatedAt:'1' }], digests:[], conversations:[] };
const inbox={items:[{id:'todo-a',title:'提交课程作业',summary:'周五前完成',status:'pending',sources:[{excerpt:'原始通知：周五 18 点截止'}]}]};
const reports=[{id:'report-a',groupName:'课程群',createdAt:'2026-10-22',items:[{title:'课程作业',summary:'周五截止',sources:[{excerpt:'请提交第二章作业'}]}]}];
memory.conversations=[{scope:'account:default:profile:_:group:23456789',entries:[{role:'user',senderName:'同学',content:'什么时候截止？'},{role:'assistant',content:'周五 18 点'}],background:[{text:'提交入口开放'}]}];
memory.digests=[{groupId:'23456789',name:'实验群',digest:{summary:'第二章作业周五截止'}}];
const bridge = { async request(method, path, value) {
  if(method==='GET'&&path==='media')return {status:200,data:{items:structuredClone(mediaItems)}};
  if(method==='POST'&&path==='media'){mediaUploads++;const item={...value,id:'a'.repeat(32),size:Buffer.from(value.base64,'base64').length};delete item.base64;mediaItems.push(item);return {status:200,data:{item}};}
  if(method==='POST'&&path==='media/preview')return {status:200,data:{dataURL:'data:image/gif;base64,'+tinyGif}};
  if(method==='DELETE'&&path.startsWith('media/')){mediaItems.splice(0);return {status:200,data:{ok:true}};}
  if(method==='POST'&&path==='speech/preview'){assert.equal(value.style,'温柔安慰，语速稍慢');speechPreviews++;return {status:200,data:{dataURL:'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQQAAAAAAAAA'}};}
  if (method === 'POST' && path === 'qq/contacts') return {status:200,data:{groups:[{id:'23456789',name:'实验群'},{id:'34567890',name:'名称很长的课程通知和作业交流讨论群用于验证窄屏列表适配'}],friends:[{id:'123456789',name:'课程助教'}],errors:[]}};
  if (method === 'POST' && path.startsWith('check/')) return {status:200,data:{ok:path!=='check/drive',message:path==='check/drive'?'测试授权失效，请重新授权':'测试连接成功'}};
  if (method === 'POST' && path === 'ucloud/view') return {status:200,data:value.section==='detail'?{content:'作业正文\n<img src=x onerror="window.injected=true">附件说明'}:value.section==='notices'?{items:[{id:'notice-1',title:'课程通知',content:'<script>window.injected=true</script>报名周五截止',time:'2026-10-22',unread:true}],total:1,page:1}:{items:[{id:'42',title:'本周练习',course:'操作系统',deadline:'2026-10-23 18:00',type:3}]}};
  if (method === 'GET') return { status:200, data:structuredClone(path === 'state' ? { settings, groupTemplates:[{ id:'auto', name:'自动' }] } : path === 'memory' ? memory : path === 'inbox' ? inbox : { reports }) };
  if(method==='PUT'&&path==='inbox/item'){const item=inbox.items.find(i=>i.id===value.id);item.status=value.status;return {status:200,data:{item}};}
  if (method === 'PUT' && path === 'settings') { assert.equal(value.revision, settings.revision); settings = validateSettings({ ...value.settings, revision:settings.revision + 1 }); saves++; return { status:200, data:{ settings } }; }
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
  const settle=()=>page.waitForFunction(()=>document.querySelector('.page-tabs button')?.disabled===false||document.querySelector('[data-save]')?.disabled===false);
  const select = async (label,option) => {
    if(label==='设置分类')await page.getByRole('tab',{name:option,exact:true}).click();
    else if(label.startsWith('选择'))await page.locator('.record-row').filter({has:page.getByText(option,{exact:true})}).click();
    else {
      const group=page.getByRole('group',{name:label,exact:true}),button=page.getByRole('button',{name:new RegExp(label)});
      await group.or(button).first().waitFor();
      if(await group.count())await group.getByRole('button',{name:option,exact:true}).click();
      else {
        await button.click();
        try {await page.getByRole('option',{name:option,exact:true}).click({timeout:7000});}
        catch(error){await page.screenshot({path:'data/extension-select-failure.png',fullPage:true});throw Error(error.message+'; visible options: '+JSON.stringify(await page.getByRole('option').allTextContents()));}
      }
    }
    await settle();
  };
  const tab = async name => { await select('设置分类',name); await page.waitForFunction(text => document.querySelector('#description')?.textContent === text,PAGE_COPY[Object.keys(PAGE_COPY).find(p => PAGE_COPY[p].title === name)].description); };
  const save = async () => { await page.getByRole('button',{name:'保存更改',exact:true}).click(); await page.getByRole('status').filter({hasText:'已保存。'}).waitFor(); };
  if(!process.argv.includes('--speech-only')) {
  await open('napcat-plugin-qq-agent'); await page.getByRole('tab',{name:'身份',exact:true}).focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.getByRole('tab',{name:'人格',exact:true}).evaluate(e=>e===document.activeElement),true); await page.keyboard.press('Enter'); await settle();
  await page.getByLabel('名称',{exact:true}).fill('实验导师'); await page.getByLabel('系统提示词',{exact:true}).fill('逐步讲解\n先预测再实验'); await page.getByRole('button',{name:'保存角色',exact:true}).click(); await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  assert.equal(await page.locator('.persona-editor input,.persona-editor textarea').count(),2); assert.equal(await page.locator('.persona-editor select,.persona-editor details').count(),0);
  await page.waitForFunction(()=>!document.querySelector('.persona-editor button').disabled);
  assert.equal(await page.getByRole('button',{name:'分配角色',exact:true}).isEnabled(),true);
  await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/napcat-persona-simple-desktop.png',animations:'disabled'});
  await page.getByRole('button',{name:'新建',exact:true}).click(); await page.getByLabel('名称',{exact:true}).fill('临时角色'); await page.getByLabel('系统提示词',{exact:true}).fill('自由设定'); await page.getByRole('button',{name:'保存角色',exact:true}).click(); await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'删除角色',exact:true}).click(); await page.getByRole('status').filter({hasText:'已删除'}).waitFor(); assert.ok(!settings.profiles.some(p=>p.name==='临时角色'));
  await page.getByRole('button',{name:'实验导师',exact:true}).click(); assert.equal(await page.getByLabel('系统提示词',{exact:true}).inputValue(),'逐步讲解\n先预测再实验');
  await page.setViewportSize({width:390,height:844}); assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth)); await page.screenshot({path:'data/napcat-persona-simple-mobile.png',fullPage:true}); await page.setViewportSize({width:1280,height:900});
  await tab('QQ 账号'); await page.getByRole('button',{name:'新建',exact:true}).click(); await page.getByLabel('账号备注',{exact:true}).fill('第二 QQ'); await page.getByLabel('OneBot 连接地址',{exact:true}).fill('ws://127.0.0.1:3002');
  const token = page.getByLabel('OneBot Token',{exact:true}); assert.equal(await token.getAttribute('type'),'password'); await token.fill('fixture-secret');
  await select('默认人格','实验导师'); await save();
  const account = settings.accounts.find(a => a.name === '第二 QQ'); assert.ok(account); assert.equal(writes.at(-1)['onebotToken:' + account.id],'fixture-secret'); assert.equal(await token.inputValue(),'');
  await tab('分配'); await select('QQ 账号','第二 QQ'); await select('聊天类型','私聊'); await page.getByLabel('聊天对象',{exact:true}).fill('123456789'); await select('人格','实验导师'); await save();
  assert.ok(settings.bindings.some(b => b.accountId === account.id && b.kind === 'private' && b.profileId === account.defaultProfileId));
  await tab('身份'); await page.getByLabel('机器人名字',{exact:true}).fill('不应保存');
  page.once('dialog',d => d.dismiss()); await select('设置分类','人格'); assert.equal(await page.getByLabel('机器人名字',{exact:true}).inputValue(),'不应保存');
  page.once('dialog',d => d.accept()); await tab('长期记忆'); await select('选择记忆',memory.notes[0].text); assert.equal(await page.locator('#fields img').count(),0); assert.equal(await page.evaluate(() => window.injected),undefined);
  for (const p of PLUGIN_MODULES) { await open(p.id); assert.equal(await page.locator('aside,header,footer,nav').count(),0); assert.ok(await page.locator('[data-slot="input-wrapper"],[role="switch"]').count() > 0); }
  await open('napcat-plugin-qq-agent'); await tab('群聊'); await page.getByRole('button',{name:'从群列表选择',exact:true}).click(); await page.getByLabel('搜索群',{exact:true}).fill('实验'); await page.getByRole('button',{name:/实验群 23456789/}).click(); assert.equal(await page.getByLabel('群备注',{exact:true}).inputValue(),'实验群'); await save();
  await select('选择群聊','实验群'); await page.screenshot({path:'data/extension-native-controls.png',fullPage:true});
  // Verify inside the unchanged, installed NapCat extension shell.
  await page.goto(origin+'/webui/extension');
  const frameElement = page.locator('iframe[title="extension-page"]'); await frameElement.waitFor();
  const frame = await frameElement.contentFrame();
  await frame.getByRole('button',{name:'保存更改',exact:true}).waitFor();
  await page.waitForFunction(() => { const f=document.querySelector('iframe'); return f?.contentDocument?.querySelector('button[type=submit]')?.disabled === false; });
  await frame.getByRole('tab',{name:'群聊',exact:true}).click();
  await frame.locator('.record-row').filter({has:frame.getByText('实验群',{exact:true})}).click();
  assert.equal(await frame.locator('aside,header,footer,nav').count(),0);
  const compare = await page.evaluate(() => { const f=document.querySelector('iframe'),doc=f.contentDocument; return {host:getComputedStyle(document.documentElement).getPropertyValue('--heroui-primary').trim(),inner:f.contentWindow.getComputedStyle(doc.documentElement).getPropertyValue('--heroui-primary').trim()}; }); assert.ok(compare.host); assert.equal(compare.host,compare.inner);
  const capture = async path => {
    await page.mouse.move(0,0);
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
  await open('napcat-plugin-agent-notices'); await page.getByRole('button',{name:'从群列表选择',exact:true}).click(); await page.getByRole('button',{name:/实验群 23456789/}).click(); await page.getByRole('button',{name:/名称很长的课程通知/}).click();
  assert.equal(await page.getByLabel('关注群',{exact:true}).inputValue(),'23456789, 34567890'); assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'从好友列表选择',exact:true}).click(); await page.getByRole('button',{name:/课程助教 123456789/}).click(); await save(); assert.equal(settings.realtime.recipientQQ,'123456789'); assert.equal(settings.realtime.groups.length,2);
  await open('napcat-plugin-agent-drive'); const driveSwitch=page.getByRole('switch',{name:'允许查询云盘'}); assert.equal(await driveSwitch.isChecked(),true); await driveSwitch.uncheck(); await save(); assert.equal(settings.drive.enabled,false);
  await page.getByRole('button',{name:'检测连接',exact:true}).click(); await page.locator('#feedback').filter({hasText:'测试授权失效'}).waitFor(); assert.ok((await page.locator('#feedback').getAttribute('class')).includes('error'));
  await open('napcat-plugin-agent-ucloud'); await page.getByRole('button',{name:'查看待交作业',exact:true}).click(); await page.getByRole('button',{name:/本周练习/}).click(); await page.getByRole('article',{name:'消息正文'}).filter({hasText:'作业正文'}).waitFor();
  await page.getByRole('button',{name:'查看教学云通知',exact:true}).click(); await page.getByRole('button',{name:/课程通知/}).click(); await page.getByRole('article',{name:'消息正文'}).filter({hasText:'报名周五截止'}).waitFor(); assert.equal(await page.evaluate(()=>window.injected),undefined); assert.equal(await page.locator('.school-reader script,.school-reader img').count(),0);
  await page.evaluate(()=>{localStorage.setItem('theme',JSON.stringify('dark'));window.dispatchEvent(new StorageEvent('storage',{key:'theme'}));});
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await page.mouse.move(0,0); await page.screenshot({path:'data/napcat-school-reader-mobile-dark.png',fullPage:true});
  await open('napcat-plugin-qq-agent'); await tab('模型'); assert.equal(await page.getByLabel('API 地址',{exact:true}).count(),0);
  await select('模型来源','API'); await page.getByLabel('API 地址',{exact:true}).fill('https://example.test/v1'); await page.getByLabel('模型名',{exact:true}).fill('fixture-model'); await page.getByLabel('API Key',{exact:true}).fill('mode-draft-secret');
  await select('模型来源','ChatGPT'); assert.equal(await page.getByLabel('API 地址',{exact:true}).count(),0); await select('模型来源','API'); assert.equal(await page.getByLabel('API 地址',{exact:true}).inputValue(),'https://example.test/v1');
  await save(); assert.equal(settings.ai.apiModel,'fixture-model'); assert.equal(writes.at(-1).openaiKey,'mode-draft-secret');
  await select('模型来源','DeepSeek API');
  await page.getByLabel('DeepSeek 模型',{exact:true}).fill('deepseek-flash');
  const deepseekKey=page.getByLabel('DeepSeek API Key',{exact:true}); assert.equal(await deepseekKey.getAttribute('type'),'password'); await deepseekKey.fill('fixture-deepseek-key');
  assert.equal(await page.getByLabel('API 地址',{exact:true}).count(),0); await save();
  assert.equal(settings.ai.backend,'deepseek'); assert.equal(writes.at(-1).deepseekKey,'fixture-deepseek-key'); assert.equal(writes.at(-1).openaiKey,undefined);
  await page.setViewportSize({width:1280,height:900}); await page.screenshot({path:'data/deepseek-research/deepseek-api-desktop.png',fullPage:true});
  await select('模型来源','DeepSeek Harness'); await select('Harness 授权方式','Harness 已有账号登录');
  assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).count(),0); await save(); assert.equal(settings.ai.harnessAuth,'account'); assert.equal(settings.ai.deepseekModel,'deepseek-flash');
  await page.setViewportSize({width:320,height:844}); assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth)); await page.screenshot({path:'data/deepseek-research/harness-account-mobile.png',fullPage:true});
  await select('Harness 授权方式','使用 API Key'); assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).getAttribute('type'),'password'); await save();
  await open('napcat-plugin-agent-notices'); await tab('待办'); await page.getByRole('group',{name:'待办状态'}).getByRole('button',{name:'已完成',exact:true}).click(); await page.locator('#feedback').filter({hasText:'已保存'}).waitFor(); assert.equal(inbox.items[0].status,'done'); assert.equal(await page.getByRole('button',{name:'保存更改',exact:true}).count(),0); assert.ok(await page.locator('.reader-body').innerText());
  await tab('整理记录'); assert.ok((await page.locator('.reader-body').innerText()).includes('请提交第二章作业'));
  for(const [module,labels] of [['napcat-plugin-qq-agent',['身份','人格','分配','群聊','QQ 账号','模型','权限','资料库','长期记忆','上下文','历史读取','群摘要','对话']],['napcat-plugin-agent-notices',['即时提醒','定时整理','待办','整理记录']]]){
    await open(module);
    for(const [theme,width] of [['light',320],['dark',1280]]){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>{localStorage.setItem('theme',JSON.stringify(theme));window.dispatchEvent(new StorageEvent('storage',{key:'theme'}));},theme);
      for(const label of labels){await tab(label);assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));assert.equal(await page.locator('details details').count(),0);assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('dark')),theme==='dark');}
    }
  }
  await tab('定时整理'); await page.setViewportSize({width:390,height:844}); await page.mouse.move(0,0); await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/settings-overhaul-notices-mobile.png',animations:'disabled'});
  await page.setViewportSize({width:1280,height:900}); await open('napcat-plugin-qq-agent'); await tab('群聊'); await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/settings-overhaul-groups.png',animations:'disabled'});
  await page.evaluate(()=>{localStorage.setItem('theme',JSON.stringify('dark'));window.dispatchEvent(new StorageEvent('storage',{key:'theme'}));});
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/napcat-ui-polished-dark.png',animations:'disabled'});
  await tab('人格'); await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/napcat-ui-persona-dark.png',animations:'disabled'});
  await page.setViewportSize({width:320,height:844}); await page.getByRole('main',{name:'插件设置'}).screenshot({path:'data/napcat-ui-persona-mobile-dark.png',animations:'disabled'});
  await page.emulateMedia({reducedMotion:'reduce'}); assert.ok(await page.locator('.page-tabs button').first().evaluate(e=>parseFloat(getComputedStyle(e).transitionDuration)<=.001));
  await tab('对话'); assert.ok((await page.locator('.reader-body').innerText()).includes('什么时候截止')); assert.equal((await page.locator('.reader-body').innerText()).includes('[object Object]'),false);
  for(const module of ['napcat-plugin-agent-github','napcat-plugin-agent-drive','napcat-plugin-agent-ucloud']){
    await open(module);
    for(const [theme,width] of [['light',1280],['dark',320]]){
      await page.setViewportSize({width,height:900});await page.evaluate(theme=>{localStorage.setItem('theme',JSON.stringify(theme));window.dispatchEvent(new StorageEvent('storage',{key:'theme'}));},theme);
      assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));
      assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('dark')),theme==='dark');
    }
  }
  }
  const denied = await context.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { headers:{ authorization:'Bearer fixture', origin:'https://evil.test' }, data:{ operation:'load' } }); assert.equal(denied.status(),403);
  const unauth = await browser.newContext(); const response = await unauth.request.post(origin + '/api/Plugin/ext/napcat-plugin-qq-agent/settings-ui', { data:{ operation:'load' } }); assert.equal(response.status(),401); await unauth.close();
  await page.setViewportSize({width:1280,height:900});await open('napcat-plugin-qq-agent');await tab('图片与表情包');
  await page.getByLabel('素材使用范围',{exact:true}).selectOption('private');await page.getByLabel('素材好友 QQ',{exact:true}).fill('123456789');
  await page.getByLabel('素材文件',{exact:true}).setInputFiles({name:'开心.gif',mimeType:'image/gif',buffer:Buffer.from(tinyGif,'base64')});
  await page.getByRole('button',{name:'上传素材',exact:true}).click();await page.getByRole('status').filter({hasText:'上传成功'}).waitFor();assert.equal(mediaUploads,1);assert.equal(mediaItems[0].targetId,'123456789');
  await page.getByRole('button',{name:'预览',exact:true}).click();await page.locator('.media-preview').waitFor();assert.equal(await page.locator('.media-preview').getAttribute('alt'),'开心');
  await page.screenshot({path:'data/outgoing-media-desktop.png',fullPage:true});
  await page.evaluate(()=>{localStorage.setItem('theme',JSON.stringify('dark'));window.dispatchEvent(new StorageEvent('storage',{key:'theme'}));});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await page.setViewportSize({width:320,height:844});assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));await page.screenshot({path:'data/outgoing-media-mobile-dark.png',fullPage:true});
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('status').filter({hasText:'已删除素材'}).waitFor();assert.equal(mediaItems.length,0);
  await tab('语音');const mimoKey=page.getByLabel('MiMo API Key',{exact:true});assert.equal(await mimoKey.getAttribute('type'),'password');
  await mimoKey.fill('tp-speech-fixture');await page.getByRole('switch',{name:'启用语音',exact:true}).check();await save();assert.equal(settings.speech.enabled,true);assert.equal(writes.at(-1).mimoKey,'tp-speech-fixture');assert.equal(await mimoKey.inputValue(),'');
  assert.equal(await page.getByRole('switch',{name:'按内容自动调整表达',exact:true}).isChecked(),true);
  await select('音色方式','文字设计音色');await page.getByLabel('音色描述',{exact:true}).fill('青年女性，声线温润，咬字清晰');assert.equal(await page.getByLabel('音色',{exact:true}).count(),0);await save();assert.equal(settings.speech.model,'mimo-v2.5-tts-voicedesign');
  await select('音色方式','预置音色');assert.equal(await page.getByLabel('音色描述',{exact:true}).count(),0);await page.getByLabel('固定语气与语速要求',{exact:true}).fill('自然清晰，不要夸张');await save();assert.equal(settings.speech.voiceDescription,'青年女性，声线温润，咬字清晰');
  await page.getByLabel(/本次表达指令/).fill('温柔安慰，语速稍慢');
  await page.getByRole('button',{name:'生成试听',exact:true}).click();await page.locator('audio').waitFor();assert.equal(speechPreviews,1);assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));
  await page.screenshot({path:'data/outgoing-speech-mobile-dark.png',fullPage:true});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed:true, scope:process.argv.includes('--speech-only')?'media-and-speech':'all', modules:process.argv.includes('--speech-only')?1:5, saves,
    ...(!process.argv.includes('--speech-only')?{independentAccountToken:true,bindings:true,dirtyGuard:true,safeText:true,nativeShell:true,inheritedTheme:true,deepseekAPI:true,deepseekHarness:true,independentDeepSeekKey:true}:{}),
    realHeroUI:true,mobileDark:true,originGuard:true,mediaUpload:true,mediaPreview:true,mediaDelete:true,tokenPlanSpeechUI:true,voiceDesign:true,perMessageInstructions:true,fixtureOnly:true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
