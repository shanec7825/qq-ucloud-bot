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
  const sends=[]; const monitor = new RealtimeNotices({settings:()=>config,ai,send:async (...args)=>sends.push(args),now:()=>now});
  return {config,monitor,sends,advance:()=>now+=61000};
}
test('实时通知独立选群与账号、去重，忽略普通消息并保留原文依据', async()=>{
  const x=setup(); x.monitor.observe({...event,accountId:'b'}); assert.equal(x.monitor.status().pending,0);
  x.monitor.observe(event); x.monitor.observe(event); assert.equal(x.monitor.status().pending,1);
  await x.monitor.flush(); x.monitor.observe(event); assert.equal(x.monitor.status().pending,0);
  assert.equal(x.sends.length,1); assert.equal(x.sends[0][0].accountId,'a'); assert.match(x.sends[0][1],/依据：考试安排/);
  const quiet=setup(async()=>'{"items":[]}'); quiet.monitor.observe(event); await quiet.monitor.flush(); assert.equal(quiet.sends.length,0);
});
test('关闭或更换接收人使排队或正在分析的旧通知失效', async()=>{
  const x=setup(); x.monitor.observe(event); x.config.realtime.enabled=false; await x.monitor.flush(); assert.equal(x.monitor.status().pending,0);
  let release; const y=setup(()=>new Promise(resolve=>release=resolve)); y.monitor.observe(event); const work=y.monitor.flush(); y.config.realtime.recipientQQ='20002'; release(important); await work; assert.equal(y.sends.length,0);
});
test('发送失败有限重试，防止重复循环和阻塞', async()=>{
  const x=setup(); let calls=0; x.monitor.send=async()=>{calls++;throw Error('offline');}; x.monitor.observe(event);
  await x.monitor.flush(); await x.monitor.flush(); assert.equal(calls,1);
  x.advance(); await x.monitor.tick(); x.advance(); await x.monitor.tick(); assert.equal(calls,3); assert.equal(x.monitor.status().pending,0);
});
test('QQ 输出去除 Markdown 并保留链接、代码和纯文本 CQ 字符串',async()=>{
  assert.equal(qqPlainText('# 标题\n**重点** [官网](https://example.com)\n```js\nlet a = 1;\n```'), '标题\n重点 官网（https://example.com）\nlet a = 1;');
  const bot=new OneBot('ws://127.0.0.1:3001','',()=>{}); const calls=[]; bot.call=async(a,p)=>calls.push(p);
  await bot.send({user_id:'1'},'[CQ:face,id=14]'); assert.equal(calls[0].message[0].type,'text');
  await assert.rejects(()=>bot.sendSegments({user_id:'1'},[{type:'image',data:{file:'file:///secret'}}]));
});
