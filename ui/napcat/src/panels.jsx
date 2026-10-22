import React, { useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { PAGE_COPY } from '../../../napcat-plugin/webui/copy.mjs';
import { Icon } from '../../shared/Icon.jsx';
import { StatusPill } from '../../shared/StatusPill.jsx';
import { searchStyle } from './controls.jsx';

export function PageNavigation({ field, value, busy, onChange }) {
  if (!field) return null;
  if (field.options.length === 1) return <h1 className="page-title">{PAGE_COPY[value]?.title}</h1>;
  return <div className="page-tabs" role="tablist" aria-label="设置分类" onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...event.currentTarget.querySelectorAll('[role=tab]')],index=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    event.preventDefault();buttons[next]?.focus();
  }}>
    {field.options.map(option => <Button key={option.value} role="tab" aria-selected={value === option.value}
      tabIndex={value===option.value?0:-1} size="sm" variant="light"
      isDisabled={busy} onPress={() => onChange(option.value)}>{option.label}</Button>)}
  </div>;
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
