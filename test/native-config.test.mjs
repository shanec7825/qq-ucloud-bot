import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeConfigAdapter} from '../napcat-plugin/native-config.mjs';
import {defaults,validateSettings} from '../src/settings.mjs';
function setup(module='core') {const state={settings:defaults({}),groupTemplates:[{id:'auto',name:'自动'}]}, memory={notes:[],digests:[],conversations:[]},calls=[]; const bridge={async request(method,path,value) {calls.push({method,path,value}); if(method==='GET') return {status:200,data:structuredClone(path==='state'?state:path==='memory'?memory:path==='inbox'?{items:[]}:{reports:[]})}; if(path==='memory/notes' && method==='PUT') {const n={...value,id:value.id||'generated',updatedAt:String(Date.now())}; const i=memory.notes.findIndex(x=>x.id===n.id); if(i<0) memory.notes.push(n); else memory.notes[i]=n;} if(path.startsWith('memory/notes/') && method==='DELETE') memory.notes=memory.notes.filter(n=>n.id!==path.split('/').at(-1)); if(path==='settings'){state.settings=structuredClone(value.settings);state.settings.revision++;} return {status:200,data:{ok:true}};}}; return {adapter:createNativeConfigAdapter({module,bridge}),state,memory,calls}; }
const key=(adapter,f,suffix)=>adapter.schema(f).find(x=>x.key.endsWith('__'+suffix)).key;

test('group history selection controls the internal reader without exposing a second global switch',async()=>{
 const {adapter,state}=setup();const f=await adapter.getConfig();f._expanded=true;f.page='groups';f[key(adapter,f,'id')]='123456';f[key(adapter,f,'historyEnabled')]=true;await adapter.setConfig(f);
 assert.equal(state.settings.history.enabled,true);
 const next=await adapter.getConfig();next._expanded=true;next.page='groups';next.resource_groups='123456';next[key(adapter,next,'historyEnabled')]=false;await adapter.setConfig(next);assert.equal(state.settings.history.enabled,false);
});
test('native fields preserve missing saved values and explicit empty and false',async()=>{const {adapter,state}=setup();const f=await adapter.getConfig(); f.page='profiles';f[key(adapter,f,'name')]='';  await adapter.setConfig(f); assert.equal(state.settings.bot.name,'');assert.equal(state.settings.bot.systemPrompt,defaults({}).bot.systemPrompt);const g=await adapter.getConfig();g.page='memory';g[key(adapter,g,'enabled')]=false;await adapter.setConfig(g);assert.equal(state.settings.memory.enabled,false);});
test('separate form sessions reject stale settings',async()=>{const {adapter}=setup();const first=await adapter.getConfig(), second=await adapter.getConfig();await adapter.setConfig(first);await assert.rejects(adapter.setConfig(second),/其他页面/);});
test('note timestamp prevents concurrent overwrite and resource fields never reuse across notes',async()=>{const {adapter,memory}=setup();memory.notes=[{id:'n1',text:'one',scope:'global',kind:'fact',tags:[],enabled:true,updatedAt:'1'},{id:'n2',text:'two',scope:'global',kind:'fact',tags:[],enabled:true,updatedAt:'2'}];const f=await adapter.getConfig();f.page='notes';f.resource_notes='n1';const old=key(adapter,f,'text');f.resource_notes='n2';assert.notEqual(key(adapter,f,'text'),old);memory.notes[1].updatedAt='3';await assert.rejects(adapter.setConfig(f),/记忆已被更新/);});
test('native selectors are reactive; secrets remain blank and actions require Save',async()=>{const {adapter,calls}=setup('drive');const f=await adapter.getConfig();f[key(adapter,f,'authMode')]='oauth';const schema=adapter.schema(f);assert.ok(schema.every(x=>['string','number','boolean','select','multi-select','text','html'].includes(x.type)));assert.equal(schema.find(x=>x.key==='page').reactive,true);assert.equal(schema.find(x=>x.key.endsWith('__googleClientSecret')).default,'');assert.match(schema.find(x=>x.key==='open_workspace').default,/href="\/webui\/extension#napcat-plugin-agent-drive:settings"/);await adapter.onConfigChange({updateSchema(){}},'action_drive','google/authorize',f);assert.equal(calls.filter(x=>x.method==='POST').length,0);});
test('delete requires explicit confirmation and bound profile rejects',async()=>{const {adapter,state}=setup();state.settings.profiles=[{id:'p',name:'方案',model:'',systemPrompt:''}];state.settings.groups=[{id:'12345',profileId:'p'}];const f=await adapter.getConfig();f.page='profiles';f.resource_profiles='p';f.operation_profiles='delete';await assert.rejects(adapter.setConfig(f),/勾选确认/);f[key(adapter,f,'confirm')]=true;await assert.rejects(adapter.setConfig(f),/仍被账号或聊天使用/);});

