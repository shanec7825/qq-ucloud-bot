import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider } from '@heroui/system';
import { Input, Textarea } from '@heroui/input';
import { Select, SelectItem } from '@heroui/select';
import { Switch } from '@heroui/switch';
import { Button } from '@heroui/button';
import { Spinner } from '@heroui/spinner';
import { PAGE_COPY, FIELD_SECTIONS } from '../../../napcat-plugin/webui/copy.mjs';
import { ContactPicker, SchoolReader, PersonaWorkspace } from './workspace.jsx';
import { PageNavigation, RecordList, FieldSections, StatusText } from './panels.jsx';
import { Icon, fieldStyle } from './controls.jsx';
import { MediaWorkspace, SpeechPreview } from './media.jsx';

const pluginId = location.pathname.split('/')[2];
async function api(operation, config) {
  let token;
  try { token = JSON.parse(localStorage.getItem('token') || 'null'); } catch {}
  if (typeof token !== 'string' || !token) throw Error('请先登录 NapCat，再打开插件设置。');
  const response = await fetch('/api/Plugin/ext/' + encodeURIComponent(pluginId) + '/settings-ui', {
    method:'POST', headers:{'content-type':'application/json',authorization:'Bearer ' + token}, body:JSON.stringify({operation,config}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '操作失败，请重新载入后重试。');
  return result;
}
async function hydrate(config, selectFirst = false) {
  config = {...config,_expanded:true};
  let { schema } = await api('schema',config);
  for (const field of schema) if (field.reactive && !Object.hasOwn(config,field.key)) config[field.key] = field.default;
  const list=schema.find(f=>f.key.startsWith('resource_'));
  if(selectFirst && list?.options.length>1)config[list.key]=list.options[1].value;
  ({ schema } = await api('schema',config));
  for (const field of schema) if (field.type !== 'text' && !Object.hasOwn(config,field.key)) config[field.key] = field.default;
  return {config,schema};
}

// In an extension iframe, inherit the actual NapCat theme without changing its DOM.
function connectTheme() {
  const media = matchMedia('(prefers-color-scheme:dark)');
  function sync() {
    let theme; try { theme = JSON.parse(localStorage.getItem('theme') || 'null'); } catch {}
    let dark = theme === 'dark' || theme !== 'light' && media.matches;
    if (window.parent !== window) {
      try {
        const root = parent.document.documentElement;
        dark = root.classList.contains('dark');
        const styles = parent.getComputedStyle(root);
        for (const property of styles) if (property.startsWith('--heroui-')) document.documentElement.style.setProperty(property,styles.getPropertyValue(property));
        document.body.style.fontFamily = parent.getComputedStyle(parent.document.body).fontFamily;
      } catch { /* Standalone and cross-origin views use the same component defaults. */ }
    }
    document.documentElement.classList.toggle('dark',dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }
  sync(); window.addEventListener('storage',sync); media.addEventListener('change',sync);
  let observer;
  try { if (parent !== window) { observer = new MutationObserver(sync); observer.observe(parent.document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']}); } } catch {}
  return () => { window.removeEventListener('storage',sync); media.removeEventListener('change',sync); observer?.disconnect(); };
}

const ACTION_LABELS={'check/drive':'检测连接','check/github':'检测连接','check/ucloud':'检测并同步','check/model':'检测模型','codex/login':'登录 ChatGPT','codex/account':'登录状态','google/authorize':'授权 Google','ucloud/login':'登录教学云','monitor/run':'立即整理'};
const READ_PAGES=['conversations','reports','inbox'];
const contextField=key=>key==='page'||/^(?:resource_|operation_|note_)/.test(key)||['memory_account','persona_note'].includes(key);

function App() {
  const [form,setForm]=useState(null),[busy,setBusy]=useState(true),[dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
  const current=useRef(null),working=useRef(false);
  const install=value=>{current.current=value;setForm(value);};
  useEffect(connectTheme,[]);
  useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  async function transaction(work){
    if(working.current)return;
    working.current=true;setBusy(true);setError(false);setMessage('');
    try{await work();}catch(e){setError(true);setMessage(e.message||'操作失败，请重试。');}
    finally{working.current=false;setBusy(false);}
  }
  async function load(page,resource){
    const result=await api('load');
    if(page&&result.schema[0].options.some(o=>o.value===page))result.config.page=page;
    if(resource)result.config['resource_'+page]=resource;
    install(await hydrate(result.config,!resource));setDirty(false);
  }
  useEffect(()=>{transaction(()=>load());},[]);
  async function change(field,value){
    if(working.current||busy)return;
    const before=current.current;
    if(contextField(field.key)&&dirty&&!confirm('放弃未保存的修改？'))return;
    if(field.reactive){
      await transaction(async()=>{
        const config=contextField(field.key)?field.key==='page'?{_session:before.config._session,page:value}:{_session:before.config._session,...Object.fromEntries(before.schema.filter(f=>f.reactive).map(f=>[f.key,before.config[f.key]])),[field.key]:value}:{...before.config,[field.key]:value};
        install(await hydrate(config,field.key==='page'));setDirty(!contextField(field.key)&&field.key!=='more_ui');
      });return;
    }
    const config={...before.config,[field.key]:value};
    if(/__(?:accountId|kind)$/.test(field.key)){
      for(const f of before.schema)if(f.key.endsWith('__targetId')||field.key.endsWith('__accountId')&&before.config.page==='realtime'&&/__groups$|__recipientQQ$/.test(f.key))config[f.key]='';
    }
    install({...before,config});setDirty(true);setMessage('');
  }
  async function persist(actionValue,overrides={}){
    await transaction(async()=>{
      const snapshot=current.current,action=snapshot.schema.find(f=>f.key.startsWith('action_'));
      const result=await api('save',{...snapshot.config,...overrides,...(actionValue&&action?{[action.key]:actionValue}:{})});
      setDirty(false);await load(snapshot.config.page,result.resource);
      setError(result.actionOK===false);setMessage(actionValue?result.result||'已完成':'已保存。');
    });
  }
  async function removeSelected(mode){
    if(!confirm(mode==='delete'?'删除所选记录？':'清空所选内容？'))return;
    await transaction(async()=>{
      const before=current.current,operation=before.schema.find(f=>f.key.startsWith('operation_'));
      const target=await hydrate({...before.config,[operation.key]:mode}),confirmField=target.schema.find(f=>f.key.endsWith('__confirm'));
      if(!confirmField)throw Error('请选择记录。');
      await api('save',{...target.config,[confirmField.key]:true});await load(before.config.page);setMessage(mode==='delete'?'已删除。':'已清空。');
    });
  }
  const fields=form?.schema||[],config=form?.config||{},page=config.page,copy=PAGE_COPY[page];
  const get=name=>{const field=fields.find(f=>f.key.endsWith('__'+name));return field?config[field.key]??field.default:undefined;};
  const pageField=fields.find(f=>f.key==='page'),resource=fields.find(f=>f.key.startsWith('resource_'));
  const resourceValue=resource?config[resource.key]??resource.default:'new';
  const operation=fields.find(f=>f.key.startsWith('operation_')),action=fields.find(f=>f.key.startsWith('action_'));
  const readOnly=READ_PAGES.includes(page),selected=resource?.options.find(o=>o.value===resourceValue);
  const systemKeys=new Set(['page','help','more_ui','directory','directory_error','service_status','result']);
  const statusField=fields.find(f=>f.key==='service_status');
  const contentFields=fields.filter(f=>!systemKeys.has(f.key)&&!f.key.startsWith('resource_')&&!f.key.startsWith('operation_')&&!f.key.startsWith('action_')&&!/_preview$/.test(f.key)&&!(page==='inbox'&&f.key.endsWith('__status')));
  const renderField=field=>{
    const value=config[field.key]??field.default,name=field.key.split('__').at(-1);
    if(field.type==='text'){
      if(field.key==='preview'&&['accounts','realtime'].includes(page))return null;
      return <div key={field.key} className={readOnly?'reader-body':'wide-field'}><StatusText field={field}/></div>;
    }
    const contact=name==='id'&&page==='groups'||name==='targetId'||['ownerQQ','recipientQQ'].includes(name)||name==='groups'&&['realtime','monitor'].includes(page);
    if(contact){
      const accountId=get('accountId')||(page==='notes'?config['note_account_'+resourceValue]:'')||'default';
      const kind=name==='id'||name==='groups'||name==='targetId'&&(page==='notes'?config['note_kind_'+resourceValue]:get('kind'))!=='private'?'groups':'friends';
      return <ContactPicker key={field.key+accountId+kind} label={field.label} value={value} accountId={accountId} kind={kind} multiple={name==='groups'} disabled={busy} onChange={(v,row)=>{
        if(row&&page==='groups'&&!get('name')){
          const before=current.current,nameField=fields.find(f=>f.key.endsWith('__name'));
          install({...before,config:{...before.config,[field.key]:v,...(nameField?{[nameField.key]:row.name}:{})}});setDirty(true);
        }else change(field,v);
      }}/>;
    }
    if(field.type==='boolean')return <div key={field.key} className="switch-row"><span id={field.key+'-label'}>{field.label}</span><Switch aria-labelledby={field.key+'-label'} isSelected={Boolean(value)} onValueChange={v=>change(field,v)} isDisabled={busy}/></div>;
    if(field.type==='select'||field.type==='multi-select'){
      if((['backend','authMode','kind','accessMode'].includes(name)||page==='speech'&&name==='model')&&field.options.length<=3)return <div key={field.key} className="choice-control"><span className="control-label">{field.label}</span><div className="segment-control" role="group" aria-label={field.label}>{field.options.map(o=><button type="button" key={JSON.stringify(o.value)} aria-pressed={value===o.value} disabled={busy} onClick={()=>change(field,o.value)}>{o.label}</button>)}</div></div>;
      const multiple=field.type==='multi-select';
      return <Select key={field.key} labelPlacement="outside" variant="bordered" label={field.label} aria-label={field.label} selectionMode={multiple?'multiple':'single'} selectedKeys={(multiple?value:[value]).map(v=>JSON.stringify(v))} disallowEmptySelection={!multiple} isDisabled={busy}
        classNames={{base:'min-w-0',label:'settings-label',trigger:'settings-select',value:'whitespace-normal break-words text-left'}} listboxProps={{className:'settings-listbox',itemClasses:{base:'py-3',title:'whitespace-normal break-words'}}}
        popoverProps={{shouldBlockScroll:false,disableAnimation:true,classNames:{content:'settings-popover'}}}
        onSelectionChange={keys=>{const values=[...keys].map(k=>JSON.parse(k));if(multiple||values.length)change(field,multiple?values:values[0]);}}>
        {field.options.map(o=><SelectItem key={JSON.stringify(o.value)}>{o.label}</SelectItem>)}
      </Select>;
    }
    const long=/(?:Prompt|text|summary|focus|style|voiceDescription)$/.test(name),Control=long?Textarea:Input;
    return <Control {...fieldStyle} key={field.key} className={long?'wide-field':undefined} label={field.label} aria-label={field.label} value={String(value??'')} minRows={long?4:undefined}
      description={/(?:Token|Key|Secret)$/.test(name)?'留空保留':field.type==='number'?field.description:undefined}
      type={field.type==='number'?'number':/(?:Token|Key|Secret|password)$/.test(name)?'password':'text'} autoComplete="off" isDisabled={busy}
      onValueChange={v=>change(field,field.type==='number'?Number(v):v)}/>;
  };
  const navigation=<PageNavigation field={pageField} value={page} busy={busy} onChange={value=>change(pageField,value)}/>;
  const feedback=<p id="feedback" role="status" aria-live="polite" className={'feedback '+(error?'error':'success')}>{message}</p>;
  if(!form)return <main className="settings-main" aria-label="插件设置">{busy&&<Spinner label="读取设置"/>}{feedback}{error&&<Button onPress={()=>transaction(()=>load())}>重试</Button>}</main>;
  if(page==='media')return <main className="settings-main" aria-label="插件设置">{navigation}<p id="description" className="sr-only">{copy.description}</p><MediaWorkspace onBusyChange={setBusy}/>{feedback}</main>;
  if(page==='profiles')return <main className="settings-main" aria-label="插件设置">{navigation}<p id="description" className="sr-only">{copy.description}</p>
    <PersonaWorkspace onDirtyChange={setDirty} onBusyChange={setBusy} onSaved={id=>load('profiles',id)} onAssign={id=>transaction(async()=>{
      await load('bindings','new');const next=current.current,role=next.schema.find(f=>f.key.endsWith('__profileId'));
      if(role){install({...next,config:{...next.config,[role.key]:id}});setDirty(true);}
    })}/>{feedback}
  </main>;
  const selectedRecord=resource&&resourceValue!=='new';
  const removals=selectedRecord?(operation?.options||[]).filter(o=>['delete','clear'].includes(o.value)):[];
  const visible=readOnly?contentFields.filter(f=>f.type==='text'):contentFields;
  const regular=visible.filter(f=>!f.advanced),advanced=visible.filter(f=>f.advanced);
  const status=fields.find(f=>page==='inbox'&&f.key.endsWith('__status'));
  const buttons=<div className="editor-actions">
    {!readOnly&&<Button data-save type="submit" color="primary" isLoading={busy} isDisabled={busy||page==='digests'&&!selectedRecord}>保存更改</Button>}
    <Button variant="light" startContent={<Icon name="refresh"/>} isDisabled={busy} onPress={()=>{if(!dirty||confirm('放弃未保存的修改？'))transaction(()=>load(page,resourceValue));}}>刷新</Button>
    {dirty&&<span className="dirty-indicator">未保存</span>}
    {removals.map(o=><Button key={o.value} className="remove-action" variant="light" color="danger" startContent={<Icon name="trash"/>} isDisabled={busy||page==='accounts'&&resourceValue==='default'} onPress={()=>removeSelected(o.value)}>{o.value==='delete'?'删除':'清空'}</Button>)}
  </div>;
  return <main className="settings-main" aria-label="插件设置">{navigation}<p id="description" className="sr-only">{copy.description}</p>
    <form onSubmit={event=>{event.preventDefault();persist();}} className={resource?'record-workspace':'single-workspace'}>
      {resource&&<RecordList key={page} field={resource} page={page} value={resourceValue} busy={busy} onChange={value=>change(resource,value)}/>}
      <div className={resource?'record-editor':'service-editor'}>
        {resource&&<h2 className="editor-title">{resourceValue==='new'?(readOnly?'选择记录':'新建'+copy.title):page==='notes'?'编辑记忆':selected?.label}</h2>}
        {statusField&&<StatusText field={statusField}/>}
        {status&&selectedRecord&&<div className="segment-control status-actions" role="group" aria-label="待办状态">{status.options.map(o=><button key={o.value} type="button" aria-pressed={get('status')===o.value} disabled={busy} onClick={()=>persist(undefined,{[status.key]:o.value,[operation.key]:'status'})}>{o.label}</button>)}</div>}
        {resource&&readOnly&&!selectedRecord?<p className="empty-label">暂无内容</p>:<>
          <FieldSections fields={regular} page={page} sections={FIELD_SECTIONS[page]} renderField={renderField}/>
          {advanced.length>0&&<details className="advanced-settings"><summary>更多设置</summary><div className="section-fields">{advanced.map(renderField)}</div></details>}
        </>}
        {action&&<div className="connection-actions">{action.options.filter(o=>o.value!=='none').map(o=><Button key={o.value} variant="bordered" isDisabled={busy} onPress={()=>persist(o.value)}>{ACTION_LABELS[o.value]||o.label}</Button>)}</div>}
        {feedback}
        {!message&&fields.find(f=>f.key==='result')&&<StatusText field={fields.find(f=>f.key==='result')}/>}
        {buttons}
        {page==='school'&&<SchoolReader disabled={busy||dirty}/>}
        {page==='speech'&&<SpeechPreview disabled={busy||dirty}/>}
      </div>
    </form>
  </main>;
}
createRoot(document.getElementById('root')).render(<HeroUIProvider locale="zh-CN"><App/></HeroUIProvider>);
