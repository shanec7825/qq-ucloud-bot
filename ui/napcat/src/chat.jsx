import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { Icon } from '../../shared/Icon.jsx';
import { bridgeRequest } from './workspace.jsx';
import { confirmAction } from './confirm.js';
import { searchStyle } from './controls.jsx';
import './chat.css';

const modes = [{ id: 'normal', name: '普通', icon: 'user', description: '仅人格设定' }, { id: 'memory', name: '记忆', icon: 'book', description: '从交流中自动学习' }];
const stamp = value => { const numeric = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN; const date = new Date(Number.isFinite(numeric) ? numeric < 1e12 ? numeric * 1000 : numeric : value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

export function ChatWorkspace({ api = bridgeRequest, onBusyChange = () => {}, onDirtyChange = () => {} }) {
  const [data, setData] = useState(null), [rules, setRules] = useState([]), [defaultMode, setDefaultMode] = useState('normal');
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [tab, setTab] = useState('contacts');
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const live = useRef(true), lock = useRef(false);
  useEffect(() => { live.current = true; load().catch(error => { if (live.current) { setMessage(error.message); setFailed(true); } }); return () => { live.current = false; }; }, []);
  function mark() { setDirty(true); onDirtyChange(true); setMessage(''); }
  async function load() {
    const result = await api('GET', 'chat'); if (!live.current) return;
    setData(result); setRules(result.settings.chat.memoryContacts); setDefaultMode(result.settings.chat.defaultMode);
    setDirty(false); onDirtyChange(false);
    setSelected(old => old || result.contacts[0]?.id || result.settings.chat.memoryContacts[0]?.id || '');
  }
  async function run(work) {
    if (lock.current) return; lock.current = true; setBusy(true); onBusyChange(true); setMessage(''); setFailed(false);
    try { await work(); } catch (error) { if (live.current) { setFailed(true); setMessage(error.message); } }
    finally { lock.current = false; if (live.current) { setBusy(false); onBusyChange(false); } }
  }
  const contacts = new Map((data?.contacts || []).map(row => [row.id, row]));
  for (const row of rules) if (!contacts.has(row.id)) contacts.set(row.id, { id: row.id, name: row.id });
  const chosen = contacts.get(selected), rule = rules.find(row => row.id === selected), mode = rule?.mode || defaultMode;
  function edit(change) { if (!selected) return; const next = { id: selected, mode, profileId: rule?.profileId || '', ...change }; setRules(rows => [...rows.filter(row => row.id !== selected), next]); mark(); }
  function add() { const id = query.trim(); if (!/^\d{5,15}$/.test(id)) { setFailed(true); setMessage('输入好友 QQ，或从好友列表选择。'); return; } if (!contacts.has(id)) { setRules(rows => [...rows, { id, mode: defaultMode, profileId: '' }]); mark(); } setSelected(id); setQuery(''); }
  async function refreshContacts() {
    const result = await api('POST', 'qq/contacts', { all: true });
    if (!live.current) return;
    setData(old => ({ ...old, contacts: [...new Map([...(old?.contacts || []), ...(result.friends || [])].map(row => [row.id, row])).values()] }));
    if (result.errors?.length) setMessage(result.errors.join(' '));
  }
  const learned = (data?.memory?.items || []).filter(row => row.contactId === selected);
  const conversations = (data?.conversations || []).filter(row => row.scope === 'private:' + selected || row.scope.endsWith(':private:' + selected));
  return <div className="chat-workspace">
    <div className="chat-toolbar"><div className="segment-control" role="group" aria-label="chat 页面"><button type="button" aria-pressed={tab === 'contacts'} onClick={() => setTab('contacts')}><Icon name="contacts"/>联系人</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}><Icon name="clock"/>会话</button></div><Button variant="light" size="sm" startContent={<Icon name="refresh"/>} isDisabled={busy || dirty} onPress={() => run(load)}>刷新</Button></div>
    <div className="chat-columns"><aside className="chat-contact-list" aria-label="聊天对象">
      <Input {...searchStyle} aria-label="搜索或添加联系人" placeholder="搜索 / 输入好友 QQ" value={query} onValueChange={setQuery}/>
      <div className="chat-contact-tools"><Button size="sm" variant="flat" startContent={<Icon name="contacts"/>} isDisabled={!data || busy} onPress={() => run(refreshContacts)}>好友列表</Button><Button size="sm" variant="light" startContent={<Icon name="plus"/>} isDisabled={!data || busy} onPress={add}>添加</Button></div>
      {[...contacts.values()].filter(row => (row.name + row.id).toLowerCase().includes(query.toLowerCase())).map(row => <button className="chat-contact" type="button" key={row.id} aria-pressed={selected === row.id} disabled={busy} onClick={() => setSelected(row.id)}><span className="persona-avatar"><Icon name={(rules.find(rule => rule.id === row.id)?.mode || defaultMode) === 'memory' ? 'book' : 'user'}/></span><span><strong>{row.name}</strong><small>{row.name !== row.id ? row.id : (rules.find(rule => rule.id === row.id)?.mode || defaultMode) === 'memory' ? '自动记忆' : '仅人格'}</small></span></button>)}
      {!contacts.size && <p className="empty-label">选择好友，开始配置</p>}
      <details className="chat-defaults"><summary>新联系人</summary><div className="segment-control" role="group" aria-label="新联系人模式">{modes.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={defaultMode === item.id} onClick={() => { setDefaultMode(item.id); mark(); }}>{item.name}</button>)}</div></details>
    </aside><section className="chat-contact-editor" aria-label={tab === 'contacts' ? '联系人设置' : '会话与记忆'}>
      {!chosen ? <div className="chat-empty"><Icon name="contacts" size={32}/><p>选择一个聊天对象</p></div> : <><div className="chat-editor-heading"><h2>{chosen.name}</h2><span className="role-scope"><Icon name={mode === 'memory' ? 'book' : 'user'}/>{mode === 'memory' ? '自动记忆' : '仅人格'}</span></div>
      {tab === 'contacts' ? <><div className="chat-mode-options" role="group" aria-label="联系人模式">{modes.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={mode === item.id} onClick={() => edit({ mode: item.id })}><Icon name={item.icon} size={25}/><strong>{item.name}</strong><small>{item.description}</small></button>)}</div>
        <label className="chat-profile-label">角色<select aria-label="联系人角色" disabled={busy} value={rule?.profileId || ''} onChange={event => edit({ profileId: event.target.value })}><option value="">默认全局角色 · {data.settings.bot.name}</option>{data.settings.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <div className="chat-memory-peek"><Icon name="book"/><span>{learned.length} 条已学记忆</span><Button size="sm" variant="light" onPress={() => setTab('history')}>查看</Button></div>
      </> : <div className="chat-timeline"><div className="chat-editor-heading"><h3>记忆</h3><Button size="sm" color="danger" variant="light" isDisabled={busy || dirty} startContent={<Icon name="trash"/>} onPress={() => { if (confirmAction('清空这个联系人的已学记忆和近期会话？')) run(async () => { await api('DELETE', 'chat/memory', { contactId: selected }); await load(); setMessage('已清空'); }); }}>清空</Button></div>
        {!learned.length && <p className="empty-label">{mode === 'memory' ? '交流中会自动学习稳定偏好与事实' : '普通模式不使用记忆'}</p>}
        {learned.map(row => <article key={row.scope + row.id} className="chat-memory-item"><Icon name="book"/><div><p>{row.text}</p><small>{stamp(row.updatedAt)}</small><details><summary>来源</summary>{(row.sources || []).map((source, index) => <p key={index}>{source.evidence || source.text || source.excerpt || '聊天自述'} {stamp(source.observedAt || source.time || source.at)}</p>)}</details></div></article>)}
        <h3><Icon name="mail"/>近期对话</h3>{!conversations.length && <p className="empty-label">暂无会话记录</p>}{conversations.flatMap(row => row.entries.map((entry, index) => <article className="chat-message" key={row.scope + index}><small>{entry.speaker || entry.role} · {stamp(entry.at || entry.time)}</small><p>{entry.text || entry.content}</p></article>))}
        <details><summary>群聊摘要</summary>{(data?.digests || []).filter(row => row.digest?.summary || row.digest?.text).map(row => <article className="chat-message" key={row.groupId}><strong>{row.name || row.groupId}</strong><p>{row.digest.summary || row.digest.text}</p></article>)}</details>
      </div>}</>}
    </section></div>
    {message && <p role={failed ? 'alert' : 'status'} className={'feedback ' + (failed ? 'error' : 'success')}>{message}</p>}
    <div className="editor-actions"><Button color="primary" isDisabled={!data || busy || !dirty} isLoading={busy} startContent={<Icon name="check"/>} onPress={() => run(async () => { await api('PUT', 'chat', { revision: data.settings.revision, defaultMode, memoryContacts: rules }); await load(); setMessage('已保存'); })}>保存更改</Button>{dirty && <span className="dirty-indicator">未保存</span>}<span className="chat-shared-label"><Icon name="globe"/>所有登录 QQ 共用设置</span></div>
  </div>;
}
