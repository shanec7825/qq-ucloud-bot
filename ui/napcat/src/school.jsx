import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { Icon, searchStyle } from './controls.jsx';
import { bridgeRequest } from './workspace.jsx';
import './school.css';
import { schoolTaskAction } from '../../../src/school-links.mjs';

const PAGE_SIZE = 20;
const TABS = [
  { key: 'tasks', label: '待交作业', icon: 'book' },
  { key: 'notices', label: '站内通知', icon: 'mail' },
  { key: 'connection', label: '连接与提醒', icon: 'cloud' },
];

function deadlineTime(value) {
  if (!value) return Infinity;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const normalized = String(value).trim().replace(/年|月/g, '-').replace(/日/g, '').replace(' ', 'T');
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : Infinity;
}

function Deadline({ value }) {
  const overdue = deadlineTime(value) < Date.now();
  return <span className={'school-deadline' + (overdue ? ' overdue' : '')}>
    <Icon name="clock" size={14}/>
    <span>{value ? String(value) : '未设截止时间'}</span>
    {overdue && <span className="school-overdue">已过期</span>}
  </span>;
}

function TaskAction({ item, compact = false }) {
  const action = schoolTaskAction(item);
  if (!action) return null;
  return <a className={compact ? 'school-record-action' : 'school-complete-link'} href={action.url} target="_blank" rel="noopener noreferrer" aria-label={`${action.label}：${item.title || '待办'}`}>
    <Icon name="external" size={15}/><span>{action.label}</span><span className="school-sr-only">（ucloud，新窗口）</span>
  </a>;
}

function ReaderState({ icon = 'book', title, message, loading, error, onRetry, children }) {
  return <div className={'school-reader-state' + (error ? ' is-error' : '')} role={error ? 'alert' : loading ? 'status' : undefined}>
    <span className={'school-state-icon' + (loading ? ' is-loading' : '')}><Icon name={loading ? 'refresh' : icon} size={24}/></span>
    <p className="school-state-title">{title}</p>
    {message && <p className="school-state-message">{message}</p>}
    {onRetry && <Button type="button" size="sm" variant="flat" startContent={<Icon name="refresh"/>} onPress={onRetry}>重试</Button>}
    {children}
  </div>;
}

