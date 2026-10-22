import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { OutgoingMedia, IMAGE_LIMIT } from '../src/outgoing-media.mjs';
import { XiaomiSpeech, SPEECH_DEFAULTS } from '../src/xiaomi-speech.mjs';
import { OneBot } from '../src/onebot.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { ConversationMemory } from '../src/persona.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';
import { SettingsStore, defaults, validateSettings } from '../src/settings.mjs';
import { SecretVault } from '../src/secret-vault.mjs';
import { startAdmin } from '../src/admin-server.mjs';
import { AdminBridge, allowedRoute } from '../napcat-plugin/bridge.mjs';
import { createNativeConfigAdapter } from '../napcat-plugin/native-config.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';

const png = await createCanvas(4, 4).encode('png');
const event = { post_type: 'message', message_type: 'private', accountId: 'default', self_id: '10000001', user_id: '20000001', message_id: '1', message: [] };
const upload = (overrides = {}) => ({ accountId:'default', kind:'private', targetId:'20000001', type:'sticker', name:'开心', base64:png.toString('base64'), ...overrides });
async function sandbox(work) { const folder = await mkdtemp(join(tmpdir(),'qq-outgoing-')); const root = pathToFileURL(folder + '/'); try { return await work(root); } finally { await rm(folder,{recursive:true,force:true}); } }
function wav() { const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(24000,24); bytes.writeUInt32LE(48000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(4,40); return bytes; }
const speech = (extra = {}) => new XiaomiSpeech({ settings:()=>({...SPEECH_DEFAULTS,enabled:true}), key:()=> 'tp-fixture', fetcher:async()=>new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]})), ...extra });

test('uploaded media persists across restart, keeps GIF bytes and isolates equal peers across accounts', () => sandbox(async root => {
  const library = new OutgoingMedia(root), item = await library.put(upload());
  const restarted = new OutgoingMedia(root);
  assert.equal((await restarted.available(event))[0].id, item.id);
  assert.equal((await restarted.available({...event,accountId:'other'})).length,0);
  await assert.rejects(()=>restarted.outgoing({...event,user_id:'20000002'},item.id),/当前账号或会话/);
  const part = await restarted.outgoing(event,item.id);
  assert.equal(part.type,'image'); assert.equal(part.data.file,'base64://'+png.toString('base64')); assert.equal(part.data.sub_type,1);
  // A real one-pixel GIF remains byte-for-byte intact, including animation-capable format.
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const shared=await library.put(upload({kind:'account',targetId:'',type:'image',base64:gif.toString('base64')}));
  assert.deepEqual((await library.bytes(shared.id)).bytes,gif);
  assert.equal((await library.available({...event,user_id:'20000002'})).length,1);
  await library.remove(item.id); assert.equal((await library.list()).length,1);
  await assert.rejects(()=>library.bytes(item.id),/不存在/);
}));

test('library rejects SVG, fake files, excessive size, path IDs and corrupted stored bytes', () => sandbox(async root => {
  const library=new OutgoingMedia(root);
  for(const base64 of [Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),'!!!!',Buffer.alloc(IMAGE_LIMIT+1).toString('base64')]) await assert.rejects(()=>library.put(upload({base64})));
  await assert.rejects(()=>library.put(upload({targetId:'../secret'})));
  await assert.rejects(()=>library.bytes('../../settings.json'));
  const item=await library.put(upload());await writeFile(new URL(item.id,library.root),Buffer.concat([png,Buffer.from('changed')]));
  await assert.rejects(()=>library.outgoing(event,item.id),/已改变/);
}));

test('QQ collection downloads current images persistently and refuses cross-conversation quotes', () => sandbox(async root => {
  let downloads=0;
  const library=new OutgoingMedia(root,async()=>{downloads++;return png;});
  const quoted={...event,message:[{type:'reply',data:{id:'42'}}]};
  await assert.rejects(()=>library.collect(quoted,{name:'开心',type:'sticker'},{call:async()=>({...event,user_id:'20000002',message:[{type:'image',data:{url:'https://gchat.qpic.cn/a'}}]})}),/当前会话/);
  assert.equal(downloads,0);
  const item=await library.collect(quoted,{name:'开心',type:'sticker'},{call:async()=>({...event,message:[{type:'image',data:{url:'https://gchat.qpic.cn/a'}}]})});
  assert.equal(item.scope,'default:private:20000001'); assert.equal(downloads,1);
}));

