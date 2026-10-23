import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Input, Textarea } from '@heroui/input';
import { Switch } from '@heroui/switch';
import { Icon } from '../../shared/Icon.jsx';
import { bridgeRequest, ContactPicker } from './workspace.jsx';
import { fieldStyle } from './controls.jsx';

export function ToDoSettings({ onDirtyChange = () => {} }) {
  const [settings, setSettings] = useState(null), [section, setSection] = useState('realtime'), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState('');
  const mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; bridgeRequest('GET', 'state').then(result => { if (mounted.current) setSettings(result.settings); }).catch(error => { if (mounted.current) setMessage(error.message); }); return () => { mounted.current = false; onDirtyChange(false); }; }, []);
  function edit(key, value) { setSettings(old => ({ ...old, [section]: { ...old[section], [key]: value } })); setDirty(true); onDirtyChange(true); setMessage(''); }
  const data = settings?.[section];
  async function save() {
    if (!settings || locked.current) return; locked.current = true; setBusy(true); setMessage('');
    try {
      const result = await bridgeRequest('PUT', 'settings', { settings: { ...settings, monitor: { ...settings.monitor, notify: false, recipientQQ: '' } }, revision: settings.revision });
      if (mounted.current) { setSettings(result.settings); setDirty(false); onDirtyChange(false); setMessage('已保存'); }
    } catch (error) { if (mounted.current) setMessage(error.message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="todo-settings"><div className="segment-control" role="group" aria-label="通知设置类型"><button type="button" aria-pressed={section === 'realtime'} disabled={busy} onClick={() => setSection('realtime')}><Icon name="bell"/>即时通知</button><button type="button" aria-pressed={section === 'monitor'} disabled={busy} onClick={() => setSection('monitor')}><Icon name="clock"/>定时整理</button></div>
    {data && <div className="todo-settings-fields"><div className="switch-row"><strong>{section === 'realtime' ? '即时通知' : '定时整理'}</strong><Switch aria-label={section === 'realtime' ? '启用即时通知' : '启用定时整理'} isSelected={data.enabled} isDisabled={busy} onValueChange={value => edit('enabled', value)}/></div>
      <ContactPicker label="关注群" kind="groups" multiple all disabled={busy} value={data.groups.join(', ')} onChange={value => edit('groups', value.split(/[,，]/).map(id => id.trim()).filter(Boolean))}/>
      <Textarea {...fieldStyle} label="关注事项" aria-label="关注事项" minRows={3} value={data.focus} isDisabled={busy} onValueChange={value => edit('focus', value)}/>
      {section === 'realtime' ? <details className="advanced-settings"><summary>筛选细节</summary><div className="todo-settings-fields">{[['includeKeywords','包含关键词'],['excludeKeywords','排除关键词'],['senderQQs','指定发送人']].map(([key, label]) => <Textarea {...fieldStyle} key={key} minRows={2} label={label} value={data[key]} isDisabled={busy} onValueChange={value => edit(key, value)}/>)}</div></details> : <><label className="chat-profile-label">整理模板<select aria-label="整理模板" value={data.template} disabled={busy} onChange={event => edit('template', event.target.value)}>{[['inherit','跟随群场景'],['general','通用通知'],['course','课程作业'],['work','工作协作'],['custom','自定义']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>{data.template === 'custom' && <Textarea {...fieldStyle} label="模板要求" value={data.templatePrompt} isDisabled={busy} onValueChange={value => edit('templatePrompt', value)}/>}<details className="advanced-settings"><summary>整理时间</summary><div className="todo-settings-fields">{[['intervalMinutes','间隔（分钟）',15,10080],['lookbackDays','回看天数',1,30]].map(([key, label, min, max]) => <Input {...fieldStyle} key={key} label={label} type="number" min={min} max={max} value={String(data[key])} isDisabled={busy} onValueChange={value => edit(key, Number(value))}/>)}</div></details></>}
      <div className="choice-control"><span className="control-label">输出格式</span><div className="segment-control" role="group" aria-label="输出格式">{[['concise','简洁清单'],['detailed','详细依据']].map(([value,label]) => <button type="button" key={value} aria-pressed={data.outputFormat === value} disabled={busy} onClick={() => edit('outputFormat', value)}>{label}</button>)}</div></div>
    </div>}
    {message && <p role="status" className="feedback">{message}</p>}<div className="editor-actions"><Button color="primary" isDisabled={!settings || !dirty || busy} isLoading={busy} onPress={save}>保存更改</Button>{dirty && <span className="dirty-indicator">未保存</span>}</div>
  </div>;
}
