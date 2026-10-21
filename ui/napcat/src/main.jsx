import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider } from '@heroui/system';
import { Input, Textarea } from '@heroui/input';
import { Select, SelectItem, SelectSection } from '@heroui/select';
import { Switch } from '@heroui/switch';
import { Button } from '@heroui/button';
import { Spinner } from '@heroui/spinner';
import { PAGE_COPY } from '../../../napcat-plugin/webui/copy.mjs';

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
async function hydrate(config) {
  let { schema } = await api('schema',config);
  for (const field of schema) if (field.reactive && !Object.hasOwn(config,field.key)) config[field.key] = field.default;
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

function App() {
  const [form,setForm] = useState(null), [busy,setBusy] = useState(true), [dirty,setDirty] = useState(false), [message,setMessage] = useState(''), [error,setError] = useState(false);
  const current = useRef(null), working = useRef(false);
  const install = value => { current.current = value; setForm(value); };
  useEffect(connectTheme,[]);
  useEffect(() => { const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); },[dirty]);
  async function transaction(work) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(false); setMessage('');
    try { await work(); } catch (failure) { setError(true); setMessage(failure.message || '操作失败，请重试。'); }
    finally { working.current = false; setBusy(false); }
  }
  async function load(page) {
    const result = await api('load');
    if (page && result.schema[0].options.some(o => o.value === page)) result.config.page = page;
    install(await hydrate(result.config)); setDirty(false);
  }
  useEffect(() => { transaction(() => load()); },[]);
  async function change(field,value) {
    if (working.current) return;
    const before = current.current;
    if (!field.reactive) { install({...before,config:{...before.config,[field.key]:value}}); setDirty(true); return; }
    if (dirty && !confirm('切换会放弃未保存的更改。继续切换？')) return;
    await transaction(async () => {
      const config = field.key === 'page' ? {_session:before.config._session,page:value} : {
        _session:before.config._session,
        ...Object.fromEntries(before.schema.filter(f => f.reactive).map(f => [f.key,before.config[f.key]])), [field.key]:value,
      };
      install(await hydrate(config)); setDirty(false);
    });
  }
  async function save(event) {
    event.preventDefault();
    await transaction(async () => {
      const snapshot = current.current;
      await api('save',snapshot.config); setDirty(false);
      await load(snapshot.config.page); setMessage('已保存。');
    });
  }
  const fields = form?.schema || [], config = form?.config || {}, copy = PAGE_COPY[config.page];
  const operation = config['operation_' + config.page], action = fields.find(f => f.key.startsWith('action_'));
  const saveLabel = operation === 'delete' ? '删除所选内容' : operation === 'clear' ? '清空所选内容' : action && config[action.key] !== 'none' ? '保存并执行' : '保存更改';
  function renderField(field) {
    const value = config[field.key] ?? field.default;
    if (field.key === 'help' || field.type === 'text' && /_preview$/.test(field.key)) return null;
    if (field.type === 'text') {
      if (field.key === 'preview' && ['accounts','realtime','monitor','agent'].includes(config.page)) return null;
      const links = String(field.default).match(/https:\/\/[^\s]+/g) || [];
      return <div key={field.key} className="whitespace-pre-wrap break-words text-small text-default-600">{field.default}{links.map(url => <a key={url} className="block text-primary underline" href={url} target="_blank" rel="noopener noreferrer">打开授权页面</a>)}</div>;
    }
    if (field.type === 'boolean') return <div key={field.key} className="flex justify-between items-center gap-4 p-3 bg-default-100 rounded-lg">
      <div className="min-w-0"><div id={field.key+'-label'} className="text-small">{field.label}</div>{field.description && <p id={field.key+'-hint'} className="text-tiny text-default-500 mt-1">{field.description}</p>}</div>
      <Switch aria-labelledby={field.key+'-label'} aria-describedby={field.description ? field.key+'-hint' : undefined} isSelected={Boolean(value)} onValueChange={v => change(field,v)} isDisabled={busy}/>
    </div>;
    if (field.type === 'select') {
      const items = field.options.map(o => ({key:JSON.stringify(o.value),label:o.label}));
      const groups = new Map();
      if (field.key === 'page') for (const o of field.options) { const group = PAGE_COPY[o.value].group; if (!groups.has(group)) groups.set(group,[]); groups.get(group).push(o); }
      return <Select key={field.key} label={field.label} aria-label={field.label} description={field.description} selectedKeys={[JSON.stringify(value)]} disallowEmptySelection
        popoverProps={{shouldBlockScroll:false,disableAnimation:true}}
        onSelectionChange={keys => { const key = [...keys][0]; if (key !== undefined) change(field,JSON.parse(key)); }} isDisabled={busy}>
        {field.key === 'page' ? [...groups].map(([group,options]) => <SelectSection key={group} title={group}>{options.map(o => <SelectItem key={JSON.stringify(o.value)}>{o.label}</SelectItem>)}</SelectSection>) : items.map(o => <SelectItem key={o.key}>{o.label}</SelectItem>)}
      </Select>;
    }
    const long = /(?:Prompt|text|summary|focus)$/.test(field.key), Control = long ? Textarea : Input;
    return <Control key={field.key} label={field.label} aria-label={field.label} description={field.description} value={String(value ?? '')}
      type={field.type === 'number' ? 'number' : /(?:Token|Key|Secret|password)$/.test(field.key) ? 'password' : 'text'}
      autoComplete="off" minRows={long ? 4 : undefined} isDisabled={busy}
      onValueChange={v => change(field,field.type === 'number' ? Number(v) : v)}/>;
  }
  return <main className="p-4 md:p-6 max-w-3xl space-y-5" aria-label="插件设置">
    {!form && busy && <Spinner label="正在读取设置"/>}
    <form onSubmit={save} className="space-y-5">
      {fields.filter(f => f.key === 'page').map(renderField)}
      {copy && <p id="description" className="text-small text-default-500">{copy.description}</p>}
      {copy?.detail && <details className="text-small text-default-500"><summary className="cursor-pointer text-primary">使用说明</summary><p className="mt-2 leading-relaxed">{copy.detail}</p></details>}
      <div className="space-y-4" id="fields">{fields.filter(f => f.key !== 'page').map(renderField)}</div>
      <p id="feedback" role="status" aria-live="polite" className={'text-small whitespace-pre-wrap ' + (error ? 'text-danger' : 'text-success-600')}>{message}</p>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" color={operation === 'delete' || operation === 'clear' ? 'danger' : 'primary'} isLoading={busy} isDisabled={!form || busy}>{saveLabel}</Button>
        <Button variant="light" isDisabled={busy} onPress={() => { if (!dirty || confirm('放弃未保存的更改并重新载入？')) transaction(() => load(config.page)); }}>重新载入</Button>
        {dirty && <span className="text-tiny text-default-500">更改尚未保存</span>}
      </div>
    </form>
  </main>;
}
createRoot(document.getElementById('root')).render(<HeroUIProvider locale="zh-CN"><App/></HeroUIProvider>);