test('MiMo API and China Token Plan endpoints synthesize with matching keys, selectable voice and style', async () => {
  for(const [baseURL,key] of [['https://api.xiaomimimo.com/v1','sk-fixture'],[SPEECH_DEFAULTS.baseURL,'tp-fixture']]){
    let request;
    const client=speech({settings:()=>({...SPEECH_DEFAULTS,enabled:true,baseURL,voice:'Mia',style:'Speak warmly'}),key:()=>key,fetcher:async(url,options)=>{request={url,...options};return new Response(JSON.stringify({choices:[{message:{audio:{data:wav().toString('base64')}}}]}));}});
    const part=await client.synthesize('Hello');assert.equal(part.type,'record');assert.equal(part.data.file,'base64://'+wav().toString('base64'));
    assert.equal(request.url,baseURL+'/chat/completions');assert.equal(request.redirect,'error');
    const body=JSON.parse(request.body);assert.equal(body.messages.at(-1).role,'assistant');assert.equal(body.messages.at(-1).content,'Hello');assert.equal(body.audio.voice,'Mia');assert.equal(body.audio.format,'wav');assert.match(body.messages[0].content,/Speak warmly/);
    await assert.rejects(()=>client.synthesize('Again'),/5 秒/);
  }
});

test('speech rejects missing key, mismatched endpoint, disabled mode, oversize text and malformed service responses', async () => {
  let requests=0; const fetcher=async()=>{requests++;throw Error('unexpected');};
  await assert.rejects(()=>speech({key:()=>'',fetcher}).synthesize('hello'),/Key/);
  await assert.rejects(()=>speech({key:()=> 'invalid-key',fetcher}).synthesize('hello'),/sk-|tp-|ttp-/);
  await assert.rejects(()=>speech({settings:()=>({...SPEECH_DEFAULTS,enabled:false}),fetcher}).synthesize('hello'),/未启用/);
  await assert.rejects(()=>speech({settings:()=>({...SPEECH_DEFAULTS,enabled:true,baseURL:'https://evil.test'}),fetcher}).synthesize('hello'),/官方/);
  await assert.rejects(()=>speech({settings:()=>({...SPEECH_DEFAULTS,enabled:true,baseURL:'https://evil.test'}),fetcher}).synthesize('hello'),/官方/);
  await assert.rejects(()=>speech({settings:()=>({...SPEECH_DEFAULTS,enabled:true,baseURL:'https://api.xiaomimimo.com/v1'}),fetcher}).synthesize('hello'),/不匹配/);
  await assert.rejects(()=>speech({fetcher}).synthesize('x'.repeat(501)),/500/);assert.equal(requests,0);
  await assert.rejects(()=>speech({fetcher:async()=>new Response('secret-should-not-leak',{status:401})}).synthesize('hello'),error=>/401/.test(error.message)&&!error.message.includes('secret-should-not-leak'));
  await assert.rejects(()=>speech({fetcher:async()=>new Response(JSON.stringify({choices:[{message:{audio:{data:png.toString('base64')}}}]}))}).synthesize('hello'),/WAV/);
});

test('OneBot sends native record alone and validates uploaded images without parsing text as CQ',async()=>{
  const bot=new OneBot('ws://127.0.0.1:3001','',()=>{}),calls=[];bot.call=async(...args)=>{calls.push(args);return {message_id:42};};
  await bot.sendSegments({user_id:event.user_id},[{type:'record',data:{file:'base64://'+wav().toString('base64')}}]);
  assert.equal(calls[0][0],'send_private_msg');assert.equal(calls[0][1].message[0].type,'record');assert.equal(calls[0][1].message.length,1);
  await bot.sendSegments({group_id:'30000001'},[{type:'image',data:{file:'base64://'+png.toString('base64'),sub_type:1}},{type:'text',data:{text:'[CQ:record,file=secret]'}}],{replyTo:'1',mention:event.user_id});
  assert.deepEqual(calls[1][1].message.map(p=>p.type),['reply','at','image','text']);
  for(const file of ['file:///C:/secret','https://evil.test/audio.wav','base64://'+png.toString('base64')])await assert.rejects(()=>bot.sendSegments({user_id:event.user_id},[{type:'record',data:{file}}]));
  await assert.rejects(()=>bot.sendSegments({user_id:event.user_id},[{type:'record',data:{file:'base64://'+wav().toString('base64')}},{type:'text',data:{text:'mixed'}}]),/单独/);
});

test('chat selects saved media by name, validates model IDs and speaks requested replies with text fallback',()=>sandbox(async root=>{
  const library=new OutgoingMedia(root),item=await library.put(upload());
  const deps={owner:'99999999',catalog:{list:async()=>[]},persona:async()=>({voice:[]}),outgoingMedia:{list:e=>library.available(e),outgoing:(e,id)=>library.outgoing(e,id)},speech:{synthesize:async()=>({type:'record',data:{file:'base64://'+wav().toString('base64')}})},ai:async()=>JSON.stringify({text:'好呀',mediaIds:[item.id]})};
  const result=await routeNatural('/表情包 开心',event,deps);assert.equal(result.segments[0].type,'image');assert.equal(result.text,'');
  const reply=await routeNatural('用语音回答：你好',event,deps);assert.deepEqual(reply.segments.map(p=>p.type),['image','record']);assert.equal(reply.text,'好呀');
  deps.ai=async()=>JSON.stringify({text:'不可用',mediaIds:['outside']});assert.equal(await routeNatural('你好',event,deps),'不可用');
  deps.ai=async()=>'文字保留';deps.speech.synthesize=async()=>{throw Error('额度不足');};assert.match(await routeNatural('用语音回答：你好',event,deps),/文字保留.*\n.*额度不足/);
  assert.match(taskSystemPrompt({mode:'conversation',outgoingMedia:[item]}),/mediaIds/);
}));

