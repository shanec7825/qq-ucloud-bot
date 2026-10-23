import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NoticeMonitor, noticeSamples, extractNotices } from '../src/notice-monitor.mjs';
import { defaults, SettingsStore, validateSettings } from '../src/settings.mjs';
import { BotRuntime } from '../src/runtime.mjs';

const group = '300000001';
const exported = () => ({ chatInfo: { peerUid: group, selfUin: '100000002' }, messages: [
  { id: '1', timestamp: 1700000000, sender: { uin: '100000003', nickname: '不发送姓名' }, content: { text: '请于明晚20:00前提交选课材料，联系13800138000，token: SECRET' } },
  { id: '2', sender: { uin: '100000002' }, content: { text: '机器人自己的话' } },
] });
const result = () => JSON.stringify({ items: [{ title: '提交选课材料', summary: '请提交选课材料', deadlineText: '明晚20:00前', priority: 'urgent', sources: ['m1'] }] });
async function fixture(run) {
  await mkdir(resolve('data'), { recursive: true });
  const folder = await mkdtemp(resolve('data/slyra-notices-test-')), root = pathToFileURL(folder + '/');
  try { await run(root); } finally { await rm(folder, { recursive: true, force: true }); }
}

test('通知报告在一次模型请求中选择场景，仅保存本地且绝不发送 QQ', () => fixture(async root => {
  const config = defaults({}); Object.assign(config.monitor, { enabled: true, groups: [group], notify: true, recipientQQ: '100000009' });
  config.groups.push({ id: group, name: '活动群', template: 'auto', templatePrompt: '' });
  let calls = 0; const sends = [];
  const monitor = new NoticeMonitor({ settings: () => config, root, exporter: { export: async () => exported() }, ai: async (_question, context) => {
    calls++; assert.equal(context.groupTemplate.selected, 'auto'); return JSON.stringify({ ...JSON.parse(result()), template: 'gaming' });
  }, send: async (target, text) => sends.push({ target, text }) });
  await monitor.run(); assert.equal(calls, 1); assert.equal((await monitor.reports())[0].template, 'gaming'); assert.equal((await monitor.reports())[0].delivery,'local'); assert.deepEqual(sends,[]);
}));

test('监测样本校验来源群、过滤自己并脱敏；截止时间和引用必须有原文依据', () => {
  const samples = noticeSamples(exported(), group);
  assert.equal(samples.length, 1); assert.ok(!JSON.stringify(samples).includes('13800138000')); assert.ok(!JSON.stringify(samples).includes('SECRET')); assert.ok(!JSON.stringify(samples).includes('不发送姓名'));
  assert.throws(() => noticeSamples(exported(), '300000002'));
  const raw = JSON.parse(result()); raw.items.push({ ...raw.items[0], sources: ['m999'] }); raw.items[0].deadlineText = '不存在的日期';
  const items = extractNotices(JSON.stringify(raw), samples); assert.equal(items.length, 1); assert.equal(items[0].deadlineText, ''); assert.ok(items[0].sources[0].excerpt.includes('明晚20:00前'));
});

test('报告只保存在本地，同样历史不会重复调用模型，失败受间隔约束', () => fixture(async root => {
  let now = 1700000000000, calls = 0, exports = 0; const sends = [], config = defaults({});
  Object.assign(config.monitor, { enabled: true, groups: [group], notify: true, recipientQQ: '100000009' });
  const monitor = new NoticeMonitor({ settings: () => config, root, now: () => now,
    exporter: { export: async () => { exports++; return exported(); } },
    ai: async (_q, context) => { calls++; assert.equal(context.mode, 'notice-monitor'); assert.ok(!JSON.stringify(context).includes('不发送姓名')); return result(); }, send: async (target, text) => sends.push({ target, text }) });
  assert.equal((await monitor.run()).results[0].status, 'updated');
  assert.deepEqual(sends,[]); assert.equal((await monitor.reports())[0].delivery, 'local');
  assert.equal(await monitor.answer('最近有什么', { message_type: 'private', user_id: '100000009' }),null);
  assert.equal(await monitor.answer('历史记录有什么', { message_type: 'private', user_id: '100000008' }),null);
  assert.equal(await monitor.answer('历史记录有什么', { message_type: 'group', user_id: '100000009' }), null);
  assert.equal((await monitor.run({ force: true })).results[0].status, 'not_due'); assert.equal(exports, 1);
  now += 3 * 3600000;
  assert.equal((await monitor.run()).results[0].status, 'unchanged'); assert.equal(calls, 1); assert.equal(sends.length, 0);
  now += 3 * 3600000; monitor.exporter.export = async () => { exports++; throw new Error('private internal diagnostic'); };
  assert.equal((await monitor.run()).results[0].status, 'failed');
  const count = exports; await monitor.run(); assert.equal(exports, count); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(await monitor.status()).includes('private internal diagnostic'));
}));

