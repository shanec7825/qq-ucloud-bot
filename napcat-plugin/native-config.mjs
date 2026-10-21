import { randomUUID } from 'node:crypto';
import { PAGE_COPY, presentSchema } from './webui/copy.mjs';

const pages = { core: ['bot','accounts','profiles','bindings','groups','ai','agent','notes','conversations','memory','history','library','digests','qq'], github:['github'], drive:['drive'], ucloud:['school'], notices:['realtime','monitor','inbox','reports'] };
const labels = {bot:'基本设置',accounts:'QQ 账号',profiles:'人格池',bindings:'群聊 / 私聊人格',groups:'群组规则',ai:'模型与登录',agent:'工具与操作权限',qq:'默认账号连接',memory:'记忆设置',history:'历史摘要设置',library:'资料库',notes:'记忆管理',digests:'群摘要',conversations:'最近会话',github:'GitHub',drive:'Google Drive',school:'教学云',realtime:'即时提醒',monitor:'定时总结',reports:'总结记录',inbox:'待办事项'};
const words={name:'名称',ownerQQ:'主人 QQ',systemPrompt:'系统提示词',backend:'模型来源',model:'模型名称',baseURL:'接口地址',apiModel:'接口模型名称',url:'连接地址',enabled:'启用',recentLimit:'最近消息条数',ttlMinutes:'会话保留分钟',groupContext:'启用群上下文',groupContextLimit:'群上下文条数',root:'资料目录',sendToModel:'允许发送给模型',id:'群号',historyEnabled:'启用历史摘要',template:'场景模板',templatePrompt:'群提示词',profileId:'绑定机器人方案',scope:'作用范围',text:'记忆内容',kind:'记忆类型',tags:'标签（逗号分隔）',summary:'摘要内容',status:'事项状态',authMode:'授权方式',defaultRepo:'默认仓库',clientId:'Google 客户端 ID',rootFolderId:'根文件夹 ID',pollSeconds:'轮询秒数',reminders:'截止提醒',groups:'监测群号（逗号分隔）',intervalMinutes:'整理间隔分钟',lookbackDays:'回看天数',maxMessages:'最多消息条数',notify:'私聊汇报',recipientQQ:'接收 QQ',focus:'重点关注内容',openaiKey:'替换 API 密钥',onebotToken:'替换连接密钥',githubToken:'替换 GitHub Token',googleClientSecret:'替换 Google 客户端密钥',username:'学号',password:'密码（仅本次登录使用）',edit:'新增或保存',delete:'删除',clear:'清空',view:'查看',pending:'待处理',done:'已完成',archived:'已归档',fact:'事实',preference:'偏好',instruction:'指令',none:'不执行额外操作',api:'API 接口',codex:'ChatGPT 登录',chatgpt:'ChatGPT 连接器',existing:'已有本机授权',token:'Token 授权',oauth:'Google 授权','check/model':'测试模型','codex/login':'登录 ChatGPT（保存后重新打开查看链接）','codex/account':'检查 ChatGPT 登录状态','check/github':'测试 GitHub','check/drive':'测试云盘','google/authorize':'生成 Google 授权链接（保存后重新打开查看）','check/ucloud':'同步测试教学云','ucloud/login':'登录教学云','monitor/run':'立即整理一次'};
const choices = a => a.map(x => typeof x === 'string' ? {label:words[x]||x,value:x} : x);
Object.assign(words, {accountId:'QQ 账号',defaultProfileId:'默认人格',profileId:'使用人格',targetId:'群号 / 对方 QQ',kind:'类型',writes:'允许提出写入操作（执行前仍需确认）',maxSteps:'单次最多工具轮数',debounceSeconds:'合并等待秒数',group:'群聊',private:'私聊',identity:'名字与设定',memories:'此人格的记忆',accessMode:'云盘权限',read:'只读',write:'读写（需重新授权）',name:'名称',systemPrompt:'人格设定'});
const safe = value => String(value ?? '').slice(0,18000);
const field = (key,type,value,extra={}) => ({key,type,label:({help:'使用说明',result:'上次操作结果',preview:'内容预览'})[key]||words[key.split('__').at(-1)]||key.split('__').at(-1),default:value,...extra});
function memorySelection(f, note) {
  const scope=note?.scope||'', scoped=/^account:([^:]+):(?:global|profile:([^:]+)(?::(group|private):(\d+))?)$/.exec(scope), legacy=/^(group|private):(\d+)$/.exec(scope);
  return {accountId:f['note_account_'+f.resource]??scoped?.[1]??'default',profileId:f['note_profile_'+f.resource]??(scope.endsWith(':global')?'*':scoped?.[2]==='_'?'':scoped?.[2]??/^profile:(.+)$/.exec(scope)?.[1]??''),kind:f['note_kind_'+f.resource]??scoped?.[3]??legacy?.[1]??'shared',targetId:scoped?.[4]??legacy?.[2]??''};
}
export function initialNativeSchema(module='core') { return [field('page','select',pages[module][0],{label:'设置分类',reactive:true,options:choices(pages[module].map(value=>({value,label:PAGE_COPY[value].title})))}),field('help','text','正在读取设置。编辑后请先保存，再切换分类。')]; }

