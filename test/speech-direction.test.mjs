import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaults, validateSettings, SettingsStore } from '../src/settings.mjs';
import { XiaomiSpeech } from '../src/xiaomi-speech.mjs';
import { SPEECH_DEFAULTS } from '../napcat-plugin/speech-config.mjs';
import { speechStyle, speechDirection, speechContext, planSpeechStyle } from '../src/speech-direction.mjs';
import { mediaCommand, mediaReply } from '../src/media-replies.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';

const event={post_type:'message',accountId:'default',message_type:'private',user_id:'20000001',self_id:'10000001',message_id:1,message:[]};
const record={type:'record',data:{file:'fixture'}};
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
function client(config){let request;return {speech:new XiaomiSpeech({settings:()=>({...SPEECH_DEFAULTS,enabled:true,...config}),key:()=> 'tp-fixture',fetcher:async(url,options)=>{request={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}}),request:()=>request};}
const deps=()=>({owner:'99999999',catalog:{list:async()=>[]},persona:async()=>({voice:[]}),speech:{autoStyle:true,voice:'冰糖',baseStyle:'自然，不夸张',synthesize:async()=>record}});
async function delivered(reply) { const parts=[],texts=[];const result=await deliverReply(reply,{target:{},bot:{send:async(_target,text)=>{texts.push(text);return [];},sendSegments:async(_target,[part])=>{parts.push(part);return {};}}});return {...result,parts,texts}; }

test('preset TTS keeps the selected voice and separates fixed and per-message instructions from exact spoken text',async()=>{
  const {speech,request}=client({voice:'茉莉',style:'语速平稳，不要大喊'});
  await speech.synthesize('明天见。','fixture',{style:'轻快期待，句尾轻微上扬，明天加重音'});
  const body=request().body;assert.equal(body.audio.voice,'茉莉');assert.equal(body.model,'mimo-v2.5-tts');
  assert.deepEqual(body.messages.at(-1),{role:'assistant',content:'明天见。'});
  assert.match(body.messages[0].content,/固定表达要求（优先遵守）.*语速平稳/);assert.match(body.messages[0].content,/本条 MiMo TTS 指导.*轻快期待/);assert.ok(!body.messages.at(-1).content.includes('指导'));
});

test('voice design uses the official no-voice audio shape and the current unified identity directive',async()=>{
  const {speech,request}=client({model:'mimo-v2.5-tts-voicedesign',voiceDescription:'旧音色',style:'青年男性，声线温润，节奏从容；普通话，清晰自然'});
  await speech.synthesize('慢慢来，我陪着你。','fixture',{style:'温柔安慰，语速稍慢，句间轻停顿'});
  const body=request().body;assert.deepEqual(body.audio,{format:'wav'});assert.equal(body.model,'mimo-v2.5-tts-voicedesign');
  assert.match(body.messages[0].content,/青年男性，声线温润/);assert.match(body.messages[0].content,/温柔安慰/);
  await assert.rejects(()=>client({model:'mimo-v2.5-tts-voicedesign'}).speech.synthesize('hello'),/音色描述/);
});

test('invalid directions cannot cause networking and unknown speech fields cannot change voice settings or spoken text',async()=>{
  const {speech,request}=client({});
  for(const style of [null,{},'x'.repeat(301),'bad\0instruction'])await assert.rejects(()=>speech.synthesize('原文','fixture',{style}),/指导/);
  assert.equal(request(),undefined);
  const d=deps(),calls=[];d.speech.synthesize=async(...args)=>{calls.push(args);return record;};
  const answer=await mediaReply(JSON.stringify({text:'原文',mediaIds:[],speech:{style:'温柔',voice:'Dean',text:'替换原文'}}),event,d,[],true);
  assert.equal(calls.length,0);await delivered(answer);
  assert.equal(calls[0][0],'原文');assert.deepEqual(calls[0][2],{style:''});assert.equal(answer.text,'原文');
  const unexpected=await mediaReply(JSON.stringify({text:'保留正文',speech:{style:'轻声'},analysis:'INTERNAL_NOT_FOR_QQ'}),event,d,[],true);
  assert.equal(unexpected.text,'保留正文');assert.ok(!unexpected.summary.includes('INTERNAL_NOT_FOR_QQ'));
});

test('one chat-model call supplies both the final response and prosody, without speaking or remembering its directions',async()=>{
  const d=deps(),calls=[],synth=[];d.ai=async(question,context)=>{calls.push({question,context});return JSON.stringify({text:'没关系，休息一下再试。',mediaIds:[],speech:{style:'温柔安慰，语速略慢，休息后停顿'}});};
  d.speech.synthesize=async(...args)=>{synth.push(args);return record;};
  const reply=await routeNatural('用语音回答：今天好累',event,d);
  const result=await delivered(reply);
  assert.equal(calls.length,1);assert.equal(calls[0].context.speechDirection.autoStyle,true);assert.equal(calls[0].context.speechDirection.voice,'冰糖');
  assert.equal(synth[0][0],'没关系，休息一下再试。');assert.equal(synth[0][2].style,'温柔安慰，语速略慢，休息后停顿');
  assert.equal(result.summary,'[语音] 没关系，休息一下再试。');assert.equal(reply.text,'');assert.equal(result.parts[0].type,'record');
  assert.match(taskSystemPrompt(calls[0].context),/同一次输出/);
});

test('prosody and image selection coexist, and disabling automatic prosody preserves normal replies',async()=>{
  const d=deps(),id='a'.repeat(32),synth=[];d.outgoingMedia={list:async()=>[{id,name:'开心',type:'sticker'}],outgoing:async()=>({type:'image',data:{file:'fixture'}})};
  d.speech.synthesize=async(...args)=>{synth.push(args);return record;};d.ai=async()=>JSON.stringify({text:'真不错！',mediaIds:[id],speech:{style:'开心轻快，句尾上扬'}});
  const reply=await routeNatural('用语音回答：通过考试啦',event,d);assert.deepEqual((await delivered(reply)).parts.map(p=>p.type),['image','record']);assert.match(synth[0][2].style,/开心/);
  d.speech.autoStyle=false;const manual=await routeNatural('用语音回答：通过考试啦',event,d);await delivered(manual);assert.equal(synth[1][2].style,'');assert.equal(manual.text,'');
  d.ai=async(_question,context)=>{assert.equal(context.speechDirection,undefined);return '纯文字';};assert.equal(await routeNatural('你好',event,d),'纯文字');
});

test('read-aloud supports an explicit per-message directive and keeps the original content unchanged',async()=>{
  const d=deps(),calls=[];d.speech.plan=async()=>{throw Error('explicit instructions must skip the planner');};d.speech.synthesize=async(...args)=>{calls.push(args);return record;};
  const reply=await mediaCommand('/语音 [轻声、慢一点] 没关系，我在。',event,d);
  const result=await delivered(reply);assert.equal(calls[0][0],'没关系，我在。');assert.equal(calls[0][2].style,'轻声、慢一点');assert.equal(result.summary,'[语音] 没关系，我在。');assert.equal(reply.text,'');
});

test('read-aloud automatic guidance uses a bounded planning call and falls back visibly if planning fails',async()=>{
  const d=deps(),calls=[];d.speech.plan=async text=>{assert.equal(text,'明天见');return '轻快期待，尾音上扬';};d.speech.synthesize=async(...args)=>{calls.push(args);return record;};
  await delivered(await mediaCommand('/语音 明天见',event,d));assert.equal(calls[0][2].style,'轻快期待，尾音上扬');
  d.speech.plan=async()=>{throw Error('no model');};const fallback=await delivered(await mediaCommand('/语音 明天见',event,d));assert.deepEqual(fallback.texts,[]);assert.equal(calls[1][2].style,'');
  const seen=[];const style=await planSpeechStyle('不要改写原文',{direction:{maxChars:500,voice:'Mia',baseStyle:'自然'},conversation:[],ai:async(q,c)=>{seen.push(c);return '{"style":"认真清晰，重点词加重音"}';}});
  assert.match(style,/加重音/);assert.equal(seen[0].text,'不要改写原文');assert.equal(seen[0].mode,'speech-direction');assert.match(taskSystemPrompt(seen[0]),/不改写/);
  await assert.rejects(()=>planSpeechStyle('文字',{direction:{maxChars:500},ai:async()=>'{"style":"轻声","voice":"Dean"}'}),/格式无效/);
});

test('runtime speech planning only reads the current account and conversation, and keeps the resolved persona',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'qq-speech-direction-')),root=pathToFileURL(folder+'/');
  try{
    const store=new SettingsStore(new URL('settings.json',root),{});await store.load();const cfg=store.get();cfg.chat.defaultMode='memory';cfg.speech.enabled=true;cfg.profiles=[{id:'gentle',name:'温柔角色',model:'',systemPrompt:'声音语气温柔，像朋友一样'}];cfg.accounts[0].defaultProfileId='gentle';await store.update(cfg,cfg.revision);
    const runtime=new BotRuntime(store,{get:()=>null},{root});runtime.memory.add(event,'当前会话');runtime.memory.add({...event,accountId:'other'},'OTHER_ACCOUNT_SECRET');runtime.memory.add({...event,user_id:'20000002'},'OTHER_PEER_SECRET');
    let captured;runtime.ai=async(q,c,config)=>{captured={c,config};return '{"style":"温柔地说，稍慢"}';};
    const resolved={...event,profileId:'gentle'};runtime.memory.add(resolved,'本角色会话');const style=await runtime.dependencies(resolved).speech.plan('你好',resolved);
    assert.match(style,/温柔/);assert.match(captured.config.bot.systemPrompt,/像朋友/);assert.ok(JSON.stringify(captured.c).includes('本角色会话'));assert.ok(!JSON.stringify(captured.c).includes('SECRET'));runtime.stop();
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('existing speech config gains automatic guidance without losing saved voice or manual style; UI modes preserve hidden values',async()=>{
  const cfg=defaults({});delete cfg.speech.autoStyle;delete cfg.speech.voiceDescription;cfg.speech.voice='Dean';cfg.speech.style='不要很快';
  const migrated=validateSettings(cfg);assert.equal(migrated.speech.autoStyle,true);assert.equal(migrated.speech.voice,'Dean');assert.equal(migrated.speech.style,'不要很快');assert.equal(cfg.speech.autoStyle,undefined);
  assert.equal(validateSettings({...migrated,speech:{...migrated.speech,enabled:true,model:'mimo-v2.5-tts-voicedesign'}}).speech.style,'不要很快');
  assert.throws(()=>validateSettings({...migrated,speech:{...migrated.speech,enabled:true,style:'',model:'mimo-v2.5-tts-voicedesign'}}),/声音指令|音色描述/);
  const state={settings:migrated};const adapter=createNativeConfigAdapter({bridge:{request:async(method,path,value)=>{if(method==='GET')return {status:200,data:path==='state'?state:path==='memory'?{notes:[],digests:[],conversations:[]}: {items:[],reports:[]}};if(path==='settings')state.settings=validateSettings(value.settings);return {status:200,data:{ok:true}};}}});
  const f=await adapter.getConfig();f.page='speech';let fields=adapter.schema(f);const model=fields.find(f=>f.key.endsWith('__model'));assert.equal(model.reactive,true);assert.equal(fields.some(f=>f.key.endsWith('__voiceDescription')),false);
  f[model.key]='mimo-v2.5-tts-voicedesign';fields=adapter.schema(f);assert.equal(fields.some(f=>f.key.endsWith('__voice')),false);const description=fields.find(f=>f.key.endsWith('__voiceDescription'));f[description.key]='青年男性，声音温润';await adapter.setConfig(f);
  assert.equal(state.settings.speech.voice,'Dean');assert.equal(state.settings.speech.voiceDescription,'青年男性，声音温润');
});

test('the unified directive designs voice, speed and expression without requiring a legacy description',async()=>{
  const directive='温润的青年声线，普通话，语速稍慢，像朋友一样交流';
  const config={...SPEECH_DEFAULTS,enabled:true,model:'mimo-v2.5-tts-voicedesign',style:directive};
  const {speech,request}=client(config);await speech.synthesize('你好。','unified',{style:'句尾轻停顿'});
  assert.deepEqual(request().body.audio,{format:'wav'});assert.match(request().body.messages[0].content,/青年声线/);assert.match(request().body.messages[0].content,/句尾轻停顿/);assert.deepEqual(request().body.messages.at(-1),{role:'assistant',content:'你好。'});
  const direction=speechDirection(config);assert.equal(direction.directive,directive);assert.equal(direction.baseStyle,directive);
});