test('关闭监测后在途模型结果不落盘，本地整理不依赖 QQ 发送能力', () => fixture(async root => {
  const config = defaults({}); Object.assign(config.monitor, { enabled: true, groups: [group], notify: true, recipientQQ: '100000009' });
  let sends = 0; const monitor = new NoticeMonitor({ settings: () => config, root, exporter: { export: async () => exported() },
    ai: async () => { config.monitor.enabled = false; return result(); }, send: async () => { sends++; } });
  assert.equal((await monitor.run()).results[0].status, 'cancelled'); assert.deepEqual(await monitor.reports(), []); assert.equal(sends, 0);
  config.monitor.enabled = true;
  const failure = new NoticeMonitor({ settings: () => config, root: new URL('delivery/', root), exporter: { export: async () => exported() }, ai: async () => result(), send: async () => { throw new Error('offline'); } });
  await failure.run(); assert.equal((await failure.reports())[0].delivery, 'local');
}));

test('旧版本失败投递记录不再触发 QQ 重试', () => fixture(async root => {
  const config = defaults({}); Object.assign(config.monitor, { enabled: true, groups: [group], notify: true, recipientQQ: '100000009' });
  let now = 1700000000000, sends = 0, models = 0;
  const monitor = new NoticeMonitor({ settings: () => config, root, now: () => now, exporter: { export: async () => exported() }, ai: async () => { models++; return result(); }, send: async () => { sends++; throw new Error('offline'); } });
  await writeFile(new URL('reports.json',root),JSON.stringify([{id:'legacy',groupId:group,items:[],delivery:'private_failed',deliveryRecipient:'100000009',deliveryAttempts:1,deliveryAttemptAt:now-600000}]));
  await monitor.run(); await monitor.run(); assert.equal(sends, 0);
  now += 300001; await monitor.run(); assert.equal(sends, 0); assert.equal(models, 1);
  config.monitor.recipientQQ = '100000008'; now += 300001; await monitor.run(); assert.equal(sends, 0);
}));

test('不填主人仍连接 QQ、普通群可聊天；监测群 @ 与出站均强制静默，暂停整理后仍保护', () => fixture(async root => {
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  const next = store.get(); next.groups = [{ id: group, name: '年级群', enabled: true, historyEnabled: false }]; next.monitor.groups = [group];
  await store.update(next, next.revision); const sent = [];
  const runtime = new BotRuntime(store, { get: key => key === 'onebotToken' ? 'test-token' : '' }, { root,
    botFactory: () => ({ socket: {}, connect() { this.socket.readyState = 1; }, close() {}, send: (...args) => sent.push(args), call: async () => [] }) });
  let calls = 0; runtime.ai = async () => { calls++; return '你好'; }; runtime.apply();
  assert.equal(runtime.bot.socket.readyState, 1); assert.equal(store.get().bot.ownerQQ, '');
  const event = { post_type: 'message', message_type: 'group', group_id: group, self_id: '100000002', user_id: '100000003', message_id: 1,
    message: [{ type: 'at', data: { qq: '100000002' } }, { type: 'text', data: { text: '你好' } }] };
  await runtime.handler(event); assert.equal(calls, 0); assert.equal(sent.length, 0);
  assert.throws(() => runtime.proxy.send({ group_id: group }, '禁止此发送'), /禁止/);
  const ordinary = store.get(); ordinary.monitor.groups = []; await store.update(ordinary, ordinary.revision); runtime.apply();
  await runtime.handler({ ...event, message_id: 2 }); assert.equal(calls, 1); assert.equal(sent.length, 1); runtime.stop();
}));