export function createNativeConfigAdapter({module='core',bridge,now=Date.now,ttlMs=30*60*1000,maxSessions=64}) {
  const sessions = new Map(); let lastResult; let saveQueue=Promise.resolve();
  async function request(method,path,value) { const r=await bridge.request(method,path,value); if(r.status>=400) throw new Error(r.data?.error || '配置操作失败'); return r.data; }
  function session(f) { const s=sessions.get(f?._session); if(!s || s.saved || now()-s.touched>ttlMs) throw new Error('配置表单已过期，请关闭后重新打开。'); s.touched=now(); return s; }
  async function snapshot() { const [state,memory,inbox,monitor]=await Promise.all([request('GET','state'),request('GET','memory'),request('GET','inbox'),request('GET','monitor')]); return {state,memory,inbox,monitor}; }
  async function getConfig() { for(const [id,s] of sessions) if(now()-s.touched>ttlMs) sessions.delete(id); while(sessions.size>=maxSessions) sessions.delete(sessions.keys().next().value); const id=randomUUID(); sessions.set(id,{...await snapshot(),touched:now(),generation:0,notice:lastResult && now()-lastResult.at<600000?lastResult.text:''}); return {_session:id,page:pages[module][0],resource:'new',operation:'edit'}; }
  function normalize(f) { const p=pages[module].includes(f.page)?f.page:pages[module][0]; return {...f,page:p,resource:f['resource_'+p]??'new',action:f['action_'+p+'_'+session(f).generation]??'none',operation:f['operation_'+p]??(['conversations','reports','inbox'].includes(p)?'view':'edit')}; }
  function schema(f) {
    f=normalize(f); const s=session(f), p=f.page, cfg=s.state.settings;
    const result=initialNativeSchema(module); result[0].default=p; result[1].default='编辑后先保存再切换。操作仅在点击原生“保存”后执行。密钥输入为明文，仅填写替换值；留空保留。';
    if(s.notice) result.push(field('result','text',safe(s.notice)));
    const rows= ['groups','profiles','accounts','bindings'].includes(p)?cfg[p]:p==='notes'?s.memory.notes:p==='digests'?s.memory.digests:p==='conversations'?s.memory.conversations:p==='inbox'?(Array.isArray(s.inbox)?s.inbox:s.inbox.items||[]):p==='reports'?(s.monitor.reports||[]):null;
    const resource=rows?.find(x=>String(x.id??x.groupId??x.scope)===String(f.resource));
    const personaMemory=p==='profiles' && f.profile_section==='memories', memoryAccount=f.memory_account||'default';
    const personaNotes=personaMemory && resource?s.memory.notes.filter(n=>n.scope===`account:${memoryAccount}:profile:${resource.id}` || memoryAccount==='default' && n.scope==='profile:'+resource.id):[];
    const selectedNote=personaNotes.find(n=>n.id===f.persona_note);
    const noteScope=memorySelection(f,resource);
    const keyBase=`${p}__${s.generation}__${encodeURIComponent([f.resource||'new',f.profile_section||'',memoryAccount,selectedNote?.id||'new',...(p==='notes'?[noteScope.accountId,noteScope.profileId,noteScope.kind]:[])].join('|'))}__${cfg.revision}__${encodeURIComponent((selectedNote||resource)?.updatedAt||'')}__`;
    const add=(name,value,type,options)=>result.push(field(keyBase+name,type||typeof value,value,options?{options:choices(options)}:{}));
    const edit=(obj)=>{for(const [name,value] of Object.entries(obj)) { if(name==='id' && ['profiles','accounts','bindings'].includes(p)) continue; if(Array.isArray(value)) add(name,value.join(', '),'string'); else if(['string','boolean','number'].includes(typeof value)) {const personas=[{value:'',label:'继承默认人格'},...cfg.profiles.map(x=>({value:x.id,label:x.name}))]; const enums={backend:['codex','api'],authMode:p==='drive'?['chatgpt','existing','oauth']:['chatgpt','existing','token'],accessMode:['read','write'],template:(s.state.groupTemplates||[]).map(x=>({value:x.id,label:x.name})),profileId:personas,defaultProfileId:personas,accountId:(cfg.accounts||[]).map(x=>({value:x.id,label:x.name})),kind:p==='bindings'?['group','private']:['fact','preference','instruction']}; add(name,value,enums[name]?'select':undefined,enums[name]); if(typeof value==='string' && (value.length>150 || /Prompt|text|summary|focus/.test(name))) result.push(field(keyBase+name+'_preview','text',safe(value),{label:(words[name]||name)+' 当前内容预览'})); } }};
    if(rows) {
      result.push(field('resource_'+p,'select',f.resource||'new',{label:'选择记录',reactive:true,options:choices([{value:'new',label:'新建 / 未选择'},...rows.map(x=>({value:String(x.id??x.groupId??x.scope),label:p==='bindings'?`${cfg.accounts.find(a=>a.id===x.accountId)?.name||x.accountId} · ${x.kind==='group'?'群':'私聊'} ${x.targetId} → ${cfg.profiles.find(a=>a.id===x.profileId)?.name||'默认人格'}`:String(x.name||x.text||x.title||x.id||x.groupId||x.scope).slice(0,70)}))])}));
      if(p==='profiles') result.push(field('profile_section','select',f.profile_section||'identity',{label:'管理内容',reactive:true,options:choices(['identity','memories'])}));
      const ops=['groups','profiles','notes','accounts','bindings'].includes(p)?['edit','delete']:p==='digests'?['edit','clear']:p==='conversations'?['view','clear']:p==='inbox'?['view','status']:['view'];
      result.push(field('operation_'+p,'select',ops.includes(f.operation)?f.operation:ops[0],{label:'保存时执行',reactive:true,options:choices(ops)}));
      if(personaMemory) {
        if(!resource) result.push(field('preview','text','先创建并保存角色，再添加长期记忆。'));
        else {
          result.push(field('memory_account','select',memoryAccount,{label:'记忆所属 QQ 账号',reactive:true,options:choices((cfg.accounts||[]).map(a=>({value:a.id,label:a.name})))}));
          result.push(field('persona_note','select',selectedNote?.id||'new',{label:'选择记忆',reactive:true,options:choices([{value:'new',label:'新增记忆'},...personaNotes.map(n=>({value:n.id,label:n.text.slice(0,70)}))])}));
          if(f.operation==='delete') result.push(field(keyBase+'confirm','boolean',false,{label:'确认删除所选记忆'}));
          else edit(selectedNote?Object.fromEntries(['text','kind','tags','enabled'].map(k=>[k,selectedNote[k]])):{text:'',kind:'fact',tags:[],enabled:true});
          result.push(field('preview','text',`角色：${resource.name}\n记忆仅用于所选 QQ。指定群聊或私聊的记忆请到“长期记忆”设置。`));
        }
      }
      else if(['delete','clear'].includes(f.operation)) result.push(field(keyBase+'confirm','boolean',false,{label:'确认删除 / 清空所选记录'}));
      else if(p==='groups') edit(resource||{id:'',name:'',enabled:true,historyEnabled:false,template:'auto',templatePrompt:'',profileId:''});
      else if(p==='profiles') {edit(resource||{name:'',model:'',systemPrompt:''}); if(resource) result.push(field('preview','text',safe('此角色可用于多个群和私聊。选择“角色的长期记忆”管理它记住的内容。\n当前使用数：'+((cfg.bindings||[]).filter(b=>b.profileId===resource.id).length+cfg.groups.filter(g=>g.profileId===resource.id).length))));}
      else if(p==='accounts') {edit(resource?{...resource,...(resource.id==='default'?{url:cfg.qq.url}:{})}:{name:'',enabled:true,url:'ws://127.0.0.1:3002',defaultProfileId:''});add('onebotToken','','string');result.push(field('preview','text','每个账号连接自己的 NapCat / OneBot 端口。人格名字只影响聊天身份，不会改 QQ 的真实昵称。群聊 / 私聊的绑定优先于账号默认人格。'));}
      else if(p==='bindings') edit(resource||{accountId:'default',kind:'group',targetId:'',profileId:'',enabled:true});
      else if(p==='notes') {
        for(const [key,label,value,options] of [['note_account','QQ 账号',noteScope.accountId,(cfg.accounts||[]).map(a=>({value:a.id,label:a.name}))],['note_profile','记忆所属人格',noteScope.profileId,[{value:'',label:'基础角色'},{value:'*',label:'整个账号共享'},...cfg.profiles.map(a=>({value:a.id,label:a.name}))]],['note_kind','生效会话',noteScope.kind,[{value:'shared',label:'所有会话'},{value:'group',label:'指定群聊'},{value:'private',label:'指定私聊'}]]]) result.push(field(key+'_'+f.resource,'select',value,{label,reactive:true,options:choices(options)}));
        if(noteScope.kind!=='shared') add('targetId',noteScope.targetId,'string');
        edit(resource?Object.fromEntries(['text','kind','tags','enabled'].map(k=>[k,resource[k]])):{text:'',kind:'fact',tags:[],enabled:true});
      }
      else if(p==='digests' && resource) {add('summary',resource.digest?.summary||resource.digest?.text||'','string'); result.push(field('preview','text',safe(resource.digest?.summary||resource.digest?.text||'')));}
      else if(p==='inbox' && resource) {add('status',resource.status,'select',['pending','done','archived']); result.push(field('preview','text',safe([resource.title,resource.summary,resource.deadlineText,...(resource.sources||[]).map(x=>x.excerpt)].filter(Boolean).join('\n'))));}
      else if(resource) result.push(field('preview','text',safe(p==='reports'?[resource.groupName,resource.createdAt,...(resource.items||[]).flatMap(x=>[x.title,x.summary,...(x.sources||[]).map(y=>y.excerpt)])].filter(Boolean).join('\n'):['会话：'+resource.scope,...(resource.entries||[]).map(x=>x.content||x.text||''),resource.background].filter(Boolean).join('\n'))));
    } else edit(cfg[p]||{});
    const actions={ai:['none','check/model','codex/login','codex/account'],github:['none','check/github'],drive:['none','check/drive','google/authorize'],school:['none','check/ucloud','ucloud/login'],monitor:['none','monitor/run']};
    if(actions[p]) result.push(field('action_'+p+'_'+s.generation,'select','none',{label:'保存后额外执行',options:choices(actions[p])}));
    const secrets={ai:'openaiKey',qq:'onebotToken',github:'githubToken',drive:'googleClientSecret'};
    if(secrets[p]) add(secrets[p],'','string');
    if(p==='school') {add('username','','string'); add('password','','string');}
    if(p==='realtime') result.push(field('preview','text','实时接收 → 合并短时间重复消息 → 判断重要性 → 私聊提醒。无需 @；仅处理所选账号在线后收到的指定群消息。'));
    if(p==='monitor') result.push(field('preview','text','按间隔整理导出的历史消息，可回看离线内容。私聊汇报需单独开启。'));
    if(p==='agent') result.push(field('preview','text','仅管理员私聊可用。修改前会展示具体操作；回复“/确认 验证码”后执行。更换账号、角色或配置后需重新确认。'));
    return presentSchema(result, p);
  }
  async function controller(ui,initialConfig) { session(initialConfig).ui=ui; await ui.updateSchema(schema(initialConfig)); }
  async function onConfigChange(ui,key,value,currentConfig) { if(!['page','profile_section','memory_account','persona_note'].includes(key) && !/^(?:resource_|operation_|note_)/.test(key)) return; const f={...currentConfig,[key]:value}; session(f); if(key==='page') {f.resource='new';f.operation='edit';} await ui.updateSchema(schema(f)); }
  function setConfig(f) { const work=saveQueue.catch(()=>{}).then(()=>saveConfig(f)); saveQueue=work; return work; }
  async function saveConfig(f) {
    f=normalize(f); const s=session(f), live=await snapshot(), cfg=structuredClone(s.state.settings), p=f.page;
    if(!pages[module].includes(p)) throw new Error('无效配置分类。');
    if(live.state.settings.revision!==cfg.revision) throw new Error('配置已在其他页面更新，请重新打开。');
    const fields=schema(f), values={}; for(const item of fields) if(item.key.includes('__') && item.type!=='text') values[item.key.split('__').at(-1)]=Object.hasOwn(f,item.key)?f[item.key]:item.default;
    const rows=['groups','profiles','accounts','bindings'].includes(p)?cfg[p]:p==='notes'?s.memory.notes:null;
    const existing=rows?.find(x=>x.id===f.resource);
    const personaMemory=p==='profiles' && f.profile_section==='memories', memoryAccount=f.memory_account||'default';
    const personaNote=personaMemory && existing?s.memory.notes.find(n=>n.id===f.persona_note && (n.scope===`account:${memoryAccount}:profile:${existing.id}` || memoryAccount==='default' && n.scope==='profile:'+existing.id)):null;
    if(personaNote) {const fresh=live.memory.notes.find(n=>n.id===personaNote.id);if(!fresh || fresh.updatedAt!==personaNote.updatedAt) throw new Error('该记忆已被更新，请重新打开。');}
    if(p==='notes' && existing) {const fresh=live.memory.notes.find(x=>x.id===existing.id); if(!fresh || fresh.updatedAt!==existing.updatedAt) throw new Error('该记忆已被更新，请重新打开。');}
    if(p==='digests') {const before=s.memory.digests.find(x=>x.groupId===f.resource), after=live.memory.digests.find(x=>x.groupId===f.resource); if(JSON.stringify(before?.digest)!==JSON.stringify(after?.digest)) throw new Error('摘要已在其他页面更新，请重新打开。');}
    if(p==='inbox' && f.operation==='status') {const get=x=>(Array.isArray(x)?x:x.items||[]).find(i=>i.id===f.resource); if(get(s.inbox)?.status!==get(live.inbox)?.status) throw new Error('事项状态已更新，请重新打开。');}
    const destructive=['delete','clear'].includes(f.operation); if(destructive && values.confirm!==true) throw new Error('请勾选确认后保存。');
    let settingsChanged=false,accountSecret;
    if(personaMemory) {if(!existing) throw new Error('请先选择已有的人格。');if(f.operation==='delete') {if(!personaNote) throw new Error('请选择已有记忆。');await request('DELETE','memory/notes/'+personaNote.id);} else await request('PUT','memory/notes',{scope:`account:${memoryAccount}:profile:${existing.id}`,text:values.text,kind:values.kind,tags:String(values.tags||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean),enabled:values.enabled,...(personaNote?{id:personaNote.id}:{})});}
    else if(['groups','profiles','accounts','bindings'].includes(p)) {
      if(f.operation==='delete') {if(!existing) throw new Error('请选择已有记录。');if(p==='accounts' && existing.id==='default') throw new Error('默认账号不能删除，可停用连接。');if(p==='accounts' && cfg.bindings.some(b=>b.accountId===existing.id)) throw new Error('账号仍有会话绑定，请先删除绑定。');if(p==='profiles' && (cfg.groups.some(g=>g.profileId===existing.id)||(cfg.bindings||[]).some(b=>b.profileId===existing.id)||(cfg.accounts||[]).some(a=>a.defaultProfileId===existing.id))) throw new Error('这个角色仍被账号或聊天使用，请先更换对应的角色分配。'); cfg[p]=rows.filter(x=>x.id!==existing.id);}
      else {const v={...values}; delete v.confirm;delete v.onebotToken;if(p!=='groups') v.id=existing?.id||randomUUID().replaceAll('-','');if(p==='accounts') {if(v.id==='default') cfg.qq.url=v.url;if(values.onebotToken?.trim()) accountSecret={[v.id==='default'?'onebotToken':'onebotToken:'+v.id]:values.onebotToken};} if(existing) rows.splice(rows.indexOf(existing),1,v); else rows.push(v);}
      settingsChanged=true;
    } else if(p==='notes') {if(f.operation==='delete') {if(!existing) throw new Error('请选择已有记录。'); await request('DELETE','memory/notes/'+existing.id);} else {const selected=memorySelection(f,existing);if(selected.profileId==='*' && selected.kind!=='shared') throw new Error('整个账号共享的记忆请使用“所有会话”；指定会话请先选择人格。');if(!cfg.accounts.some(a=>a.id===selected.accountId)||selected.profileId && selected.profileId!=='*'&&!cfg.profiles.some(a=>a.id===selected.profileId)) throw new Error('请选择已有账号和人格。');values.scope=`account:${selected.accountId}:`+(selected.profileId==='*'?'global':`profile:${selected.profileId||'_'}`+(selected.kind==='shared'?'':`:${selected.kind}:${values.targetId}`));delete values.targetId;values.tags=String(values.tags||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean); await request('PUT','memory/notes',{...values,...(existing?{id:existing.id}:{})});}}
    else if(p==='digests') {if(!cfg.groups.some(g=>g.id===f.resource)) throw new Error('请选择已有群。'); await request('PUT','memory/digest',{groupId:f.resource,summary:destructive?'':values.summary});}
    else if(p==='conversations') {if(f.operation==='clear') {if(f.resource==='new') throw new Error('请选择会话。'); await request('DELETE','memory/conversations',{scope:f.resource});}}
    else if(p==='inbox') {if(f.operation==='status') await request('PUT','inbox/item',{id:f.resource,status:values.status});}
    else if(p!=='reports') {for(const key of Object.keys(cfg[p])) if(Object.hasOwn(values,key)) cfg[p][key]=Array.isArray(cfg[p][key])?String(values[key]).split(/[,，]/).map(x=>x.trim()).filter(Boolean):values[key];if(p==='qq') {const a=cfg.accounts?.find(a=>a.id==='default');if(a)a.url=cfg.qq.url;} settingsChanged=true;}
    if(settingsChanged) await request('PUT','settings',{settings:cfg,revision:cfg.revision});
    const secretNames=['openaiKey','onebotToken','githubToken','googleClientSecret']; const secrets=accountSecret||Object.fromEntries(secretNames.filter(k=>typeof values[k]==='string' && values[k].trim()).map(k=>[k,values[k]])); if(Object.keys(secrets).length) await request('PUT','secrets',secrets);
    if(f.action && f.action!=='none') {const allowed={ai:['check/model','codex/login','codex/account'],github:['check/github'],drive:['check/drive','google/authorize'],school:['check/ucloud','ucloud/login'],monitor:['monitor/run']}; if(!allowed[p]?.includes(f.action)) throw new Error('无效操作。'); const result=await request(f.action==='codex/account'?'GET':'POST',f.action,f.action==='ucloud/login'?{username:values.username,password:values.password}:{}); s.notice=Object.entries(result).filter(([k,v])=>['string','boolean','number'].includes(typeof v) && !/token|secret|password/i.test(k)).map(([k,v])=>`${({loggedIn:'已登录',connected:'已连接',authenticated:'已认证',available:'可用',status:'状态',message:'信息',url:'授权链接',authUrl:'授权链接',loginPending:'等待登录完成',method:'登录方式',verificationUri:'授权链接',userCode:'验证码',code:'验证码'})[k]||k}: ${typeof v==='boolean'?(v?'是':'否'):v}`).join('\n')||'操作已完成'; lastResult={at:now(),text:s.notice.slice(0,18000)};}
    s.saved=true; return {ok:true};
  }
  return {getConfig,setConfig,controller,onConfigChange,schema,initialSchema:initialNativeSchema(module),sessions};
}
