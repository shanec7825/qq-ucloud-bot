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
  const handler=createMessageHandler({...base,bot,memory,ai:async(_q,c)=>{modelCalls++;assert.equal(c.replyDelivery.maxMessages,8);assert.match(taskSystemPrompt(c),/messages/);return raw([{text:'第一条'},{text:'第二条'},{text:'第三条'}]);}});
  await handler(event);await handler(event);
  assert.equal(modelCalls,1);assert.deepEqual(calls.map(c=>c.text),['第一条','第二条','第三条']);assert.deepEqual(calls[0].options,at);assert.equal(calls[1].options,undefined);assert.equal(calls[2].options,undefined);
  const rows=memory.get(event).filter(row=>row.speaker==='机器人');assert.equal(rows.length,1);assert.equal(rows[0].text,'第一条\n第二条\n第三条');assert.equal(rows[0].messageId,'11');
});

test('text, images and each native voice preserve per-bubble ordering and independent directions',async()=>{
  let requests;const deps={outgoingMedia:{outgoing:async()=>({type:'image',data:{file:'fixture'}})},speech:{autoStyle:true,synthesizeBatch:async rows=>{requests=rows;return rows.map((_row,i)=>({part:{type:'record',data:{file:'voice-'+i}}}));}}};
  const reply=await mediaReply(raw([{text:'先看这张图',mediaIds:[id],speech:{style:'平稳清晰'}},{text:'是不是很有趣',speech:{style:'轻快期待'}}]),event,deps,[{id,name:'示例图'}],true);
  assert.equal(requests,undefined,'speech is deferred until the first text/media receipt');
  const sends=[],bot={send:async(_t,text)=>{sends.push(text);return [];},sendSegments:async(_t,[part])=>{sends.push(part.type+':'+part.data.file);return {message_id:sends.length};}};
  const delivered=await deliverReply(reply,{bot,target,options:at});
  assert.deepEqual(requests,[{text:'先看这张图',style:'平稳清晰'},{text:'是不是很有趣',style:'轻快期待'}]);
  assert.deepEqual(sends,['先看这张图','image:fixture','record:voice-0','是不是很有趣','record:voice-1']);assert.ok(!delivered.summary.includes('平稳清晰'));assert.match(delivered.summary,/示例图/);
});

test('partial media failure stops later bubbles and never records their unsent content as delivered',async()=>{
  const calls=[],bot={send:async(_t,text)=>{calls.push(text);return [{message_id:calls.length}];},sendSegments:async()=>{throw Error('upload failed');}};
  const response={messages:[{text:'已发送'},{text:'图片说明',segments:[{type:'image'}],summary:'图片说明 [图片：还没发出的图]'},{text:'不应发送'}]};
  const result=await deliverReply(response,{bot,target,options:at});assert.deepEqual(calls,['已发送','图片说明']);assert.ok(!calls.includes('不应发送'));assert.ok(!result.summary.includes('不应发送'));assert.ok(!result.summary.includes('还没发出的图'));assert.match(result.summary,/媒体发送未完成/);
});

test('revoked permissions between bubbles cancel all remaining sends including notices',async()=>{
  let enabled=true;const sent=[];const bot={send:async(_t,text)=>{sent.push(text);enabled=false;return [{message_id:1}];}};
  const result=await deliverReply({messages:[{text:'第一条'},{text:'第二条'}]},{bot,target,isCurrent:()=>enabled});assert.deepEqual(sent,['第一条']);assert.ok(!result.summary.includes('第二条'));assert.match(result.summary,/后续消息未发送/);
});

test('a same-sender follow-up waits for an in-flight receipt and stops the old unsent tail',async()=>{
  let release,begin;const blocked=new Promise(r=>release=r),started=new Promise(r=>begin=r),sent=[],memory=new ConversationMemory();
  const bot={send:async(_t,text)=>{sent.push(text);if(text==='一A'){begin();await blocked;}return [{message_id:sent.length}];}};
  const handler=createMessageHandler({...base,bot,memory,ai:async question=>raw(question.includes('后一个')?[{text:'二A'}]:[{text:'一A'},{text:'一B'}])});
  const first=handler(event);await started;const second=handler({...event,message_id:2,message:[event.message[0],{type:'text',data:{text:'后一个'}}]});await Promise.resolve();assert.deepEqual(sent,['一A']);release();await Promise.all([first,second]);assert.deepEqual(sent,['一A','二A']);assert.ok(!memory.get(event).some(row=>row.text.includes('一B')));
});

test('invalid counts, content, destinations and image IDs fail before any media or voice work',async()=>{
  let work=0;const deps={outgoingMedia:{outgoing:async()=>{work++;}},speech:{synthesizeBatch:async()=>{work++;}}};
  const bad=[[],Array.from({length:9},()=>({text:'a'})),Array.from({length:5},()=>({text:'x'.repeat(1500)})),[{text:''}],[{text:'x'.repeat(1501)}],[{text:'a',user_id:'other'}],[{text:'a',mediaIds:['outside']}],[{text:'a',mediaIds:[id]},{text:'b',mediaIds:[id]}]];
  for(const messages of bad)await assert.rejects(()=>mediaReply(raw(messages),event,deps,[{id}],true));assert.equal(work,0);
  assert.equal(await mediaReply('原来的纯文字',event,{},[],false),'原来的纯文字');
});