test('message handler sends native media once, preserves memory and reports transport failure accurately',async()=>{
  const sent=[],memory=new ConversationMemory(),bot={send:async(_target,text)=>{sent.push({text});return [{message_id:1}];},sendSegments:async(target,parts)=>{sent.push({target,parts});return {message_id:2};}};
  const handler=createMessageHandler({bot,memory,groups:[],speech:{synthesize:async()=>({type:'record',data:{file:'base64://'+wav().toString('base64')}})}});
  await handler({...event,message:[{type:'text',data:{text:'/语音 Hello'}}]});assert.equal(sent.length,1);assert.equal(sent[0].parts[0].type,'record');assert.match(memory.get(event).at(-1).text,/语音.*Hello/);
  bot.sendSegments=async()=>{throw Error('conversion failed');};await handler({...event,message_id:2,message:[{type:'text',data:{text:'/语音 Again'}}]});assert.match(sent.at(-1).text,/未成功/);assert.match(memory.get(event).at(-1).text,/未完成/);
});

test('speech settings migrate additively, validate official endpoints and expose a masked key in native UI',async()=>{
  const old=defaults({});delete old.speech;const cfg=validateSettings(old);assert.equal(cfg.speech.enabled,false);assert.equal(old.speech,undefined);
  assert.throws(()=>validateSettings({...cfg,speech:{...cfg.speech,baseURL:'https://127.0.0.1'}}));
  const writes=[],state={settings:cfg,secrets:{mimoKey:true}};
  const adapter=createNativeConfigAdapter({bridge:{request:async(method,path,value)=>{if(method==='GET')return {status:200,data:path==='state'?state:path==='memory'?{notes:[],digests:[],conversations:[]}: {items:[],reports:[]}};writes.push({path,value});if(path==='settings')state.settings=value.settings;return {status:200,data:{ok:true}};}}});
  const f=await adapter.getConfig();f.page='speech';const fields=adapter.schema(f);const key=fields.find(f=>f.key.endsWith('__mimoKey'));assert.equal(key.default,'');
  assert.ok(fields.find(f=>f.key.endsWith('__baseURL')).options.some(o=>o.value==='https://token-plan-cn.xiaomimimo.com/v1'));
  f[key.key]='tp-fixture';await adapter.setConfig(f);assert.equal(writes.find(w=>w.path==='secrets').value.mimoKey,'tp-fixture');
});

test('authenticated media API accepts uploads beyond legacy body limit, and never exposes keys or enables remote paths',()=>sandbox(async root=>{
  const store=new SettingsStore(new URL('settings.json',root),{});await store.load();
  const vault=new SecretVault(root,{}, {protect:s=>Buffer.from(s).toString('base64'),unprotect:s=>Buffer.from(s,'base64').toString()});await vault.load();
  const runtime=new BotRuntime(store,vault,{root});runtime.status=async()=>({});const admin=await startAdmin({store,vault,runtime,root,port:0});
  const bridge=new AdminBridge('unused');bridge.session=async()=>{
    const res=await fetch(admin.origin+'/api/session',{method:'POST',headers:{origin:admin.origin,'content-type':'application/json'},body:JSON.stringify({key:admin.accessKey})});return {origin:admin.origin,csrf:(await res.json()).csrf,cookie:res.headers.get('set-cookie').split(';')[0]};
  };
  try{
    const anonymous=await fetch(admin.origin+'/api/media');assert.equal(anonymous.status,401);
    const large=Buffer.concat([png,Buffer.alloc(110000)]);const saved=await bridge.request('POST','media',upload({base64:large.toString('base64')}));assert.equal(saved.status,200);
    assert.equal((await bridge.request('GET','media')).data.items.length,1);
    assert.match((await bridge.request('POST','media/preview',{id:saved.data.item.id})).data.dataURL,/^data:image\/png;base64,/);
    assert.equal((await bridge.request('PUT','secrets',{mimoKey:'tp-private-fixture'})).status,200);
    assert.equal((await bridge.request('GET','state')).data.secrets.mimoKey,true);assert.ok(!JSON.stringify((await bridge.request('GET','state')).data).includes('tp-private-fixture'));
    assert.equal((await bridge.request('DELETE','media/'+saved.data.item.id)).status,200);
    assert.equal(allowedRoute('POST','media/../../secrets'),false);assert.equal(allowedRoute('GET','media/'+saved.data.item.id),false);
    assert.equal((await bridge.request('POST','speech/preview',{text:'Hello'})).status,400);
  }finally{runtime.stop();await admin.close();}
}));