test('concurrent native note saves reject the later stale edit and consumed sessions cannot duplicate creates',async()=>{const {adapter,memory,calls}=setup();memory.notes=[{id:'n',text:'one',scope:'global',kind:'fact',tags:[],enabled:true,updatedAt:'initial'}];const a=await adapter.getConfig(),b=await adapter.getConfig(); for(const f of [a,b]) {f.page='notes';f.resource_notes='n';f[key(adapter,f,'text')]='changed';} const r=await Promise.allSettled([adapter.setConfig(a),adapter.setConfig(b)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);const c=await adapter.getConfig();c.page='notes';c[key(adapter,c,'text')]='new';await adapter.setConfig(c);await assert.rejects(adapter.setConfig(c),/过期/);assert.equal(calls.filter(x=>x.method==='PUT'&&x.path==='memory/notes').length,2);});

test('post-save UI failure cannot duplicate committed new notes',async()=>{const {adapter,calls}=setup();const f=await adapter.getConfig(); f.page='notes';f[key(adapter,f,'text')]='new note';let initialized=false;await adapter.controller({updateSchema(){if(initialized) throw new Error('UI disconnected');}},f);initialized=true;await adapter.setConfig(f);await assert.rejects(adapter.setConfig(f),/过期/);assert.equal(calls.filter(x=>x.method==='PUT'&&x.path==='memory/notes').length,1);});

test('persona editor exposes name and one system prompt while preserving the existing model',async()=>{const {adapter,state}=setup();state.settings.profiles=[{id:'p',name:'原有角色',model:'kept-model',systemPrompt:'原有设定'}];const f=await adapter.getConfig();f.page='profiles';f.resource_profiles='p';const editable=adapter.schema(f).filter(x=>x.key.includes('__')&&x.type!=='text');assert.deepEqual(editable.map(x=>x.key.split('__').at(-1)),['name','systemPrompt']);assert.ok(!adapter.schema(f).some(x=>x.key==='profile_section'));f[key(adapter,f,'systemPrompt')]='完全自定义';const result=await adapter.setConfig(f);assert.equal(result.resource,'p');assert.equal(state.settings.profiles[0].systemPrompt,'完全自定义');assert.equal(state.settings.profiles[0].model,'kept-model');});

test('conditional fields preserve hidden settings and collapsed group defaults remain valid',async()=>{
 const {adapter,state}=setup();let f=await adapter.getConfig();f.page='ai';assert.ok(!adapter.schema(f).some(x=>x.key.endsWith('__baseURL')));f[key(adapter,f,'backend')]='api';f[key(adapter,f,'apiModel')]='new-api';await adapter.setConfig(f);assert.equal(state.settings.ai.model,defaults({}).ai.model);assert.equal(state.settings.ai.apiModel,'new-api');
 f=await adapter.getConfig();f.page='groups';assert.ok(!adapter.schema(f).some(x=>x.key.endsWith('__historyEnabled')));f[key(adapter,f,'id')]='123456';f[key(adapter,f,'name')]='新群';await adapter.setConfig(f);assert.equal(state.settings.groups[0].historyEnabled,false);validateSettings(state.settings);
});

test('native QQ directory is an explicit read and exposes selectable numbers',async()=>{
 const state={settings:defaults({})},calls=[];const bridge={async request(method,path,value){calls.push({method,path,value});return {status:200,data:path==='state'?state:path==='memory'?{notes:[],digests:[],conversations:[]}:path==='qq/contacts'?{groups:[{id:'123456',name:'课程群'}],friends:[{id:'234567',name:'同学'}],errors:[]}:{} };}};
 const adapter=createNativeConfigAdapter({bridge}),f=await adapter.getConfig();f.page='groups';let schema;await adapter.onConfigChange({updateSchema(value){schema=value;}},'directory','qq',f);const target=schema.find(x=>x.key.endsWith('__id'));assert.equal(target.type,'select');assert.ok(target.options.some(o=>o.value==='123456'));assert.equal(calls.filter(c=>c.path==='qq/contacts').length,1);assert.equal(calls.filter(c=>c.method==='PUT').length,0);
});

test('UCloud has a separate group multiselect and clearing it restores owner-only access',async()=>{
 const state={settings:defaults({ALLOWED_GROUPS:'345678'}),status:{}},calls=[];
 const bridge={async request(method,path,value){
  calls.push({method,path,value});
  if(path==='state')return {status:200,data:structuredClone(state)};
  if(path==='memory')return {status:200,data:{notes:[],digests:[],conversations:[]}};
  if(path==='qq/contacts')return {status:200,data:{groups:[{id:'123456',name:'课程群'},{id:'234567',name:'实验群'}],friends:[],errors:[]}};
  if(path==='settings'){state.settings=validateSettings(value.settings);state.settings.revision++;}
  return {status:200,data:{ok:true}};
 }};
 const adapter=createNativeConfigAdapter({module:'ucloud',bridge});let f=await adapter.getConfig(),schema;
 assert.equal(adapter.schema(f).find(field=>field.key.endsWith('__groups')).default,'');
 await adapter.onConfigChange({updateSchema(value){schema=value;}},'directory','qq',f);f.directory='qq';
 const groups=schema.find(field=>field.key.endsWith('__groups'));
 assert.equal(groups.label,'允许查询作业的群');assert.equal(groups.type,'multi-select');assert.equal(groups.options.length,2);
 f[groups.key]=['123456','234567'];await adapter.setConfig(f);
 assert.deepEqual(state.settings.school.groups,['123456','234567']);assert.deepEqual(state.settings.groups.map(group=>group.id),['345678']);
 f=await adapter.getConfig();assert.equal(adapter.schema(f).find(field=>field.key.endsWith('__groups')).default,'123456, 234567');
 f[key(adapter,f,'groups')]='';await adapter.setConfig(f);assert.deepEqual(state.settings.school.groups,[]);
 assert.equal(calls.filter(call=>call.path==='qq/contacts').length,1);
});

test('native control initialization does not close menus with redundant schema updates',async()=>{
 const {adapter}=setup();const f=await adapter.getConfig();let updates=0;const ui={updateSchema(){updates++;}};await adapter.controller(ui,f);assert.equal(updates,1);await adapter.onConfigChange(ui,'page',f.page,f);assert.equal(updates,1);await adapter.onConfigChange(ui,'page','groups',f);assert.equal(updates,2);await adapter.onConfigChange(ui,'page','groups',{...f,page:'groups'});assert.equal(updates,2);
});

test('global role shares the role entry and preserves administrator and custom roles',async()=>{
 const {adapter,state}=setup();state.settings.bot.ownerQQ='123456789';state.settings.profiles=[{id:'study',name:'学习助手',systemPrompt:'专属设定',model:'kept'}];
 const f=await adapter.getConfig();assert.equal(f.page,'chat');assert.equal(f.resource_profiles,'@global');f.page='profiles';
 assert.ok(!adapter.schema(f)[0].options.some(o=>o.value==='bot'||o.value==='qq'));
 f[key(adapter,f,'name')]='默认助手';f[key(adapter,f,'systemPrompt')]='全局设定';await adapter.setConfig(f);
 assert.equal(state.settings.bot.name,'默认助手');assert.equal(state.settings.bot.ownerQQ,'123456789');assert.equal(state.settings.profiles[0].systemPrompt,'专属设定');
 const g=await adapter.getConfig();g.page='profiles';g.operation_profiles='delete';await assert.rejects(adapter.setConfig(g),/默认全局角色不能删除/);
 const h=await adapter.getConfig();h.page='agent';h[key(adapter,h,'ownerQQ')]='987654321';await adapter.setConfig(h);assert.equal(state.settings.bot.ownerQQ,'987654321');validateSettings(state.settings);
});

test('notification schema saves real filters and digest output settings',async()=>{
 const {adapter,state}=setup('notices');let f=await adapter.getConfig();f._expanded=true;
 for(const [name,value] of Object.entries({includeKeywords:'考试, 作业',excludeKeywords:'广告',senderQQs:'123456789',outputFormat:'concise'}))f[key(adapter,f,name)]=value;
 assert.ok(!adapter.schema(f).some(field=>/__(?:accountId|recipientQQ|minPriority)$/.test(field.key)));
 await adapter.setConfig(f);assert.equal(state.settings.realtime.minPriority,'important');assert.equal(state.settings.realtime.includeKeywords,'考试, 作业');
 f=await adapter.getConfig();f.page='monitor';f._expanded=true;f[key(adapter,f,'template')]='course';f[key(adapter,f,'outputFormat')]='detailed';f[key(adapter,f,'templatePrompt')]='按课程分组';await adapter.setConfig(f);
 assert.equal(state.settings.monitor.template,'course');assert.equal(state.settings.monitor.outputFormat,'detailed');validateSettings(state.settings);
});