test('text is delivered before TTS starts and the first audio never waits for the entire batch',async()=>{
  const stages=[],resolvers=[];
  const client=new XiaomiSpeech({settings:()=>({...SPEECH_DEFAULTS,enabled:true}),key:()=> 'tp-fixture',fetcher:async()=>{stages.push('tts-start');await new Promise(resolve=>resolvers.push(resolve));return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
  const reply=await mediaReply(raw([{text:'先看文字'},{text:'第二条'}]),event,{speech:{synthesizeBatch:(rows,_event,options)=>client.synthesizeBatch(rows,'turn',options)}},[],true);
  assert.deepEqual(stages,[]);
  const delivery=deliverReply(reply,{target,bot:{send:async(_target,text)=>{stages.push(text);return [];},sendSegments:async()=>{stages.push('voice');return {};}}});
  while(resolvers.length<2)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stages[0],'先看文字');assert.ok(!stages.includes('voice'));
  resolvers[0]();
  while(!stages.includes('voice'))await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(stages.filter(value=>value!=='tts-start'),['先看文字','voice','第二条']);
  resolvers[1]();await delivery;
  assert.deepEqual(stages.filter(value=>value!=='tts-start'),['先看文字','voice','第二条','voice']);
});

test('revocation during synthesis suppresses audio, later text and successful speech memory',async()=>{
  let finish,started,enabled=true;const ready=new Promise(resolve=>started=resolve),sent=[];
  const reply=await mediaReply(raw([{text:'已经发出的文字',speech:{text:'不可记成成功的语音'}},{text:'撤销后不能发'}]),event,{speech:{synthesize:async()=>{started();await new Promise(resolve=>finish=resolve);return {type:'record',data:{file:'voice'}};}}},[],true);
  const delivery=deliverReply(reply,{target,isCurrent:()=>enabled,bot:{send:async(_target,text)=>{sent.push(text);return [];},sendSegments:async()=>{sent.push('voice');return {};}}});
  await ready;enabled=false;finish();const result=await delivery;
  assert.deepEqual(sent,['已经发出的文字']);assert.ok(!result.summary.includes('不可记成成功'));assert.ok(!result.summary.includes('撤销后不能发'));assert.match(result.summary,/未发送|未完成/);
});

test('eight bubbles are supported while aggregate text and speech stay bounded',async()=>{
  const reply=await mediaReply(raw(Array.from({length:8},(_,index)=>({text:'第'+index+'条'}))),event,{},[],false);
  const sent=[];await deliverReply(reply,{target,bot:{send:async(_target,text)=>{sent.push(text);return [];}}});assert.equal(sent.length,8);
  let calls=0;await assert.rejects(()=>mediaReply(raw(Array.from({length:8},()=>({text:'短文',speech:{text:'话'.repeat(501)}}))),event,{speech:{maxChars:1000,synthesize:async()=>{calls++;}}},[],true),/整轮|总/);assert.equal(calls,0);
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
  const result=await client.synthesizeBatch([{text:'第一条'},{text:'第二条'},{text:'第三条'}]);assert.equal(calls,2,'only the two in-flight requests may finish; failed work is never retried');assert.ok(result.every(r=>/429/.test(r.error)));
  const deps={speech:{autoStyle:true,synthesizeBatch:async()=>result}};const reply=await mediaReply(raw([{text:'第一条'},{text:'第二条'}]),event,deps,[],true);const sent=[];const delivered=await deliverReply(reply,{target,bot:{send:async(_target,text)=>{sent.push(text);return [];}}});assert.deepEqual(sent,['第一条','第二条']);assert.ok(!delivered.summary.includes('429'));
  let requests=0;const changing={...config};const revoked=new XiaomiSpeech({settings:()=>changing,key:()=> 'tp-fixture',fetcher:async()=>{requests++;changing.enabled=false;return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
  const revokedResults=await revoked.synthesizeBatch([{text:'一'},{text:'二'}]);assert.equal(requests,1);assert.ok(revokedResults.every(row=>!row.part));assert.match(revokedResults[0].error,/已改变/);assert.match(revokedResults[1].error,/已改变/);
});

test('TTS concurrency is limited across batches, callbacks are indexed and each item is attempted once',async()=>{
  let active=0,peak=0;const attempts=[],completed=[];
  const client=new XiaomiSpeech({settings:()=>({...SPEECH_DEFAULTS,enabled:true}),key:()=> 'tp-fixture',fetcher:async(_url,options)=>{
    const text=JSON.parse(options.body).messages.at(-1).content;attempts.push(text);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,text==='a'?20:2));active--;
    return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));
  }});
  const [first,second]=await Promise.all([client.synthesizeBatch([{text:'a'},{text:'b'},{text:'c'}],'first',{onResult:(_result,index)=>completed.push(index)}),client.synthesizeBatch([{text:'d'},{text:'e'}],'second')]);
  assert.equal(peak,2);assert.deepEqual([...attempts].sort(),['a','b','c','d','e']);assert.equal(completed[0],1);assert.deepEqual([...completed].sort(),[0,1,2]);assert.ok([...first,...second].every(result=>result.part));assert.equal(client.active,0);assert.equal(client.requests,0);
});

test('failed initial text sends never start deferred synthesis or repeat the planned content',async()=>{
  let synthesis=0;const reply=await mediaReply(JSON.stringify({text:'不能重复的正文',speech:{text:'不能发送的语音'}}),event,{speech:{synthesize:async()=>{synthesis++;return {type:'record'};}}},[],true);
  const sent=[];const result=await deliverReply(reply,{target,bot:{send:async(_target,text)=>{sent.push(text);if(sent.length===1)throw Error('send failed');return [];}}});
  assert.equal(synthesis,0);assert.deepEqual(sent,['不能重复的正文']);assert.ok(!result.summary.includes('不能发送的语音'));
});
