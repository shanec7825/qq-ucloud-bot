// Product vocabulary shared by the native dialog and the extension page.
export const PAGE_COPY = {
  media: { title:'图片与表情包', group:'聊天与回复', description:'上传图片和 GIF 表情包，指定可使用的 QQ 账号与会话。' },
  speech: { title:'语音', group:'聊天与回复', description:'调用小米 MiMo TTS 发送 QQ 原生语音。文字与语音可分别组织内容，像聊天一样互相补充。' },
  bot: { title:'机器人身份', group:'聊天与回复', description:'设置机器人如何自称、如何说话，以及谁能使用私人功能。' },
  profiles: { title:'角色与语气', group:'聊天与回复', description:'保存不同的名字和回答风格，供 QQ 账号、群聊或私聊使用。' },
  bindings: { title:'会话角色分配', group:'聊天与回复', description:'选择机器人 QQ、群聊或好友，再指定由哪个角色回复。', detail:'角色选择顺序：会话指定角色 → QQ 账号默认角色 → 默认 QQ 的群角色 → 机器人基础风格。未指定角色时继续沿用下一层设置。关闭这条分配会停止该会话回复。' },
  groups: { title:'群聊回复', group:'聊天与回复', description:'选择允许机器人回复的群，设置回答风格。普通群中被 @ 才会回复。', detail:'这里的群规则供所有 QQ 账号使用。群消息提醒和定时整理在“群消息与提醒”插件中设置；列入定时整理的群不会发送群回复。' },
  accounts: { title:'QQ 账号连接', group:'连接与权限', description:'连接一个或多个 QQ，并为每个账号选择默认角色。', detail:'最多 20 个账号。每个 QQ 需在对应 NapCat 实例登录，使用独立 OneBot 端口；此处新增连接不会自动登录 QQ。角色名字不会修改 QQ 昵称。' },
  ai: { title:'回答模型', group:'连接与权限', description:'选择生成回答的模型。MiMo 支持按量 API 与 Token Plan 中国集群；可用同一 MiMo Key 连接聊天和 TTS。' },
  agent: { title:'工具权限', group:'连接与权限', description:'决定机器人能否在管理员私聊中调用工具、提出修改操作。' },
  library: { title:'共享资料', group:'连接与权限', description:'指定群成员可查询的本机资料目录，并决定能否将检索结果交给模型。' },
  qq: { title:'默认 QQ 连接', group:'连接与权限', description:'调整默认账号的连接地址。与“QQ 账号连接”中的默认账号同步。' },
  notes: { title:'长期记忆', group:'记忆与记录', description:'保存希望机器人长期记住的事实、偏好和要求，并选择对谁生效。' },
  memory: { title:'记忆与上下文', group:'记忆与记录', description:'决定回答时是否使用记忆，以及保留多少近期对话和群聊消息。' },
  history: { title:'群聊历史读取', group:'记忆与记录', description:'从本机导出的群聊历史生成背景摘要，供回答时参考。', detail:'需要本机聊天记录导出服务，并在“群聊回复”为对应群开启历史读取。当前仅供默认 QQ 的基础角色使用，也需开启“回答时使用记忆”。' },
  digests: { title:'群聊背景摘要', group:'记忆与记录', description:'查看或修订机器人回答时参考的群聊背景，不会向群里发送摘要。' },
  conversations: { title:'对话记录', group:'记忆与记录', description:'查看近期对话内容，或清空指定会话的上下文。' },
  github: { title:'GitHub 仓库', group:'资料连接', description:'连接 GitHub，让管理员在私聊中查询仓库和文件。' },
  drive: { title:'Google 云盘', group:'资料连接', description:'连接 Google Drive，让管理员在私聊中查询云盘资料。' },
  school: { title:'教学云作业', group:'作业与提醒', description:'登录北邮教学云，直接查看待交作业、站内通知和作业详情。' },
  realtime: { title:'群消息提醒', group:'消息与待办', description:'在线收到指定群的重要消息后，合并重复内容并私聊提醒你。', detail:'不需要 @。只处理所选 QQ 在线后收到的消息，不补读离线历史；不会向群里发送提醒。' },
  monitor: { title:'群消息定时整理', group:'消息与待办', description:'定时回看指定群的历史消息，整理重要通知和待办。', detail:'需要本机聊天记录导出服务。列入此处的群始终禁止群回复，即使暂停定时整理也保持静默。私聊发送整理结果需单独开启。' },
  inbox: { title:'通知待办', group:'消息与待办', description:'查看从群消息中提取的事项，标记完成或归档。' },
  reports: { title:'群消息整理记录', group:'消息与待办', description:'查看历次整理结果和消息依据，核对时间、要求与来源。' },
};

