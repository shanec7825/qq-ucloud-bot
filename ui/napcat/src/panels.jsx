import React, { useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { PAGE_COPY } from '../../../napcat-plugin/webui/copy.mjs';
import { Icon } from '../../shared/Icon.jsx';
import { StatusPill } from '../../shared/StatusPill.jsx';
import { searchStyle } from './controls.jsx';

export const PAGE_ICONS = {chat:'contacts',profiles:'user',bot:'globe',bindings:'contacts',groups:'users',accounts:'contacts',ai:'sparkles',media:'image',speech:'mic',agent:'shield',library:'folder',notes:'book',memory:'bot',history:'clock',digests:'list',conversations:'mail',github:'cube',drive:'cloud',school:'book',realtime:'bell',monitor:'clock',inbox:'check',reports:'list'};

export function WorkspaceShell({ navigation, page, hideHeading = false, children }) {
  const copy=PAGE_COPY[page];
  return <main className={'settings-main'+(!navigation?' standalone-workspace':'')} aria-label="插件设置">
    {navigation}
    <section className="workspace-content" role="tabpanel" id="workspace-panel" aria-labelledby={navigation?'nav-'+page:undefined} aria-label={!navigation?copy?.title:undefined}>
      {!hideHeading&&<header className="workspace-heading"><span className="workspace-heading-icon"><Icon name={PAGE_ICONS[page]||'cog'} size={23}/></span><div><h1>{copy?.title}</h1><p id="description">{page==='profiles'?'默认设定与专属角色':page==='school'?'作业与通知':copy?.description}</p></div></header>}
      {children}
    </section>
  </main>;
}

export function PageNavigation({ field, value, busy, onChange }) {
  if (!field) return null;
  const groups=[];
  for(const option of field.options){const name=['accounts','ai','agent','library'].includes(option.value)?'设置':PAGE_COPY[option.value]?.group||'设置';let group=groups.find(g=>g.name===name);if(!group){group={name,options:[]};groups.push(group);}group.options.push(option);}
  return <nav className={'workspace-navigation'+(field.options.length===1?' single-navigation':'')} aria-label="功能导航">
    <div className="navigation-brand"><img src="../files/ui/qlyra.png" width="29" height="29" alt=""/><span>Qlyra</span></div>
    <div className="page-tabs" role="tablist" aria-label="设置分类" aria-orientation="vertical" onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      const buttons=[...event.currentTarget.querySelectorAll('[role=tab]:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length;
      event.preventDefault();buttons[next]?.focus();
    }}>
      {groups.map(group=>{const Tag=group.name==='设置'?'details':'div';return <Tag className="navigation-group" role="presentation" key={group.name} open={group.name==='设置'&&group.options.some(option=>option.value===value)?true:undefined}>{group.name==='设置'?<summary><Icon name="cog"/>设置</summary>:<span className="navigation-group-label">{group.name}</span>}{group.options.map(option=><button type="button" id={'nav-'+option.value} key={option.value} role="tab" aria-controls="workspace-panel" aria-selected={value===option.value} tabIndex={value===option.value?0:-1} disabled={busy} onClick={()=>onChange(option.value)}><Icon name={PAGE_ICONS[option.value]||'cog'}/><span>{option.label}</span></button>)}</Tag>;})}
    </div>
  </nav>;
}

export function RecordList({ field, value, page, busy, onChange }) {
  const [query,setQuery] = useState('');
  const canCreate=['groups','accounts','bindings','notes'].includes(page);
  const records=field.options.filter(o=>o.value!=='new');
  const filtered=records.filter(o=>(o.label+' '+(o.description||'')).toLowerCase().includes(query.toLowerCase()));
  return <section className="record-library" aria-label={field.label}>
    <div className="library-heading"><h2>{PAGE_COPY[page].title}<span className="record-count">{records.length}</span></h2>
      {canCreate&&<Button size="sm" variant="light" className="new-record" startContent={<Icon name="plus"/>} isDisabled={busy} onPress={()=>{setQuery('');onChange('new');}}>新建</Button>}
    </div>
    <Input {...searchStyle} size="sm" aria-label="搜索记录" placeholder="搜索名称或号码" value={query} onValueChange={setQuery}/>
    <div className="record-list" role="group" aria-label="记录列表">
      {filtered.map(row=><button key={row.value} type="button" className="record-row" aria-pressed={row.value===value} disabled={busy} onClick={()=>onChange(row.value)}>
        <span className="record-name">{row.label}</span>
        {row.description&&<span className="record-description">{row.description}</span>}
        {row.badge&&<span className="record-badge">{row.badge}</span>}
      </button>)}
    </div>
    {!filtered.length&&<p className="empty-label">{records.length?'无匹配记录':'暂无记录'}</p>}
  </section>;
}

export function FieldSections({ fields, page, sections, renderField }) {
  const assigned=new Set();
  const groups=(sections||[]).map(([title,names])=>({title,fields:fields.filter(field=>{
    const name=field.key.split('__').at(-1);
    const hit=names.includes(name)||names.some(key=>field.key.startsWith(key+'_'));
    if(hit)assigned.add(field.key);return hit;
  })}));
  const rest=fields.filter(field=>!assigned.has(field.key));
  if(rest.length)groups.push({title:'',fields:rest});
  return <div className="field-sections" id="fields">
    {groups.filter(group=>group.fields.length).map((group,index)=><section key={group.title||index} className="field-section" aria-label={group.title||PAGE_COPY[page]?.title}>
      {group.title&&groups.length>1&&group.title!==PAGE_COPY[page]?.title&&<h2 className="section-label">{group.title}</h2>}
      <div className="section-fields">{group.fields.map(renderField)}</div>
    </section>)}
  </div>;
}

export function StatusText({ field }) {
  const links=String(field.default||'').match(/https:\/\/[^\s]+/g)||[];
  if(field.key==='service_status'||field.appearance==='status')return <div className="status-line"><StatusPill tone={field.tone||'default'}>{field.default}</StatusPill>{field.tone==='danger'&&field.message&&<p className="text-small text-danger mt-2">{field.message}</p>}</div>;
  return <div className="text-small whitespace-pre-wrap break-words text-default-600">{field.default}{links.map(url=><a className="block text-primary underline" key={url} href={url} target="_blank" rel="noopener noreferrer">打开授权页</a>)}</div>;
}
