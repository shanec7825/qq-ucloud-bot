import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaReply} from '../src/media-replies.mjs';
import {deliverReply} from '../src/reply-delivery.mjs';
import {routeNatural} from '../src/natural-chat.mjs';
import {XiaomiSpeech,SPEECH_DEFAULTS} from '../src/xiaomi-speech.mjs';
import {askAI} from '../src/core.mjs';
import {codexArgs} from '../src/codex-ai.mjs';
import {speechDirection} from '../src/speech-direction.mjs';

const raw=messages=>JSON.stringify({version:2,messages}), id='a'.repeat(32);
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}

test('v2 compiles ordered text/image/speech and never implicitly reads a text item',async()=>{
 const voices=[],sent=[];
 const deps={outgoingMedia:{outgoing:async()=>({type:'image'})},speech:{autoStyle:true,synthesizeBatch:async requests=>{voices.push(...requests);return requests.map(()=>({part:{type:'record'}}));}}};
 const plan=raw([{type:'text',text:'位置发给你啦。'},{type:'image',mediaId:id},{type:'speech',mode:'speak',text:'到啦叫我一声。',style:'轻快'}]);
 const reply=await mediaReply(plan,{},deps,[{id,name:'地图'}],true,{independent:true});
 assert.equal(voices.length,0);
 await deliverReply(reply,{target:{},bot:{send:async(_t,text)=>sent.push(text),sendSegments:async(_t,[part])=>sent.push(part.type)}});
 assert.deepEqual(sent,['位置发给你啦。','image','record']);assert.deepEqual(voices,[{text:'到啦叫我一声。',style:'轻快',mode:'speak'}]);
});

test('v2 rejects invalid fields, destinations, media, versions and unauthorized singing before work',async()=>{
 let work=0;const deps={outgoingMedia:{outgoing:async()=>{work++;}},speech:{synthesize:async()=>{work++;}}};
 const invalid=[raw([{type:'text',text:'正文',user_id:'other'}]),raw([{type:'image',mediaId:'outside'}]),raw([{type:'image',mediaId:id},{type:'image',mediaId:id}]),raw([{type:'speech',mode:'sing',text:'小星光',style:''}]),raw([{type:'speech',mode:'speak',text:'正文',style:'',voice:'other'}]),JSON.stringify({version:3,messages:[{type:'text',text:'正文'}]}),raw([{type:'text',text:'先说'},{type:'image',mediaId:'outside'}])];
 for(const plan of invalid)await assert.rejects(()=>mediaReply(plan,{},deps,[{id}],true),error=>error.code==='REPLY_PLAN_INVALID');
 await assert.rejects(()=>mediaReply(raw([{type:'speech',mode:'speak',text:'正文',style:''}]),{},deps,[],false),/格式/);
 await assert.rejects(()=>mediaReply(JSON.stringify({text:'正文',speech:{text:'歌曲',mode:'sing'}}),{},deps,[],true,{allowSinging:true}),/格式/);
 assert.equal(work,0);
});

test('an unknown JSON envelope cannot leak internal metadata through the legacy prose fallback',async()=>{
 await assert.rejects(()=>mediaReply('{"analysis":"private metadata","answer":"hello"}',{},{},[],false,{expectStructured:true}),error=>error.code==='REPLY_PLAN_INVALID');
 assert.equal(await mediaReply('旧版普通文字',{},{},[],false,{expectStructured:true}),'旧版普通文字');
});

test('singing temporarily selects a preset; the following spoken request still uses the clone',async()=>{
 const config={...SPEECH_DEFAULTS,enabled:true,model:'mimo-v2.5-tts-voiceclone',referenceAudio:'fixture',style:'固定克隆身份'};
 const original=JSON.stringify(config),bodies=[];
 const speech=new XiaomiSpeech({settings:()=>config,key:()=> 'tp-fixture',referenceAudio:async()=> 'data:audio/wav;base64,'+wav().toString('base64'),fetcher:async(_url,options)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
 const results=await speech.synthesizeBatch([{text:'小小星光，照着回家的方向。',style:'轻快清唱',mode:'sing'},{text:'早点休息。',style:'温柔',mode:'speak'}]);
 assert.ok(results.every(result=>result.part));assert.equal(JSON.stringify(config),original);
 const song=bodies.find(body=>body.model==='mimo-v2.5-tts'),spoken=bodies.find(body=>body.model==='mimo-v2.5-tts-voiceclone');
 assert.ok(song);assert.ok(spoken);assert.match(song.messages.at(-1).content,/^\(唱歌\)/);assert.equal(song.audio.voice,'冰糖');assert.ok(!song.messages[0]?.content.includes('固定克隆身份'));assert.match(spoken.audio.voice,/^data:audio/);
 const capabilities=speechDirection(config);assert.equal(capabilities.supportsSinging,true);assert.equal(capabilities.singingChangesVoice,true);
});

test('host grants singing only for the requested turn and does at most one protocol repair',async()=>{
 const event={message_type:'private',user_id:'20000001'};let calls=0;
 const deps={owner:'20000001',catalog:{list:async()=>[]},speech:{autoReply:true,model:'mimo-v2.5-tts-voiceclone',supportsSinging:true,singingVoice:'冰糖',singingChangesVoice:true,synthesize:async()=>({type:'record'})},ai:async(_q,context)=>{
  calls++;assert.equal(context.replyProtocol.version,2);assert.equal(context.speechDirection.singingAllowed,true);
  if(calls===1)return raw([{type:'image',mediaId:'unavailable'}]);
  assert.equal(context.replyRepair,true);return raw([{type:'speech',mode:'sing',text:'星光轻轻亮，晚风慢慢唱。',style:''}]);
 }};
 const reply=await routeNatural('请唱一段原创短歌',event,deps);assert.equal(calls,2);assert.equal(reply.messages.length,1);
 let failures=0;deps.ai=async()=>{failures++;return raw([{type:'unknown'}]);};
 await assert.rejects(()=>routeNatural('你好',event,deps),/格式/);assert.equal(failures,2);
});

test('MiMo enables native JSON mode and Codex uses the bundled output schema',async()=>{
 let request;
 await askAI('你好',{mode:'conversation',replyProtocol:{version:2}},{OPENAI_API_KEY:'tp-fixture',OPENAI_MODEL:'mimo-v2.6-pro',OPENAI_BASE_URL:'https://token-plan-cn.xiaomimimo.com/v1',AI_BACKEND:'mimo-token-plan-cn'},async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:raw([{type:'text',text:'你好'}])}}]}));});
 assert.deepEqual(request.response_format,{type:'json_object'});
 const args=codexArgs('gpt-6-luna',[],true);assert.ok(args.includes('--output-schema'));assert.match(args[args.indexOf('--output-schema')+1],/reply-plan\.schema\.json$/);
});
