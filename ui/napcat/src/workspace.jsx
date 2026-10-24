import { confirmAction } from './confirm.js';
import React, { useEffect, useState } from 'react';
import { Button } from '@heroui/button';
import { Input, Textarea } from '@heroui/input';
import { Icon, fieldStyle, searchStyle } from './controls.jsx';

export async function bridgeRequest(method, path, value) {
  let token;
  try { token = JSON.parse(localStorage.getItem('token') || 'null'); } catch {}
  if (!token) throw Error('请先登录 NapCat。');
  const pluginId = location.pathname.split('/')[2];
  const response = await fetch('/api/Plugin/ext/' + encodeURIComponent(pluginId) + '/bridge', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ method, path, value }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '读取失败，请稍后重试。');
  return result;
}

export function PersonaWorkspace({ onDirtyChange, onBusyChange, onSaved, onAssign }) {
  const globalId = '@global';
  const [settings, setSettings] = useState(null), [selected, setSelected] = useState(globalId), [name, setName] = useState(''), [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const mark = value => { setDirty(value); onDirtyChange(value); setMessage(''); };
  useEffect(() => { let active = true; bridgeRequest('GET','state').then(result => { if(active) { setSettings(result.settings); setName(result.settings.bot.name); setPrompt(result.settings.bot.systemPrompt); } }).catch(e => { if(active) { setError(true); setMessage(e.message); } }); return () => { active = false; }; }, []);
  const isGlobal = selected === globalId;
  const profile = settings?.profiles.find(p => p.id === selected);
  const uses = settings ? settings.groups.filter(g=>g.profileId===selected).length + settings.bindings.filter(b=>b.profileId===selected).length + settings.accounts.filter(a=>a.defaultProfileId===selected).length + (settings.chat?.memoryContacts.filter(contact=>contact.profileId===selected).length || 0) : 0;
  function choose(p) {
    if (dirty && !confirmAction('放弃未保存的修改？')) return;
    setSelected(p?.id || 'new'); setName(p?.name || ''); setPrompt(p?.systemPrompt || ''); if(!p)setQuery(''); mark(false);setError(false);
  }
  async function reload() {
    if(dirty&&!confirmAction('放弃未保存的修改？'))return;
    setBusy(true);onBusyChange(true);setMessage('');setError(false);
    try{const fresh=(await bridgeRequest('GET','state')).settings,p=isGlobal?{id:globalId,...fresh.bot}:fresh.profiles.find(p=>p.id===selected);setSettings(fresh);setSelected(p?.id||'new');setName(p?.name||'');setPrompt(p?.systemPrompt||'');setDirty(false);onDirtyChange(false);await onSaved(p?.id===globalId?'new':p?.id||'new');}
    catch(e){setError(true);setMessage(e.message);}
    finally{setBusy(false);onBusyChange(false);}
  }
  async function save(remove = false) {
    if (!settings || busy) return;
    if (remove && (!profile || !confirmAction('删除“' + profile.name + '”？'))) return;
    if (!remove && !name.trim()) { setError(true); setMessage('请填写名称。'); return; }
    setBusy(true); onBusyChange(true); setError(false); setMessage('');
    try {
      const id = isGlobal ? globalId : profile?.id || crypto.randomUUID().replaceAll('-','');
      const next = structuredClone(settings);
      if (isGlobal) next.bot = {...next.bot,name:name.trim(),systemPrompt:prompt};
      else if (remove) next.profiles = next.profiles.filter(p=>p.id!==selected);
      else { const record = {...(profile || {model:''}),id,name:name.trim(),systemPrompt:prompt}; const index=next.profiles.findIndex(p=>p.id===id); if(index<0)next.profiles.push(record); else next.profiles[index]=record; }
      const result = await bridgeRequest('PUT','settings',{settings:next,revision:settings.revision});
      const fresh = result.settings || (await bridgeRequest('GET','state')).settings;
      setSettings(fresh); setSelected(remove?'new':id); setName(remove?'':isGlobal?fresh.bot.name:fresh.profiles.find(p=>p.id===id)?.name||name); if(remove)setPrompt(''); setDirty(false); onDirtyChange(false);
      await onSaved(remove||isGlobal?'new':id); setMessage(remove?'已删除':'已保存');
    } catch(e) { setError(true); setMessage(e.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="persona-workspace">
    <section className="persona-library" aria-label="角色列表">
      <div className="library-heading"><h2>角色<span className="record-count">{settings ? settings.profiles.length + 1 : 0}</span></h2><Button size="sm" variant="light" className="new-record" startContent={<Icon name="plus"/>} isDisabled={busy || !settings} onPress={()=>choose()}>新建</Button></div>
      <Input {...searchStyle} size="sm" aria-label="搜索角色" placeholder="搜索角色" value={query} onValueChange={setQuery}/>
      <div className="persona-list">
        {settings && ('默认全局角色 '+settings.bot.name).toLowerCase().includes(query.toLowerCase()) && <button type="button" className="persona-row global-role" aria-pressed={isGlobal} onClick={()=>choose({id:globalId,...settings.bot})} disabled={busy}><span className="persona-avatar"><Icon name="globe"/></span><span className="min-w-0"><span className="block">默认全局角色</span><span className="record-description">{settings.bot.name}</span></span></button>}
        {settings?.profiles.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=><button type="button" key={p.id} className="persona-row" aria-pressed={selected===p.id} onClick={()=>choose(p)} disabled={busy}><span className="persona-avatar" aria-hidden="true">{[...p.name][0]}</span><span className="min-w-0 break-words">{p.name}</span></button>)}
      </div>
      {settings && !('默认全局角色 '+settings.bot.name).toLowerCase().includes(query.toLowerCase()) && !settings.profiles.some(p=>p.name.toLowerCase().includes(query.toLowerCase())) && <p className="empty-label">没有匹配角色</p>}
    </section>
    <section className="persona-editor" aria-label="角色编辑">
      <div className="persona-heading"><h2 className="editor-title">{isGlobal?'默认全局角色':selected==='new'?'新建角色':profile?.name || '编辑角色'}</h2>{isGlobal?<span className="role-scope"><Icon name="globe"/>未指定角色时使用</span>:profile && uses>0 && <span className="usage-label">{uses} 处使用中</span>}</div>
      <div className="persona-fields"><Input {...fieldStyle} label="名称" aria-label="名称" value={name} maxLength={40} isDisabled={busy || !settings} onValueChange={v=>{setName(v);mark(true);}}/>
      <Textarea {...fieldStyle} className="prompt-field" label="系统提示词" aria-label="系统提示词" placeholder="自由描述身份、性格、语气和回答方式。" minRows={9} maxRows={24} maxLength={12000} value={prompt} isDisabled={busy || !settings} onValueChange={v=>{setPrompt(v);mark(true);}}/></div>
      <p role="status" className={'feedback '+(error?'error':'success')}>{message}</p>
      <div className="editor-actions"><Button color="primary" startContent={<Icon name="check"/>} isLoading={busy} isDisabled={!settings || busy} onPress={()=>save()}>保存角色</Button>{!isGlobal&&<Button variant="flat" isDisabled={!profile || busy || dirty} onPress={()=>onAssign(selected)}>分配角色</Button>}<Button variant="light" startContent={<Icon name="refresh"/>} isDisabled={busy} onPress={reload}>刷新</Button>{dirty && <span className="dirty-indicator">未保存</span>}{!isGlobal&&<Button className="remove-action" variant="light" color="danger" startContent={<Icon name="trash"/>} isDisabled={!profile || busy || uses>0} onPress={()=>save(true)}>删除角色</Button>}</div>
    </section>
  </div>;
}

export function ContactPicker({ label, value, onChange, accountId, all = false, multiple = false, kind = 'friends', disabled, description }) {
  const [rows, setRows] = useState(null), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const selected = String(value || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
  async function load() {
    setBusy(true); setError('');
    try { const result = await bridgeRequest('POST', 'qq/contacts', all ? { all: true } : { accountId }); setRows(result[kind] || []); setError((result.errors || []).join(' ')); }
    catch (e) { setRows(null); setError(e.message); }
    finally { setBusy(false); }
  }
  function choose(row) {
    onChange(multiple ? selected.includes(row.id) ? selected.filter(id => id !== row.id).join(', ') : [...selected, row.id].join(', ') : row.id, row);
    if (!multiple) setRows(null);
  }
  return <div className="contact-picker space-y-2">
    <Input {...fieldStyle} label={label} aria-label={label} value={String(value || '')} onValueChange={onChange} isDisabled={disabled}
      description={description || (multiple ? '支持多选，或用逗号分隔群号' : undefined)} inputMode={multiple ? 'text' : 'numeric'} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="flat" startContent={<Icon name="contacts"/>} isDisabled={disabled} isLoading={busy} onPress={load}>{rows === null ? (kind === 'groups' ? '从群列表选择' : '从好友列表选择') : '刷新列表'}</Button>
      {rows !== null && <Button size="sm" variant="light" onPress={() => setRows(null)}>收起列表</Button>}
    </div>
    {error && <p role="alert" className="text-small text-danger">{error} 可继续手动填写。</p>}
    {rows !== null && <div className="choice-panel space-y-2">
      <Input {...searchStyle} size="sm" aria-label={'搜索' + (kind === 'groups' ? '群' : '好友')} placeholder="搜索名称或号码" value={query} onValueChange={setQuery}/>
      <div className="choice-list" role="group" aria-label={label + '选择列表'}>
        {rows.filter(row => (row.name + ' ' + row.id).toLowerCase().includes(query.toLowerCase())).map(row => <button key={row.id} type="button" className="choice-row" aria-pressed={selected.includes(row.id)} onClick={() => choose(row)}>
          <span className="choice-mark" aria-hidden="true"><Icon name={selected.includes(row.id) ? 'check' : 'plus'}/></span><span><span className="block">{row.name}</span><span className="text-tiny text-default-500">{row.id}</span></span>
        </button>)}
        {!rows.length && <p className="text-small text-default-500 p-3">没有可选记录。请确认该 QQ 在线，或直接填写号码。</p>}
        {!!rows.length && !rows.some(row => (row.name + ' ' + row.id).toLowerCase().includes(query.toLowerCase())) && <p className="text-small text-default-500 p-3">没有匹配结果，试试号码或更短的名称。</p>}
      </div>
    </div>}
  </div>;
}

export function SchoolReader({ disabled }) {
  const [section, setSection] = useState('tasks'), [data, setData] = useState(null), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function load(next = section, page = 1) {
    setBusy(true); setError(''); setDetail(null); setData(null); setSection(next);
    try { setData(await bridgeRequest('POST', 'ucloud/view', { section: next, ...(next === 'notices' ? { page } : {}) })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function open(item) {
    setDetail(null); setError('');
    if (section === 'notices') { setDetail({ title: item.title, content: item.content || '通知没有文字内容。' }); return; }
    if (item.type !== 3) { setDetail({ title: item.title, content: `课程：${item.course}\n截止：${item.deadline || '未提供'}\n问卷和测验请通过下方教学云官网查看和完成。` }); return; }
    setBusy(true);
    try { const result = await bridgeRequest('POST', 'ucloud/view', { section: 'detail', id: item.id }); setDetail({ title: item.title, content: result.content }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="school-reader space-y-3" aria-label="教学云消息阅读">
    <h2 className="text-base font-semibold">教学云消息</h2>
    <div className="flex flex-wrap gap-2"><Button variant={section === 'tasks' && data ? 'solid' : 'flat'} isDisabled={disabled || busy} onPress={() => load('tasks')}>查看待交作业</Button><Button variant={section === 'notices' && data ? 'solid' : 'flat'} isDisabled={disabled || busy} onPress={() => load('notices')}>查看教学云通知</Button></div>
    {busy && <p role="status" className="text-small">正在读取教学云…</p>}
    {error && <p role="alert" className="text-small text-danger">{error}</p>}
    {data && <div className="school-items">
      {!data.items.length && <p className="text-small text-default-500 p-3">{section === 'tasks' ? '当前没有未完成待办。' : '这一页没有教学云通知。'}</p>}
      {data.items.map(item => <button type="button" key={item.id} className="school-item" disabled={busy || disabled} onClick={() => open(item)}>
        <span className="block font-medium">{item.unread && <span className="text-primary">未读 · </span>}{item.title}</span>
        <span className="block text-small text-default-500">{section === 'tasks' ? `${item.course} · ${item.deadline ? '截止 ' + item.deadline : '未提供截止时间'}` : item.time}</span>
        {section === 'tasks' && item.type !== 3 && <span className="block text-tiny text-default-500">问卷 / 测验请在教学云完成</span>}
      </button>)}
    </div>}
    {data && section === 'notices' && <div className="flex flex-wrap items-center gap-2"><Button size="sm" isDisabled={busy || data.page <= 1} onPress={() => load('notices', data.page - 1)}>上一页</Button><span className="text-small">第 {data.page} 页，共 {data.total} 条</span><Button size="sm" isDisabled={busy || data.page * 20 >= data.total} onPress={() => load('notices', data.page + 1)}>下一页</Button></div>}
    {detail && <article className="school-detail space-y-3" aria-label="消息正文"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold break-words">{detail.title}</h3><Button size="sm" variant="light" onPress={() => setDetail(null)}>收起正文</Button></div><p className="whitespace-pre-wrap break-words text-small leading-relaxed">{detail.content}</p></article>}
    <a className="text-small text-primary underline" href="https://ucloud.bupt.edu.cn/uclass/" target="_blank" rel="noopener noreferrer">打开教学云官网</a>
  </section>;
}