const common = {
  ownerQQ:['管理员 QQ','私人资料和工具仅对这个 QQ 的私聊开放。'],
  model:['模型名称','角色中留空时，使用“回答模型”的默认设置。'],
  url:['OneBot 连接地址','填写对应 NapCat 的正向 WebSocket 地址，例如 ws://127.0.0.1:3002。'],
  defaultProfileId:['默认角色','未单独分配角色的群聊和私聊使用此角色。'],
  profileId:['使用角色',''], accountId:['使用哪个 QQ',''], targetId:['群号或好友 QQ',''],
  onebotToken:['OneBot Token','与对应 NapCat 中的 Token 一致；留空保留已保存的值。'],
  openaiKey:['API Key','留空保留已保存的密钥。'], githubToken:['GitHub Token','留空保留已保存的 Token。'], googleClientSecret:['Google 客户端密钥','留空保留已保存的密钥。'],
  tags:['标签','多个标签用逗号分隔。'], text:['记住什么','写下事实、偏好或回答要求。'],
  username:['学号',''], password:['学校密码','仅用于本次登录，不保存密码。'],
  groups:['关注哪些群','可从当前 QQ 的群列表多选，也可填写群号，用逗号分隔。'], recipientQQ:['提醒发给谁','可从当前 QQ 的好友中选择，也可填写接收人的 QQ 号。'], focus:['关注什么','例如考试安排、报名截止、作业提交；可写明要忽略的消息。'],
};
const fields = {
  bot: { name:['机器人名字','用于聊天时自称，不会修改 QQ 昵称。'], systemPrompt:['默认回答风格','描述语气和回答习惯，作为基础角色的设定。'] },
  accounts: { name:['账号备注','仅用于识别这个连接，例如“学习号”。'], enabled:['连接此账号','关闭后停止此账号的消息连接。'] },
  profiles: { name:['名称',''], systemPrompt:['系统提示词',''] },
  bindings: { kind:['用于哪种聊天','选择群聊或私聊后，从对应列表选择对象。'], targetId:['群号或好友 QQ','从当前 QQ 的群或好友列表选择，也可手动填写。'], enabled:['允许这个会话回复','关闭后停止这段聊天的回复。'] },
  groups: { id:['群号','填写需要设置回复规则的 QQ 群号。'], name:['群备注','仅用于设置页识别，不会修改 QQ 群名。'], enabled:['在这个群回复','普通群中被 @ 时回复；定时整理群始终不回复。'], historyEnabled:['读取这个群的历史','还需在“群聊历史读取”开启总开关。'], template:['回答场景','按课程、年级或游戏场景组织回答，也可自动选择。'], templatePrompt:['这个群的补充要求','例如“先列截止时间，再说明提交方式”。'] },
  ai: { backend:['使用哪种模型服务',''], model:['ChatGPT 模型','填写当前登录账号可用的模型名称。'], baseURL:['API 服务地址','填写 OpenAI 兼容服务的根地址。'], apiModel:['API 模型','填写服务提供方的模型名称。'], mimoModel:['MiMo 模型','默认 mimo-v2.6-pro；支持 MiMo 按量 API 与 Token Plan。'] },
  agent: { enabled:['允许调用工具','仅管理员私聊可用。'], writes:['允许提出修改操作','执行前需在 QQ 中回复确认码。'], maxSteps:['每次最多调用轮数','1–8 轮。轮数越多，可连续处理的工具操作越多。'] },
  memory: { enabled:['回答时使用记忆','关闭后不使用长期记忆、近期对话和群聊背景。'], recentLimit:['保留近期对话条数','2–40 条。每个会话分别保留。'], ttlMinutes:['多久不聊就忘记上下文','1–1440 分钟。只影响近期上下文，不删除长期记忆。'], groupContext:['参考群里的近期消息','回答时一并参考同群的近期发言。'], groupContextLimit:['最多参考群消息条数','2–60 条。'] },
  history: { enabled:['从群聊历史生成背景摘要','还需为对应群开启历史读取。'] },
  library: { root:['共享资料目录','仅此目录中的资料可供群成员查询。'], sendToModel:['将检索结果交给模型','允许将检索到的教材片段和指定页图片发送给当前模型。'] },
  notes: { kind:['记忆类别',''], enabled:['使用这条记忆','关闭后保留内容，但不在回答中引用。'] },
  digests: { summary:['背景摘要内容','修改后供后续回答参考。'] },
  github: { enabled:['允许查询 GitHub','仅管理员私聊可用。'], authMode:['如何连接 GitHub',''], defaultRepo:['默认查询仓库','可选，格式为 owner/repository。'] },
  drive: { enabled:['允许查询云盘','仅管理员私聊可用。'], authMode:['如何连接云盘',''], accessMode:['云盘访问权限','读写模式需要独立授权，实际修改仍需确认。'], clientId:['Google 客户端 ID','使用自建 OAuth 授权时填写。'], rootFolderId:['起始文件夹 ID','留空从云盘根目录开始查询。'] },
  school: { enabled:['查询教学云作业',''], pollSeconds:['多久检查一次作业','单位为秒，最少 60 秒。'], reminders:['私聊提醒作业截止','提醒发送给管理员 QQ。'] },
  realtime: { enabled:['私聊提醒重要群消息',''], debounceSeconds:['合并消息等待时间','1–120 秒。将短时间内的相关消息合并判断。'] },
  monitor: { enabled:['定时整理群消息','关闭后停止自动整理，所选群仍保持静默。'], intervalMinutes:['多久整理一次','单位为分钟，最少 15 分钟。'], lookbackDays:['回看最近几天','1–30 天。'], maxMessages:['每次最多分析消息数','20–500 条。'], notify:['私聊发送整理结果','关闭后仍保存结果，可到“群消息整理记录”查看。'] },
  inbox: { status:['事项状态','完成后可归档，保留原始消息依据。'] },
};
const nouns = { groups:'群聊',profiles:'角色',accounts:'QQ 账号',bindings:'角色分配',notes:'记忆',digests:'群聊摘要',conversations:'对话',inbox:'待办',reports:'整理记录' };
const fieldOrder = {
  groups:['id','name','enabled','profileId','template','templatePrompt','historyEnabled'],
  accounts:['name','enabled','url','onebotToken','defaultProfileId'],
  profiles:['name','systemPrompt','model'],
  bindings:['accountId','kind','targetId','profileId','enabled'],
  realtime:['enabled','accountId','groups','recipientQQ','focus','debounceSeconds'],
  monitor:['enabled','groups','focus','intervalMinutes','lookbackDays','maxMessages','notify','recipientQQ'],
};
const optionLabels = { identity:'名字与风格',memories:'角色的长期记忆',edit:'编辑内容',delete:'删除所选内容',clear:'清空所选内容',view:'只查看',status:'更新事项状态',none:'仅保存设置',codex:'ChatGPT 登录',api:'自定义 API 服务',chatgpt:'复用 ChatGPT 连接',existing:'使用本机已有授权',token:'填写 Token',oauth:'使用 Google OAuth 授权','codex/login':'登录 ChatGPT','codex/account':'检查登录状态','google/authorize':'获取 Google 授权链接' };

