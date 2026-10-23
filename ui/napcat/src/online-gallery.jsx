import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { Icon } from '../../shared/Icon.jsx';
import { fieldStyle } from './controls.jsx';
import { bridgeRequest } from './workspace.jsx';
import './online-gallery.css';

const PAGE_SIZE = 24;

export function OnlineGallery({ onAdded, disabled, savedItems, onBusyChange }) {
  const [items, setItems] = useState([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(''), [loadError, setLoadError] = useState(''), [progress, setProgress] = useState(null);
  const [pack, setPack] = useState('日系动漫'), [mood, setMood] = useState('全部'), [query, setQuery] = useState(''), [visible, setVisible] = useState(PAGE_SIZE);
  const live = useRef(true), pending = useRef(false), cancelled = useRef(false);
  async function load() {
    setLoading(true); setLoadError('');
    try { const result = await bridgeRequest('GET', 'media/online'); if (live.current) setItems(result.items); }
    catch (error) { if (live.current) setLoadError(error.message || '目录暂时无法读取，请重试。'); }
    finally { if (live.current) setLoading(false); }
  }
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; cancelled.current = true; }; }, []);
  useEffect(() => { setVisible(PAGE_SIZE); }, [pack, mood, query]);
  const rows = useMemo(() => items.map(item => savedItems ? { ...item, saved: savedItems.some(saved => saved.source?.id === item.id && saved.scope === '*:account:') } : item), [items, savedItems]);
  const packs = useMemo(() => [...new Set(items.filter(item => item.category === '日系动漫').map(item => item.pack))], [items]);
  const moods = useMemo(() => [...new Set(items.flatMap(item => item.tags || []))], [items]);
  const filtered = rows.filter(item => (pack === '全部' || (pack === '日系动漫' ? item.category === '日系动漫' : item.pack === pack))
    && (mood === '全部' || item.tags?.includes(mood))
    && [item.name, item.pack, ...(item.aliases || []), ...(item.tags || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const remaining = filtered.filter(item => !item.saved);
  async function add(selected) {
    if (pending.current || disabled) return;
    pending.current = true; cancelled.current = false; setBusy(true); onBusyChange?.(true); setMessage('');
    setProgress({ done: 0, total: selected.length }); let added = 0, failed = 0, failure = '';
    try {
      for (const row of selected) {
        if (!live.current || cancelled.current) break;
        try {
          const result = await bridgeRequest('POST', 'media/online', { id: row.id });
          if (!live.current) break;
          onAdded(result.item); setItems(items => items.map(item => item.id === row.id ? { ...item, saved: true } : item)); added++;
        } catch (error) { failed++; failure ||= error.message || '下载未完成'; }
        if (live.current) setProgress({ done: added + failed, total: selected.length });
      }
      if (live.current) setMessage((added ? '已启用 ' + added + ' 个，聊天时可自动选用。' : '')
        + (failed ? ' ' + failed + ' 个未完成：' + failure + '。可再次启用未完成的素材。' : '')
        + (cancelled.current ? ' 已停止后续下载，已启用的素材保留。' : ''));
    } finally { pending.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); setProgress(null); } }
  }
  return <section className="online-gallery" aria-label="在线表情图库" aria-busy={busy || loading}>
    <header><div><span className="online-gallery-icon"><Icon name="image"/></span><div><h2>动漫表情库</h2><p>{packs.length} 套作品与主题 · {items.filter(item => item.category === '日系动漫').length} 个表情</p></div></div>
      <Button color="primary" variant="flat" size="sm" isLoading={busy} isDisabled={disabled || busy || loading || !remaining.length} startContent={<Icon name="plus"/>} onPress={() => add(remaining)}>{remaining.length ? `启用筛选结果（${remaining.length}）` : '已全部启用'}</Button>
    </header>
    <p className="online-gallery-description">按作品、名字或情绪挑选。启用后保存在本机，所有已登录 QQ 共用；机器人根据话题选择合适的表情。</p>
    <div className="online-gallery-controls">
      <Input {...fieldStyle} label="搜索名字或角色" value={query} onValueChange={setQuery} isDisabled={busy} placeholder="例如：小埋、晚安、加油"/>
      <label>作品<select aria-label="筛选作品" value={pack} disabled={busy} onChange={event => setPack(event.target.value)}><option value="日系动漫">日系动漫推荐</option>{packs.map(name => <option key={name} value={name}>{name}</option>)}<option value="全部">包含其他风格</option></select></label>
      <label>情绪<select aria-label="筛选情绪" value={mood} disabled={busy} onChange={event => setMood(event.target.value)}><option value="全部">全部情绪</option>{moods.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    {progress && <div className="online-gallery-progress"><p role="status">正在启用 {progress.done} / {progress.total}</p><progress value={progress.done} max={progress.total} aria-label="素材启用进度"/><Button size="sm" variant="light" onPress={() => { cancelled.current = true; }}>停止后续下载</Button></div>}
    {loading && <p role="status" className="online-gallery-description">正在读取表情目录…</p>}
    {loadError && <div role="alert" className="feedback error">{loadError}<Button variant="light" onPress={load}>重新读取</Button></div>}
    {!loading && !loadError && <p className="online-gallery-count" role="status">找到 {filtered.length} 个，已启用 {filtered.filter(item => item.saved).length} 个</p>}
    <div className="online-gallery-grid">{filtered.slice(0, visible).map(item => <article key={item.id}>
      <img src={item.imageURL} alt={item.name} loading="lazy" decoding="async" width="240" height="240" referrerPolicy="no-referrer"/>
      <div><strong>{item.name}</strong><Button size="sm" variant="light" aria-label={(item.saved ? '已启用 ' : '启用 ') + item.name} isDisabled={disabled || busy || item.saved} onPress={() => add([item])}>{item.saved ? <><Icon name="check"/>已启用</> : '启用'}</Button></div>
      <p className="online-gallery-tags">{item.tags?.length ? item.tags.join(' · ') : '日常聊天'}<a href={item.sourceURL} target="_blank" rel="noopener noreferrer" aria-label={item.name + '的素材来源'}>来源<Icon name="external" size={12}/></a></p>
    </article>)}</div>
    {!loading && !loadError && !filtered.length && <p className="empty-label">没有匹配的表情，试试其他作品或情绪。</p>}
    {filtered.length > visible && <div className="online-gallery-more"><Button variant="bordered" onPress={() => setVisible(visible + PAGE_SIZE)}>继续查看（还剩 {filtered.length - visible} 个）</Button></div>}
    <p role="status" className="feedback">{message}</p>
    <a className="online-gallery-source" href="https://github.com/lrhtony/BiliEmoji" target="_blank" rel="noopener noreferrer">动漫素材来源 Bilibili / BiliEmoji<Icon name="external" size={13}/></a>
  </section>;
}
