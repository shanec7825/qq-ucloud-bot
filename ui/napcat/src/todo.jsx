import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { Icon } from '../../shared/Icon.jsx';
import { bridgeRequest } from './workspace.jsx';
import { searchStyle } from './controls.jsx';
import { confirmAction } from './confirm.js';
import './todo.css';

const tabs = [{ id: 'realtime', label: '通知', icon: 'bell' }, { id: 'inbox', label: '待办', icon: 'check' }, { id: 'reports', label: '整理', icon: 'archive' }];
const statuses = [{ id: 'pending', label: '待办' }, { id: 'done', label: '已完成' }, { id: 'archived', label: '归档' }];
function dateLabel(value) {
  if (!value) return '';
  const number = /^\d+$/.test(String(value)) ? Number(value) : NaN;
  const date = new Date(Number.isFinite(number) ? number < 1e12 ? number * 1000 : number : value);
  return Number.isNaN(date.valueOf()) ? String(value).slice(0, 40) : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function grouped(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.groupId)) groups.set(item.groupId, { groupId: item.groupId, groupName: item.groupName || '群 ' + item.groupId, items: [] });
    groups.get(item.groupId).items.push(item);
  }
  return [...groups.values()];
}

function CalendarComposer({ item, api, onClose }) {
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [allDay, setAllDay] = useState(false), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  function edit(set, value) { set(value); setPreview(null); setError(''); }
  async function generate() {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await api('POST', 'inbox/calendar', { id: item.id, start: allDay ? start : start ? start + '+08:00' : '', end: allDay ? end : end ? end + '+08:00' : '', allDay })); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function download() {
    try {
      if (parent !== window && parent.location.origin === location.origin) {
        if (typeof parent.__qqAgentDownloadCalendar !== 'function') throw Error('请重新打开插件页面后下载。');
        parent.__qqAgentDownloadCalendar(preview.ics, preview.filename);
      } else {
        const url = URL.createObjectURL(new Blob([preview.ics], { type: 'text/calendar;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = preview.filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { setError(error.message || '下载未启动，请重试。'); }
  }
  return <section className="todo-calendar" aria-label="日历预览">
    <div className="todo-calendar-heading"><h4><Icon name="clock"/>加入日历</h4><Button size="sm" variant="light" onPress={onClose}>收起</Button></div>
    {item.deadlineText && <p className="todo-calendar-source">时间原文：{item.deadlineText}</p>}
    <div className="todo-calendar-fields"><label>开始<input type={allDay ? 'date' : 'datetime-local'} value={start} onChange={event => edit(setStart, event.target.value)} disabled={busy}/></label>
      <label>{allDay ? '结束日期（不含）' : '结束'}<input type={allDay ? 'date' : 'datetime-local'} value={end} onChange={event => edit(setEnd, event.target.value)} disabled={busy}/></label></div>
    <div className="todo-calendar-options"><label><input type="checkbox" checked={allDay} disabled={busy} onChange={event => { setAllDay(event.target.checked); setStart(''); setEnd(''); setPreview(null); }}/><span>全天</span></label><span>北京时间 · 请确认日期</span></div>
    <Button size="sm" variant="bordered" isLoading={busy} isDisabled={busy || !start || !end} onPress={generate}>预览日程</Button>
    {error && <p className="todo-error" role="alert">{error}</p>}
    {preview && <div className="todo-calendar-preview"><strong>{preview.title}</strong><p>{start.replace('T', ' ')} → {end.replace('T', ' ')}{allDay ? ' · 全天' : ' · 北京时间'}</p><p className="todo-calendar-description">{preview.description}</p>
      <div className="todo-calendar-actions"><a href={preview.googleUrl} target="_blank" rel="noopener noreferrer"><Icon name="external"/>打开 Google Calendar</a><Button size="sm" variant="light" startContent={<Icon name="download"/>} onPress={download}>下载 ICS</Button></div><small>打开日程草稿后，需在 Google Calendar 确认保存。</small>
    </div>}
  </section>;
}

function NoticeCard({ item, todo, busy, onAdd, onStatus, onCalendar, calendarOpen, api }) {
  const added = item.inTodo || todo;
  return <article className={'todo-notice-card' + (item.status === 'done' ? ' is-done' : '')}>
    <div className="todo-card-line"><h3>{item.title}</h3><time>{dateLabel(item.createdAt)}</time></div>
    <p className="todo-card-summary">{item.summary}</p>
    {item.deadlineText && <span className="todo-deadline"><Icon name="clock"/>{item.deadlineText}</span>}
    <div className="todo-card-bottom"><details className="todo-sources" open={item.outputFormat==='detailed'}><summary>原文依据<span>{item.sources?.length || 0}</span></summary><div>{(item.sources || []).map((source, index) => <blockquote key={index}>{source.excerpt}{source.time && <cite>{dateLabel(source.time)}</cite>}</blockquote>)}</div></details>
      <div className="todo-item-actions">{todo ? <><Button size="sm" variant="light" isDisabled={busy} startContent={<Icon name={item.status === 'done' ? 'refresh' : 'check'}/>} onPress={() => onStatus(item, item.status === 'done' ? 'pending' : 'done')}>{item.status === 'done' ? '重开' : '完成'}</Button>
        <Button size="sm" variant="light" isDisabled={busy} startContent={<Icon name="clock"/>} onPress={() => onCalendar(item.id)}>日历</Button>
        <Button size="sm" variant="light" isIconOnly aria-label={item.status === 'archived' ? '恢复待办' : '归档待办'} title={item.status === 'archived' ? '恢复待办' : '归档待办'} isDisabled={busy} onPress={() => onStatus(item, item.status === 'archived' ? 'pending' : 'archived')}><Icon name={item.status === 'archived' ? 'refresh' : 'archive'}/></Button></>
        : <Button size="sm" variant={added ? 'light' : 'flat'} isDisabled={busy || added} startContent={<Icon name={added ? 'check' : 'plus'}/>} onPress={() => onAdd(item)}>{added ? '已加入' : '加入待办'}</Button>}</div>
    </div>
    {todo && calendarOpen && <CalendarComposer key={item.id} item={item} api={api} onClose={() => onCalendar('')}/>}
  </article>;
}

export function ToDoWorkspace({ page = 'realtime', settingsForm, settingsDirty = false, api = bridgeRequest, onPageChange, onBusyChange = () => {} }) {
  const [view, setView] = useState(tabs.some(tab => tab.id === page) ? page : 'realtime'), [data, setData] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('pending'), [calendar, setCalendar] = useState(''), [expanded, setExpanded] = useState({});
  const working = useRef(false);
  async function load() {
    const [notifications, inbox, monitor] = await Promise.all([api('GET', 'notifications'), api('GET', 'inbox'), api('GET', 'monitor')]);
    setData({ notifications, inbox, monitor });
  }
  async function run(work) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error.message || '操作失败，请重试。'); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  }
  useEffect(() => { run(load); }, [api]);
  useEffect(() => { if (tabs.some(tab => tab.id === page)) setView(page); }, [page]);
  function choose(next) { if (view === 'settings' && settingsDirty && !confirmAction('放弃未保存的通知设置？')) return; setView(next); setCalendar(''); setMessage(''); if (next !== 'settings') onPageChange?.(next); }
  async function add(item) { await run(async () => { await api('POST', 'inbox/add', { id: item.id }); await load(); setMessage('已加入待办'); }); }
  async function changeStatus(item, value) { await run(async () => { await api('PUT', 'inbox/item', { id: item.id, status: value }); await load(); }); }
  const live = data?.notifications.items || [], digests = data?.notifications.digestItems || [], todos = data?.inbox.items || [];
  const items = (view === 'realtime' ? live : view === 'reports' ? digests : todos.filter(item => item.status === status)).filter(item => (item.title + ' ' + item.summary + ' ' + item.groupName + ' ' + item.groupId).toLowerCase().includes(query.toLowerCase()));
  const groups = grouped(items), total = view === 'realtime' ? live.length : view === 'reports' ? digests.length : todos.length;
  return <div className="todo-workspace">
    <header className="todo-workspace-heading"><div><span className="todo-wordmark"><Icon name="check" size={24}/>To Do</span><span className="todo-local-badge">本地</span></div><div className="todo-toolbar"><Button size="sm" variant="light" startContent={<Icon name="refresh"/>} isDisabled={busy} onPress={() => run(load)}>刷新</Button><Button size="sm" variant={view === 'settings' ? 'flat' : 'light'} startContent={<Icon name="sliders"/>} isDisabled={busy} onPress={() => choose(view === 'settings' ? 'realtime' : 'settings')}>{view === 'settings' ? '返回通知' : '设置'}</Button></div></header>
    {view !== 'settings' && <><nav className="todo-tabs" aria-label="To Do 页面">{tabs.map(tab => <button type="button" key={tab.id} aria-current={view === tab.id ? 'page' : undefined} disabled={busy} onClick={() => choose(tab.id)}><Icon name={tab.icon}/>{tab.label}<span>{tab.id === 'realtime' ? live.length : tab.id === 'inbox' ? data?.inbox.counts?.pending || 0 : digests.length}</span></button>)}</nav>
      <div className="todo-list-toolbar"><Input {...searchStyle} aria-label="搜索通知或待办" placeholder="搜索" value={query} onValueChange={setQuery}/>{view === 'inbox' ? <div className="todo-status-tabs" role="group" aria-label="待办状态">{statuses.map(row => <button type="button" key={row.id} aria-pressed={status === row.id} onClick={() => setStatus(row.id)}>{row.label}</button>)}</div> : <span className="todo-list-count">{groups.length} 个群 · {items.length} 条</span>}</div>
      {!data && busy ? <div className="todo-empty" role="status"><Icon name="loader" size={28}/><p>正在读取</p></div> : groups.length ? <div className="todo-group-list">{groups.map(group => <section className="todo-group" key={group.groupId} aria-label={group.groupName}><header><span className="todo-group-avatar"><Icon name="users" size={20}/></span><h2>{group.groupName}<small>{group.groupId}</small></h2><span>{group.items.length}</span></header><div>{group.items.slice(0, expanded[group.groupId] ? undefined : 30).map(item => <NoticeCard key={item.id} item={item} todo={view === 'inbox'} busy={busy} onAdd={add} onStatus={changeStatus} onCalendar={setCalendar} calendarOpen={calendar === item.id} api={api}/>)}</div>{group.items.length > 30 && !expanded[group.groupId] && <Button variant="light" size="sm" onPress={() => setExpanded(old => ({ ...old, [group.groupId]: true }))}>显示其余 {group.items.length - 30} 条</Button>}</section>)}</div> : <div className="todo-empty"><Icon name={view === 'inbox' ? 'check' : view === 'reports' ? 'archive' : 'bell'} size={32}/><h2>{query ? '没有匹配内容' : view === 'inbox' ? status === 'pending' ? '还没有待办' : '暂无记录' : view === 'reports' ? '还没有整理记录' : '还没有通知'}</h2><p>{query || total ? '试试其他筛选' : view === 'inbox' ? '从通知或整理记录加入' : view === 'reports' ? '定时整理结果会保存在这里' : '先在设置中选择来源群'}</p>{view === 'realtime' && !query && !total && <Button variant="flat" size="sm" startContent={<Icon name="plus"/>} onPress={() => choose('settings')}>选择群</Button>}</div>}
    </>}
    {view === 'settings' && <section className="todo-settings" aria-label="To Do 设置">{settingsForm || <p className="todo-empty">请在插件设置中配置来源与整理规则。</p>}</section>}
    {message && <p className="todo-feedback" role="status">{message}</p>}{error && <p className="todo-error" role="alert">{error}<Button size="sm" variant="light" isDisabled={busy} onPress={() => run(load)}>重试</Button></p>}
  </div>;
}
