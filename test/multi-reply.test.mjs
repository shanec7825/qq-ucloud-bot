import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaReply } from '../src/media-replies.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { XiaomiSpeech } from '../src/xiaomi-speech.mjs';
import { SPEECH_DEFAULTS } from '../napcat-plugin/speech-config.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';

const event={post_type:'message',message_type:'group',group_id:'30000001',user_id:'20000001',self_id:'10000001',message_id:1,message:[{type:'at',data:{qq:'10000001'}},{type:'text',data:{text:'分几条说'}}]};
const at={replyTo:1,mention:'20000001'},target={group_id:'30000001'},id='a'.repeat(32);
const raw=messages=>JSON.stringify({messages});
const base={owner:'99999999',groups:['30000001'],catalog:{list:async()=>[]},persona:async()=>({voice:[]})};
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}

test('one model answer becomes three ordered messages, mentions only once and remembers one logical reply',async()=>{
  const calls=[],memory=new ConversationMemory();let modelCalls=0;
  const bot={send:async(t,text,options)=>{calls.push({t,text,options});return [{message_id:calls.length+10}];}};
  const handler=createMessageHandler({...base,bot,memory,ai:async(_q,c)=>{modelCalls++;assert.equal(c.replyDelivery.maxMessages,4);assert.match(taskSystemPrompt(c),/messages/);return raw([{text:'第一条'},{text:'第二条'},{text:'第三条'}]);}});
  await handler(event);await handler(event);
  assert.equal(modelCalls,1);assert.deepEqual(calls.map(c=>c.text),['第一条','第二条','第三条']);assert.deepEqual(calls[0].options,at);assert.equal(calls[1].options,undefined);assert.equal(calls[2].options,undefined);
  const rows=memory.get(event).filter(row=>row.speaker==='机器人');assert.equal(rows.length,1);assert.equal(rows[0].text,'第一条\n第二条\n第三条');assert.equal(rows[0].messageId,'11');
});

test('text, images and each native voice preserve per-bubble ordering and independent directions',async()=>{
  let requests;const deps={outgoingMedia:{outgoing:async()=>({type:'image',data:{file:'fixture'}})},speech:{autoStyle:true,synthesizeBatch:async rows=>{requests=rows;return rows.map((_row,i)=>({part:{type:'record',data:{file:'voice-'+i}}}));}}};
  const reply=await mediaReply(raw([{text:'先看这张图',mediaIds:[id],speech:{style:'平稳清晰'}},{text:'是不是很有趣',speech:{style:'轻快期待'}}]),event,deps,[{id,name:'示例图'}],true);
  assert.deepEqual(requests,[{text:'先看这张图',style:'平稳清晰'},{text:'是不是很有趣',style:'轻快期待'}]);
  const sends=[],bot={send:async(_t,text)=>{sends.push(text);return [];},sendSegments:async(_t,[part])=>{sends.push(part.type+':'+part.data.file);return {message_id:sends.length};}};
  const delivered=await deliverReply(reply,{bot,target,options:at});
  assert.deepEqual(sends,['先看这张图','image:fixture','record:voice-0','是不是很有趣','record:voice-1']);assert.ok(!delivered.summary.includes('平稳清晰'));assert.match(delivered.summary,/示例图/);
});

test('partial media failure stops later bubbles and never records their unsent content as delivered',async()=>{
  const calls=[],bot={send:async(_t,text)=>{calls.push(text);return [{message_id:calls.length}];},sendSegments:async()=>{throw Error('upload failed');}};
  const response={messages:[{text:'已发送'},{text:'图片说明',segments:[{type:'image'}],summary:'图片说明 [图片：还没发出的图]'},{text:'不应发送'}]};
  const result=await deliverReply(response,{bot,target,options:at});assert.equal(calls.length,3);assert.match(calls.at(-1),/后续消息已停止/);assert.ok(!calls.includes('不应发送'));assert.ok(!result.summary.includes('不应发送'));assert.ok(!result.summary.includes('还没发出的图'));assert.match(result.summary,/媒体发送未完成/);
});

