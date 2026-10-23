import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeNotices } from '../src/realtime-notices.mjs';
import { qqPlainText } from '../src/qq-output.mjs';
import { OneBot } from '../src/onebot.mjs';

const event = { message_type: 'group', group_id: '12', accountId: 'a', user_id: '2', self_id: '3', message_id: '1', message: [{type:'text',data:{text:'考试安排：明天交作业'}}] };
const important = JSON.stringify({items:[{title:'作业',summary:'明天提交',priority:'important',deadlineText:'明天',sources:['m1']}]});
function setup(ai = async () => important) {
  let now = 10000;
  const config = {realtime:{enabled:true,groups:['12'],recipientQQ:'10001',accountId:'a',debounceSeconds:1,focus:'考试作业'}};
  const records=[]; const monitor = new RealtimeNotices({settings:()=>config,ai,record:async batch=>records.push(batch),send:()=>assert.fail('不可发送 QQ'),now:()=>now});
  return {config,monitor,records,advance:()=>now+=61000};
}
test('共享群规则跨账号生效，仅本地记录并去重，空群不处理', async()=>{
  const x=setup(); x.config.realtime.recipientQQ=''; x.monitor.observe({...event,accountId:'b'}); assert.equal(x.monitor.status().pending,1);
  x.monitor.observe(event); x.monitor.observe(event); assert.equal(x.monitor.status().pending,1);
  await x.monitor.flush(); x.monitor.observe(event); assert.equal(x.monitor.status().pending,0);
  assert.equal(x.records.length,1); assert.deepEqual(x.records[0].accountIds,['b']); assert.match(x.records[0].items[0].sources[0].excerpt,/考试安排/);
  const quiet=setup(async()=>'{"items":[]}'); quiet.monitor.observe(event); await quiet.monitor.flush(); assert.equal(quiet.records.length,0);
  quiet.config.realtime.groups=[];quiet.monitor.observe({...event,message_id:'2'});assert.equal(quiet.monitor.status().pending,0);
});
test('关闭或更改来源规则使排队或正在分析的旧通知失效', async()=>{
  const x=setup(); x.monitor.observe(event); x.config.realtime.enabled=false; await x.monitor.flush(); assert.equal(x.monitor.status().pending,0);
  let release; const y=setup(()=>new Promise(resolve=>release=resolve)); y.monitor.observe(event); const work=y.monitor.flush(); y.config.realtime.groups=[]; release(important); await work; assert.equal(y.records.length,0);
});
test('本地保存失败有限重试，防止重复循环和阻塞', async()=>{
  const x=setup(); let calls=0; x.monitor.record=async()=>{calls++;throw Error('offline');}; x.monitor.observe(event);
  await x.monitor.flush(); await x.monitor.flush(); assert.equal(calls,1);
  x.advance(); await x.monitor.tick(); x.advance(); await x.monitor.tick(); assert.equal(calls,3); assert.equal(x.monitor.status().pending,0);
});
test('关键词与发送人先筛选再调用模型，包含词任一命中、排除优先且空白不限', async()=>{
  let calls=0; const x=setup(async()=>{calls++;return important;});
  Object.assign(x.config.realtime,{includeKeywords:'选课，考试',excludeKeywords:'转发\n广告',senderQQs:'2, 4'});
  x.monitor.observe({...event,user_id:'5'});
  x.monitor.observe({...event,message_id:'2',message:'本周游戏活动'});
  x.monitor.observe({...event,message_id:'3',message:'转发：考试安排'});
  assert.equal(x.monitor.status().pending,0); assert.equal(calls,0);
  x.monitor.observe(event); await x.monitor.flush(); assert.equal(calls,1); assert.equal(x.records.length,1);
  Object.assign(x.config.realtime,{includeKeywords:'',excludeKeywords:'',senderQQs:''});
  x.monitor.observe({...event,message_id:'4',user_id:'5'}); await x.monitor.flush(); assert.equal(calls,2);
});
test('旧的推送级别不再丢弃本地通知；在途修改筛选使旧结果失效', async()=>{
  const x=setup(); x.config.realtime.minPriority='urgent'; x.monitor.observe(event); await x.monitor.flush(); assert.equal(x.records.length,1);
  let release; const z=setup(()=>new Promise(resolve=>release=resolve)); z.monitor.observe(event); const work=z.monitor.flush(); z.config.realtime.excludeKeywords='考试'; release(important);
  assert.equal((await work).status,'cancelled'); assert.equal(z.records.length,0); await z.monitor.flush(); assert.equal(z.monitor.status().pending,0);
});
test('不同群分别调用模型并分别保存，已保存的群不会因另一群失败重复处理',async()=>{
  const contexts=[],x=setup(async(_question,context)=>{contexts.push(context);assert.equal(context.samples.length,1);return important;});x.config.realtime.groups=['12','34'];
  x.monitor.observe(event);x.monitor.observe({...event,group_id:'34',message:'明天考试'});let failed=true;
  x.monitor.record=async batch=>{if(batch.groupId==='34'&&failed){failed=false;throw Error('disk');}x.records.push(batch);};
  assert.equal((await x.monitor.flush()).status,'failed');assert.equal(x.records.length,1);assert.equal(x.monitor.status().pending,1);x.advance();await x.monitor.tick();
  assert.deepEqual(x.records.map(row=>row.groupId),['12','34']);assert.deepEqual(contexts.map(row=>row.sourceGroup),['12','34','34']);assert.ok(contexts.every(context=>context.samples.every(sample=>!Object.hasOwn(sample,'groupId'))));
});
test('QQ 输出去除 Markdown 并保留链接、代码和纯文本 CQ 字符串',async()=>{
  assert.equal(qqPlainText('# 标题\n**重点** [官网](https://example.com)\n```js\nlet a = 1;\n```'), '标题\n重点 官网（https://example.com）\nlet a = 1;');
  const bot=new OneBot('ws://127.0.0.1:3001','',()=>{}); const calls=[]; bot.call=async(a,p)=>calls.push(p);
  await bot.send({user_id:'1'},'[CQ:face,id=14]'); assert.equal(calls[0].message[0].type,'text');
  await assert.rejects(()=>bot.sendSegments({user_id:'1'},[{type:'image',data:{file:'file:///secret'}}]));
});