const shortTitles = {bot:'身份',profiles:'人格',groups:'群聊',bindings:'分配',accounts:'QQ 账号',ai:'模型',agent:'权限',library:'资料库',qq:'默认连接',notes:'长期记忆',memory:'上下文',history:'历史读取',digests:'群摘要',conversations:'对话',github:'GitHub',drive:'Google Drive',school:'教学云',realtime:'即时提醒',monitor:'定时整理',inbox:'待办',reports:'整理记录'};
for (const [page,title] of Object.entries(shortTitles)) PAGE_COPY[page].title=title;
Object.assign(common, {accountId:['QQ 账号',''],profileId:['人格',''],targetId:['聊天对象',''],defaultProfileId:['默认人格',''],onebotToken:['OneBot Token','留空保留'],openaiKey:['API Key','留空保留'],githubToken:['GitHub Token','留空保留'],googleClientSecret:['Client Secret','留空保留'],focus:['关注事项',''],groups:['关注群','支持多选'],recipientQQ:['接收人 QQ',''],text:['记忆内容',''],tags:['标签','逗号分隔']});
Object.assign(fields.bindings,{kind:['聊天类型',''],targetId:['聊天对象',''],enabled:['允许回复','']});
Object.assign(fields.groups,{enabled:['允许回复','@ 时回复'],historyEnabled:['读取历史',''],template:['场景',''],templatePrompt:['补充要求','']});
Object.assign(fields.ai,{backend:['模型来源',''],baseURL:['API 地址',''],apiModel:['模型名','']});
Object.assign(fields.ai,{deepseekModel:['DeepSeek 模型','默认 deepseek-flash，也可填写账号可用的模型名称。'],deepseekThinking:['深度思考','复杂问题可开启，回复可能更慢。'],harnessModel:['Harness 模型','填写所选授权方式可用的模型名称。'],harnessAuth:['Harness 授权方式','已有登录使用本机官方 Harness 账号；API Key 使用下方密钥。']});
common.deepseekKey=['DeepSeek API Key','留空保留已保存的密钥。'];
common.mimoKey=['MiMo API / Token Plan Key','按量 API 使用 sk- Key；Token Plan 使用 tp- 或 ttp- Key。回答模型与 MiMo TTS 可共用此密钥，留空保留已保存的值。'];
fields.speech={enabled:['启用语音',''],autoReply:['自动附带语音','开启后文字与语音可分别表达；关闭后仅在请求语音时合成'],autoStyle:['按内容自动调整表达','让当前聊天模型（选择 MiMo 按量 API 或 Token Plan 时即 MiMo Agent）根据本条语音内容生成 MiMo TTS 指令；可调整语气、情绪、语速、停顿、重音、气息和音色质感，同时保持已选音色身份。'],baseURL:['小米服务地址','默认 Token Plan 中国：`https://token-plan-cn.xiaomimimo.com/v1`；也可选择按量 API 或其他 Token Plan 集群。服务地址需与 Key 类型匹配。'],model:['音色方式',''],voice:['音色',''],voiceDescription:['音色描述','每次合成可能有差异；需要声音更一致时可选预置音色'],style:['固定语气与语速要求',''],maxChars:['每条语音最多字数','20–1000 字']};
Object.assign(fields.memory,{enabled:['使用记忆',''],recentLimit:['对话条数','2–40 条'],ttlMinutes:['保留时长（分钟）','1–1440 分钟'],groupContext:['参考群消息',''],groupContextLimit:['群消息条数','2–60 条']});
Object.assign(fields.history,{enabled:['读取群历史','']});
Object.assign(fields.library,{root:['资料目录',''],sendToModel:['允许模型读取','']});
Object.assign(fields.drive,{authMode:['连接方式',''],clientId:['Client ID',''],rootFolderId:['起始文件夹 ID',''],accessMode:['访问权限','']});
Object.assign(fields.github,{authMode:['连接方式',''],defaultRepo:['默认仓库','owner/repository']});
Object.assign(fields.school,{enabled:['连接教学云',''],reminders:['截止提醒',''],pollSeconds:['检查间隔（秒）','最少 60 秒']});
Object.assign(fields.realtime,{enabled:['即时提醒',''],debounceSeconds:['合并等待（秒）','1–120 秒']});
Object.assign(fields.monitor,{enabled:['定时整理',''],intervalMinutes:['整理间隔（分钟）','最少 15 分钟'],lookbackDays:['回看天数','1–30 天'],maxMessages:['最多消息数','20–500 条'],notify:['私聊推送','']});
Object.assign(fields.agent,{enabled:['允许使用工具','仅管理员私聊'],writes:['允许提出修改','执行前确认'],maxSteps:['最多调用轮数','1–8 轮']});
Object.assign(optionLabels,{codex:'ChatGPT',api:'API',chatgpt:'ChatGPT 连接',existing:'本机授权',oauth:'OAuth 授权',token:'Token',none:'仅保存',edit:'编辑',delete:'删除',clear:'清空',view:'查看',status:'修改状态'});
Object.assign(optionLabels,{deepseek:'DeepSeek API','deepseek-harness':'DeepSeek Harness','mimo-api':'MiMo API（按量计费）','mimo-token-plan-cn':'MiMo Token Plan（中国集群）','api-key':'使用 API Key',account:'Harness 已有账号登录'});