test('revoked permissions between bubbles cancel all remaining sends including notices',async()=>{
  let enabled=true;const sent=[];const bot={send:async(_t,text)=>{sent.push(text);enabled=false;return [{message_id:1}];}};
  const result=await deliverReply({messages:[{text:'第一条'},{text:'第二条'}]},{bot,target,isCurrent:()=>enabled});assert.deepEqual(sent,['第一条']);assert.ok(!result.summary.includes('第二条'));assert.match(result.summary,/后续消息未发送/);
});

test('a second incoming event waits until the first multi-message reply has finished',async()=>{
  let release,begin;const blocked=new Promise(r=>release=r),started=new Promise(r=>begin=r),sent=[],memory=new ConversationMemory();
  const bot={send:async(_t,text)=>{sent.push(text);if(text==='一A'){begin();await blocked;}return [{message_id:sent.length}];}};
  const handler=createMessageHandler({...base,bot,memory,ai:async question=>raw(question.includes('后一个')?[{text:'二A'}]:[{text:'一A'},{text:'一B'}])});
  const first=handler(event);await started;const second=handler({...event,message_id:2,message:[event.message[0],{type:'text',data:{text:'后一个'}}]});await Promise.resolve();assert.deepEqual(sent,['一A']);release();await Promise.all([first,second]);assert.deepEqual(sent,['一A','一B','二A']);
});

test('invalid counts, content, destinations and image IDs fail before any media or voice work',async()=>{
  let work=0;const deps={outgoingMedia:{outgoing:async()=>{work++;}},speech:{synthesizeBatch:async()=>{work++;}}};
  const bad=[[],Array.from({length:5},()=>({text:'a'})),[{text:''}],[{text:'x'.repeat(1501)}],[{text:'a',user_id:'other'}],[{text:'a',mediaIds:['outside']}],[{text:'a',mediaIds:[id]},{text:'b',mediaIds:[id]}]];
  for(const messages of bad)await assert.rejects(()=>mediaReply(raw(messages),event,deps,[{id}],true));assert.equal(work,0);
  assert.equal(await mediaReply('原来的纯文字',event,{},[],false),'原来的纯文字');
});

test('a logical speech batch shares one cooldown reservation and preserves per-message styles',async()=>{
  const bodies=[],config={...SPEECH_DEFAULTS,enabled:true};
  const client=new XiaomiSpeech({settings:()=>config,key:()=> 'tp-fixture',now:()=>10000,fetcher:async(_url,options)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
  const results=await client.synthesizeBatch([{text:'你好',style:'温柔'},{text:'太棒啦',style:'开心'}],'same-turn');assert.equal(results.length,2);assert.ok(results.every(r=>r.part.type==='record'));assert.match(bodies[0].messages[0].content,/温柔/);assert.match(bodies[1].messages[0].content,/开心/);
  await assert.rejects(()=>client.synthesize('另一条','same-turn'),/5 秒/);assert.equal(bodies.length,2);
});

test('speech failure or revocation stops further TTS requests and keeps all text bubbles',async()=>{
  let calls=0;const config={...SPEECH_DEFAULTS,enabled:true};
  const client=new XiaomiSpeech({settings:()=>config,key:()=> 'tp-fixture',fetcher:async()=>{calls++;return new Response(null,{status:429});}});
  const result=await client.synthesizeBatch([{text:'第一条'},{text:'第二条'}]);assert.equal(calls,1);assert.ok(result.every(r=>/429/.test(r.error)));
  const deps={speech:{autoStyle:true,synthesizeBatch:async()=>result}};const reply=await mediaReply(raw([{text:'第一条'},{text:'第二条'}]),event,deps,[],true);assert.match(reply.messages[0].text,/第一条/);assert.match(reply.messages[1].text,/第二条/);assert.match(reply.messages[1].text,/429/);
  let requests=0;const changing={...config};const revoked=new XiaomiSpeech({settings:()=>changing,key:()=> 'tp-fixture',fetcher:async()=>{requests++;changing.enabled=false;return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
  const revokedResults=await revoked.synthesizeBatch([{text:'一'},{text:'二'}]);assert.equal(requests,1);assert.ok(revokedResults[0].part);assert.match(revokedResults[1].error,/已改变/);
});