export function SchoolWorkspace({ enabled = false, disabled = false, revision, children }) {
  const instanceId = useId();
  const [section, setSection] = useState(enabled ? 'tasks' : 'connection');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [listState, setListState] = useState({ scope: '', data: null, error: '', loading: false });
  const [selected, setSelected] = useState(null);
  const [detailState, setDetailState] = useState({ scope: '', content: '', error: '', loading: false });
  const [reload, setReload] = useState(0);
  const [detailReload, setDetailReload] = useState(0);
  const previousEnabled = useRef(enabled);
  const tabRefs = useRef({});
  const detailHeading = useRef(null);
  const selectedRow = useRef(null);
  const ready = enabled && !disabled;
  const requestScope = `${ready}:${section}:${page}:${String(revision)}:${reload}`;
  const { data: currentData, error, loading } = listState.scope === requestScope ? listState
    : { data: null, error: '', loading: ready && section !== 'connection' };
  const currentSelected = ready && selected?.scope === requestScope ? selected.item : null;
  const detailScope = `${requestScope}:${String(currentSelected?.id)}:${detailReload}`;
  const detail = section === 'notices' ? { content: String(currentSelected?.content || '这条通知没有文字内容。') }
    : Number(currentSelected?.type) !== 3 ? { content: '请通过下方入口在 ucloud 查看并完成此待办。' }
      : detailState.scope === detailScope ? detailState : { loading: true };

  useEffect(() => {
    if (!enabled) setSection('connection');
    else if (!previousEnabled.current && !disabled) setSection('tasks');
    if (!enabled || !disabled) previousEnabled.current = enabled;
  }, [enabled, disabled]);

  useEffect(() => {
    let active = true;
    setSelected(null);
    if (!ready || section === 'connection') return () => { active = false; };
    setListState({ scope: requestScope, data: null, error: '', loading: true });
    bridgeRequest('POST', 'ucloud/view', { section, ...(section === 'notices' ? { page } : {}) })
      .then(result => {
        if (!active) return;
        const items = Array.isArray(result.items) ? result.items : [];
        setListState({ scope: requestScope, data: { items, page: Math.max(1, Number(result.page) || page), total: Math.max(0, Number(result.total) || 0) }, error: '', loading: false });
      })
      .catch(reason => { if (active) setListState({ scope: requestScope, data: null, error: reason?.message || '暂时无法读取，请重试。', loading: false }); });
    return () => { active = false; };
  }, [section, page, ready, requestScope]);

  useEffect(() => {
    let active = true;
    if (!currentSelected || section !== 'tasks' || Number(currentSelected.type) !== 3) return () => { active = false; };
    setDetailState({ scope: detailScope, content: '', error: '', loading: true });
    bridgeRequest('POST', 'ucloud/view', { section: 'detail', id: String(currentSelected.id) })
      .then(result => { if (active) setDetailState({ scope: detailScope, content: String(result.content || '这份作业没有文字说明。'), error: '', loading: false }); })
      .catch(reason => { if (active) setDetailState({ scope: detailScope, content: '', error: reason?.message || '正文暂时无法读取。', loading: false }); });
    return () => { active = false; };
  }, [currentSelected, section, detailScope]);

  const items = useMemo(() => {
    const rows = [...(currentData?.items || [])];
    if (section === 'tasks') rows.sort((a, b) => deadlineTime(a.deadline) - deadlineTime(b.deadline));
    const term = query.trim().toLocaleLowerCase();
    return term ? rows.filter(item => `${item.title || ''} ${section === 'tasks' ? item.course || '' : item.content || ''}`.toLocaleLowerCase().includes(term)) : rows;
  }, [currentData, query, section]);

  function chooseSection(next) {
    if (next !== 'connection' && !ready) return;
    if (section === next) return;
    setSection(next); setPage(1); setQuery(''); setSelected(null);
  }

  function moveTab(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const available = TABS.filter(tab => tab.key === 'connection' || ready);
    const current = available.findIndex(tab => tab.key === section);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
    event.preventDefault();
    const next = available[nextIndex].key;
    chooseSection(next);
    tabRefs.current[next]?.focus();
  }

  function open(item, element) {
    selectedRow.current = element;
    setSelected({ item, scope: requestScope });
    // The detail panel replaces the list on small screens; focus follows that navigation.
    if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => detailHeading.current?.focus());
  }

  function closeDetail() {
    setSelected(null);
    requestAnimationFrame(() => selectedRow.current?.focus());
  }

  const isTasks = section === 'tasks';
  const sectionLabel = isTasks ? '待交作业' : '站内通知';
  const title = section === 'connection' ? '连接与提醒' : sectionLabel;
  const currentPage = currentData?.page || page;
  const pageCount = Math.max(1, Math.ceil((currentData?.total || 0) / PAGE_SIZE));

  return <div className="school-workspace">
    <div className="school-topbar">
      <div className="school-tabs" role="tablist" aria-label="教学云工作台" onKeyDown={moveTab}>
        {TABS.map(tab => <button key={tab.key} ref={element => { tabRefs.current[tab.key] = element; }}
          type="button" role="tab" id={`${instanceId}-${tab.key}-tab`} aria-controls={`${instanceId}-${tab.key}-panel`}
          aria-selected={section === tab.key} tabIndex={section === tab.key || (!ready && tab.key === 'connection') ? 0 : -1}
          disabled={tab.key !== 'connection' && !ready} onClick={() => chooseSection(tab.key)}>
          <Icon name={tab.icon}/><span>{tab.label}</span>
        </button>)}
      </div>
      <a className="school-external" href="https://ucloud.bupt.edu.cn/uclass/" target="_blank" rel="noopener noreferrer" aria-label="打开教学云官网（新窗口）">
        <span>教学云官网</span><Icon name="external" size={14}/>
      </a>
    </div>
    <section id={`${instanceId}-${section}-panel`} className="school-panel" role="tabpanel" aria-labelledby={`${instanceId}-${section}-tab`} aria-label={title}>
      {section === 'connection' ? <div className="school-connection">{children}</div>
        : !ready ? <ReaderState icon="cloud" title={disabled ? '先保存连接设置' : '连接教学云'} message={disabled ? '保存后即可继续查看作业和通知。' : '完成连接后，作业和通知会显示在这里。'}>
          <Button type="button" variant="flat" onPress={() => chooseSection('connection')} startContent={<Icon name="cloud"/>}>连接与提醒</Button>
        </ReaderState>
          : <>
            <div className="school-toolbar">
              <Input {...searchStyle} className="school-search" aria-label={isTasks ? '搜索课程或作业' : '搜索本页通知'} placeholder={isTasks ? '搜索课程或作业' : '搜索本页通知'} value={query} onValueChange={value => { setQuery(value); setSelected(null); }} isDisabled={loading || !currentData}/>
              <span className="school-result-count" role="status" aria-live="polite">{currentData ? `${items.length}${query.trim() ? ' 条匹配' : isTasks ? ' 项待交' : ' 条通知'}` : ''}</span>
              <Button type="button" className="school-refresh" variant="light" isIconOnly aria-label={`刷新${sectionLabel}`} title="刷新" isDisabled={loading} onPress={() => setReload(value => value + 1)}><Icon name="refresh"/></Button>
            </div>
            {loading ? <ReaderState loading title={isTasks ? '正在读取作业…' : '正在读取通知…'}/>
              : error ? <ReaderState icon="cloud" error title="暂时无法读取" message={error} onRetry={() => setReload(value => value + 1)}>{/登录|认证|凭据/.test(error)&&<Button type="button" color="primary" variant="flat" startContent={<Icon name="cloud"/>} onPress={()=>chooseSection('connection')}>重新连接</Button>}</ReaderState>
                : currentData && !items.length ? <ReaderState icon={query.trim() ? 'list' : isTasks ? 'check' : 'mail'} title={query.trim() ? '没有匹配内容' : isTasks ? '当前没有待交作业' : '这一页没有通知'} message={query.trim() ? '换一个关键词试试。' : undefined}>
                  {query.trim() && <Button type="button" size="sm" variant="light" onPress={() => setQuery('')}>清除搜索</Button>}
                </ReaderState>
                  : currentData && <div className={'school-reader-grid' + (currentSelected ? ' has-selection' : '')}>
                    <div className="school-list-pane" aria-label={sectionLabel}>
                      <ul className="school-records">
                        {items.map(item => <li key={item.id} className="school-record-entry"><button type="button" className="school-record" aria-pressed={currentSelected?.id === item.id} aria-controls={`${instanceId}-detail`} onClick={event => open(item, event.currentTarget)}>
                          <span className="school-record-icon"><Icon name={isTasks ? 'book' : 'mail'} size={18}/></span>
                          <span className="school-record-main">
                            <span className="school-record-title">{String(item.title || (isTasks ? '未命名作业' : '未命名通知'))}{!isTasks && item.unread && <span className="school-unread">未读</span>}</span>
                            {isTasks ? <><span className="school-record-course">{String(item.course || '课程未提供')}{Number(item.type) !== 3 && <span className="school-task-type">{{ 2:'问卷', 4:'测验', 5:'互评' }[Number(item.type)] || '待办'}</span>}</span><Deadline value={item.deadline}/></> : <span className="school-record-time">{String(item.time || '')}</span>}
                          </span>
                          <Icon name="arrow" size={15}/>
                        </button>{isTasks && <TaskAction item={item} compact/>}</li>)}
                      </ul>
                    </div>
                    <article id={`${instanceId}-detail`} className="school-detail-pane" aria-label={isTasks ? '作业详情' : '通知正文'}>
                      {currentSelected ? <>
                        <Button type="button" className="school-detail-back" variant="light" size="sm" startContent={<Icon name="arrow-left"/>} onPress={closeDetail}>返回{isTasks ? '作业' : '通知'}</Button>
                        <div className="school-detail-heading"><span className="school-detail-eyebrow">{isTasks ? String(currentSelected.course || '课程作业') : '站内通知'}</span><h3 ref={detailHeading} tabIndex={-1}>{String(currentSelected.title || '详情')}</h3>
                          {isTasks ? <Deadline value={currentSelected.deadline}/> : currentSelected.time && <span className="school-record-time">{String(currentSelected.time)}</span>}
                        </div>
                        {detail.loading ? <ReaderState loading title="正在读取正文…"/>
                          : detail.error ? <ReaderState error title="正文暂时无法读取" message={detail.error} onRetry={() => setDetailReload(value => value + 1)}/>
                            : <div className="school-detail-content">{detail.content}</div>}
                        {isTasks && <TaskAction item={currentSelected}/>}
                      </> : <ReaderState icon={isTasks ? 'book' : 'mail'} title={isTasks ? '选择一份作业' : '选择一条通知'} message="正文会显示在这里。"/>}
                    </article>
                  </div>}
            {!isTasks && currentData && !loading && !error && <nav className="school-pagination" aria-label="通知分页">
              <Button type="button" variant="flat" size="sm" isDisabled={currentPage <= 1} onPress={() => { setPage(currentPage - 1); setSelected(null); }}>上一页</Button>
              <span>第 {currentPage} / {pageCount} 页<span className="school-page-total"> · 共 {currentData.total} 条</span></span>
              <Button type="button" variant="flat" size="sm" isDisabled={currentPage >= pageCount} onPress={() => { setPage(currentPage + 1); setSelected(null); }}>下一页</Button>
            </nav>}
          </>}
    </section>
  </div>;
}