export const ADVANCED_FIELDS = {groups:['template','templatePrompt','historyEnabled'],notes:['kind','tags'],memory:['recentLimit','ttlMinutes','groupContextLimit'],drive:['rootFolderId'],school:['pollSeconds'],realtime:['debounceSeconds'],monitor:['intervalMinutes','lookbackDays','maxMessages'],agent:['maxSteps']};
export const FIELD_SECTIONS = {
  speech:[['连接',['enabled','baseURL','mimoKey']],['声音',['model','voice','voiceDescription','style','autoStyle']],['回复方式',['autoReply','maxChars']]],
  bot:[['身份',['name','systemPrompt']],['管理',['ownerQQ']]],
  accounts:[['账号',['name','enabled']],['连接',['url','onebotToken']],['回复',['defaultProfileId']]],
  groups:[['群聊',['id','name','enabled']],['回复',['profileId']]],
  bindings:[['聊天',['accountId','kind','targetId']],['回复',['profileId','enabled']]],
  notes:[['范围',['note_account','note_profile','note_kind','targetId']],['内容',['text','enabled']]],
  realtime:[['接收',['enabled','accountId','groups']],['提醒',['recipientQQ','focus']]],
  monitor:[['整理',['enabled','groups','focus']],['推送',['notify','recipientQQ']]],
  school:[['连接',['enabled','username','password']],['提醒',['reminders']]],
  drive:[['连接',['enabled','authMode','accessMode','clientId','googleClientSecret']]],
  github:[['连接',['enabled','authMode','githubToken','defaultRepo']]],
  ai:[['模型',['backend','model','baseURL','apiModel','mimoModel','deepseekModel','deepseekThinking','harnessModel','harnessAuth','openaiKey','mimoKey','deepseekKey']]],
};

