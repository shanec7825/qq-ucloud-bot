import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Icon } from '../../shared/Icon.jsx';
import { bridgeRequest } from './workspace.jsx';
import './connectors.css';

function loginLink(result) {
  try { const url = new URL(result.url || result.authUrl || result.verificationUri); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function ConnectorWorkspace({ provider, disabled, onSaved, children }) {
  const [state, setState] = useState(null), [settings, setSettings] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [link, setLink] = useState('');
  const live = useRef(true), lock = useRef(false), section = provider === 'github' ? 'github' : 'drive';
  async function load() { const [status, config] = await Promise.all([bridgeRequest('GET', 'connectors/status'), bridgeRequest('GET', 'state')]); if (live.current) { setState(status); setSettings(config.settings); } }
  useEffect(() => { live.current = true; load().catch(error => { if (live.current) setMessage(error.message); }); return () => { live.current = false; }; }, [provider]);
  async function run(work) { if (lock.current) return; lock.current = true; setBusy(true); setMessage(''); try { await work(); } catch (error) { if (live.current) setMessage(error.message); } finally { lock.current = false; if (live.current) setBusy(false); } }
  const status = state?.providers?.[provider], connected = status?.connected, selected = settings?.[section]?.authMode === 'chatgpt';
  return <div className="connector-workspace"><section className="connector-primary"><div className="connector-brand"><span><Icon name={provider === 'github' ? 'cube' : 'cloud'} size={29}/></span><div><h2>ChatGPT Apps</h2><p>{provider === 'github' ? 'GitHub' : 'Google Drive'}</p></div><span className={'connector-status' + (connected ? ' connected' : '')}>{connected ? '读取已验证' : '待检测'}</span></div>
    <div className="connector-flow"><span><Icon name="user"/>ChatGPT</span><Icon name="chevron-right"/><span><Icon name={provider === 'github' ? 'cube' : 'cloud'}/>{provider === 'github' ? 'GitHub' : 'Drive'}</span><Icon name="chevron-right"/><span><Icon name="bot"/>chat</span></div>
    <div className="connector-actions"><Button color="primary" isDisabled={disabled || busy || !settings || selected && settings[section].enabled} onPress={() => run(async () => { await bridgeRequest('PUT', 'settings', { revision: settings.revision, settings: { ...settings, [section]: { ...settings[section], enabled: true, authMode: 'chatgpt' } } }); await load(); await onSaved?.(); })}>{selected && settings?.[section].enabled ? '已选用' : '使用 ChatGPT Apps'}</Button>
      <Button variant="bordered" isDisabled={disabled || busy} isLoading={busy} onPress={() => run(async () => { const result = await bridgeRequest('POST', 'connectors/check', { provider }); await load(); if (live.current) setMessage(result.message); })}>检测读取</Button>
      <Button variant="light" isDisabled={disabled || busy} onPress={() => run(async () => { const result = await bridgeRequest('POST', 'codex/login'); if (live.current) { setLink(loginLink(result)); setMessage(result.message || (result.loggedIn ? '已登录' : '完成登录后，在 ChatGPT / Codex 的应用设置中连接此应用。')); } })}>ChatGPT 登录</Button></div>
    {link && <a className="connector-login" href={link} target="_blank" rel="noopener noreferrer">打开登录页面<Icon name="external"/></a>}
    {message && <p role="status" className="feedback">{message}</p>}<p className="connector-note">在 ChatGPT / Codex 连接对应应用后，可由管理员私聊查询。</p></section>
    <details className="connector-advanced"><summary>连接设置与其他授权方式</summary>{children}</details></div>;
}