test('旧配置自动迁移监测默认关闭，保留原有主人和群配置', () => fixture(async root => {
  const config = defaults({ OWNER_QQ: '100000001', ALLOWED_GROUPS: group }); delete config.monitor;
  await writeFile(new URL('settings.json', root), JSON.stringify(config));
  const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
  assert.equal(store.get().monitor.enabled, false); assert.deepEqual(store.get().monitor.groups, []); assert.equal(store.get().bot.ownerQQ, '100000001'); assert.equal(store.get().groups[0].id, group);
}));

test('整理模板独立于聊天场景，补充要求进入同一次模型请求，本地报告保留完整依据', () => fixture(async root => {
  const config=defaults({});Object.assign(config.monitor,{enabled:true,groups:[group],notify:true,recipientQQ:'100000009',template:'work',templatePrompt:'行动项按负责人归类',outputFormat:'detailed'});
  config.groups.push({id:group,name:'项目群',template:'gaming',templatePrompt:''});
  const sends=[];let calls=0;
  const monitor=new NoticeMonitor({settings:()=>config,root,exporter:{export:async()=>({...exported(),messages:[...exported().messages,{id:'3',timestamp:'09:35',sender:{uin:'100000004'},content:{text:'补充：请带新版本材料'}}]})},
    ai:async(question,context)=>{calls++;assert.equal(context.groupTemplate.selected,'gaming');assert.equal(context.noticeTemplate.selected,'work');assert.equal(context.noticeTemplate.customPrompt,'行动项按负责人归类');assert.match(context.noticeTemplate.format,/负责人/);assert.match(question,/noticeTemplate/);return JSON.stringify({items:[{title:'评审材料',summary:'行动：提交评审材料',priority:'important',deadlineText:'',sources:['m1','m2']}]});},send:async(_target,text)=>sends.push(text)});
  await monitor.run();assert.equal(calls,1);const report=(await monitor.reports())[0];assert.equal(report.template,'work');assert.equal(report.outputFormat,'detailed');assert.deepEqual(sends,[]);assert.equal(report.items[0].sources.length,2);assert.equal(report.items[0].sources[1].time,'09:35');
}));

test('在途更换整理模板丢弃旧结果，避免用新设置推送旧报告',()=>fixture(async root=>{
  const config=defaults({});Object.assign(config.monitor,{enabled:true,groups:[group],notify:true,recipientQQ:'100000009'});
  const monitor=new NoticeMonitor({settings:()=>config,root,exporter:{export:async()=>exported()},ai:async()=>{config.monitor.template='work';return result();},send:async()=>assert.fail('不得发送旧结果')});
  assert.equal((await monitor.run()).results[0].status,'cancelled');assert.deepEqual(await monitor.reports(),[]);
}));

test('旧版本通知字段无损补齐，严格拒绝无效筛选和输出格式',()=>{
  const config=defaults({});for(const key of ['includeKeywords','excludeKeywords','senderQQs','minPriority','outputFormat'])delete config.realtime[key];
  for(const key of ['template','templatePrompt','outputFormat'])delete config.monitor[key];
  const migrated=validateSettings(config);assert.equal(migrated.realtime.includeKeywords,'');assert.equal(migrated.realtime.minPriority,'important');assert.equal(migrated.realtime.outputFormat,'detailed');assert.equal(migrated.monitor.template,'inherit');assert.equal(migrated.monitor.outputFormat,'concise');assert.equal(config.monitor.template,undefined);
  for(const [section,key,value] of [['realtime','senderQQs','not-a-qq'],['realtime','includeKeywords','x'.repeat(81)],['realtime','minPriority','all'],['monitor','template','unknown'],['monitor','outputFormat','html']]){
    const invalid=structuredClone(migrated);invalid[section][key]=value;assert.throws(()=>validateSettings(invalid),new RegExp(section+'\\.'+key));
  }
});