export function shapeSchema(schema,page,config={},state={}) {
  const value = name => { const f=schema.find(f=>f.key.endsWith('__'+name)); return f ? config[f.key]??f.default : undefined; };
  const auth=value('authMode'), backend=value('backend'), harnessAuth=value('harnessAuth');
  let result=schema.filter(f=>{
    if(f.key==='help')return false;
    const name=f.key.split('__').at(-1);
    if(page==='ai') {
      const fields={codex:['model'],api:['baseURL','apiModel','openaiKey'],'mimo-api':['mimoModel','mimoKey'],'mimo-token-plan-cn':['mimoModel','mimoKey'],deepseek:['deepseekModel','deepseekThinking','deepseekKey'],'deepseek-harness':['harnessModel','harnessAuth',...(harnessAuth==='account'?[]:['deepseekKey'])]};
      if(['model','baseURL','apiModel','openaiKey','mimoModel','mimoKey','deepseekModel','deepseekThinking','deepseekKey','harnessModel','harnessAuth'].includes(name) && !(fields[backend]||[]).includes(name))return false;
    }
    if(page==='drive' && auth!=='oauth' && ['clientId','googleClientSecret','accessMode'].includes(name))return false;
    if(page==='github' && auth!=='token' && name==='githubToken')return false;
    if(page==='speech' && (name==='voice' && value('model')==='mimo-v2.5-tts-voicedesign' || name==='voiceDescription' && value('model')!=='mimo-v2.5-tts-voicedesign'))return false;
    return true;
  }).map(f=>{
    const name=f.key.split('__').at(-1), advanced=(ADVANCED_FIELDS[page]||[]).includes(name);
    const item={...f,advanced,description:f.type==='number'?f.description:f.description||(/(?:Token|Key|Secret)$/.test(name)?'留空保留':'')};
    if((['backend','authMode','harnessAuth'].includes(name)||page==='speech'&&name==='model'||config.directory==='qq'&&['accountId','kind'].includes(name))&&f.type==='select')item.reactive=true;
    if(page==='ai'&&backend!=='codex'&&f.key.startsWith('action_'))item.options=f.options.filter(o=>['none','check/model'].includes(o.value));
    return item;
  });
  if(!config._expanded && result.some(f=>f.advanced)) {
    result.push({key:'more_ui',type:'boolean',label:'更多设置',default:Boolean(config.more_ui),reactive:true});
    if(!config.more_ui)result=result.filter(f=>!f.advanced);
  }
  const service={github:'github',drive:'drive',school:'ucloud',ai:'model'}[page], check=state.status?.checks?.[service];
  if(service) result.push({key:'service_status',type:'text',label:'连接状态',default:check?(check.ok?'连接正常':'连接失败'):'未检测',tone:check?(check.ok?'success':'danger'):'default',message:check?.message||''});
  return result;
}

export function scopeLabel(scope,settings={}) {
  const parts=String(scope||'').split(':'), account=parts[0]==='account'?settings.accounts?.find(a=>a.id===parts[1])?.name:'默认 QQ';
  const profileIndex=parts.indexOf('profile'), profile=profileIndex>=0?settings.profiles?.find(p=>p.id===parts[profileIndex+1])?.name:'';
  const kind=parts.includes('group')?'group':parts.includes('private')?'private':null;
  return [account,profile,kind?(kind==='group'?'群聊 ':'私聊 ')+parts[parts.indexOf(kind)+1]:'共享'].filter(Boolean).join(' · ');
}

export function presentSchema(schema, page) {
  const result = schema.map(field => {
    const item = { ...field }, key = field.key.split('__').at(-1);
    if (item.key === 'page') item.options = item.options.map(o => ({ ...o,label:PAGE_COPY[o.value].title }));
    const copy = fields[page]?.[key] || common[key];
    if (copy && item.key.includes('__') && item.type !== 'text') { item.label = copy[0]; item.description = copy[1]; }
    if (item.key.startsWith('resource_')) { item.label = '选择' + nouns[page]; item.options = item.options.map(o => o.value === 'new' ? { ...o,label:['groups','profiles','accounts','bindings','notes'].includes(page) ? '新增' + nouns[page] : '请选择' + nouns[page] } : o); }
    if (item.key.startsWith('operation_')) item.label = '操作';
    if (item.key.startsWith('action_')) item.label = '保存并执行';
    if (item.key === 'profile_section') item.label = '编辑哪部分';
    if (item.key.startsWith('note_account_') || item.key === 'memory_account') item.label = '记忆所属 QQ';
    if (item.key.startsWith('note_profile_')) item.label = '记忆所属角色';
    if (item.key.startsWith('note_kind_')) item.label = '在哪些聊天中使用';
    if (item.options && item.key !== 'page' && !/^(?:resource_|note_|memory_account|persona_note)/.test(item.key) && !['accountId','profileId','defaultProfileId','template'].includes(key)) item.options = item.options.map(o => ({ ...o,label:optionLabels[o.value] || o.label }));
    if (['profileId','defaultProfileId'].includes(key) && item.options) item.options = item.options.map(o => o.value === '' ? { ...o,label:'沿用默认角色' } : o);
    return item;
  });
  if (!fieldOrder[page]) return result;
  const editable = f => f.key.includes('__') && f.type !== 'text';
  const order = fieldOrder[page], sorted = result.filter(editable).sort((a,b) => {
    const rank = f => { const index = order.indexOf(f.key.split('__').at(-1)); return index < 0 ? order.length : index; };
    return rank(a) - rank(b);
  });
  let index = 0;
  return result.map(f => editable(f) ? sorted[index++] : f);
}
