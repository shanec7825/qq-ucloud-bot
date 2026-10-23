import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../shared/Icon.jsx';
import { StatusPill } from '../../shared/StatusPill.jsx';
import { Feedback } from '../../shared/Feedback.jsx';
import { SetupCard } from '../../shared/SetupCard.jsx';
import { CheckRow } from '../../shared/CheckRow.jsx';
import { ActionButton } from '../../shared/buttons.jsx';

const SYSTEM_ROWS = [
  { id: 'os', label: '操作系统', icon: 'window' },
  { id: 'dotnet', label: '.NET 桌面运行时', icon: 'cube' },
  { id: 'webview2', label: 'WebView2 运行时', icon: 'browser' },
  { id: 'node', label: 'Node.js', icon: 'hexagon' },
  { id: 'powershell', label: 'PowerShell', icon: 'terminal' },
];
// NapCat is required; Codex (ChatGPT Plus sign-in) and Xiaomi MiMo / Token Plan are the two alternative model providers.
const COMPONENT_ROWS = [
  { id: 'napcat', label: 'NapCat 运行组件', icon: 'package', optional: false },
  { id: 'codex', label: 'ChatGPT / Codex 认证组件', icon: 'sparkles', optional: true },
  { id: 'mimo', label: '小米 MiMo / Token Plan 组件', icon: 'bot', optional: true },
];
const PORT_ROLES = {
  required: { tone: 'ok', label: '必需', fallback: '必需端口' },
  extra: { tone: 'warning', label: '多余', fallback: '配置里仍启用的多余入站端口' },
  foreign: { tone: 'fail', label: '外来占用', fallback: '被其它工作区的进程占用' },
};
const SECTION_BY_ACTION = { install: 'components', setup: 'launch', start: 'launch', 'stop-bot': 'launch', workspace: 'workspace', data: 'workspace', home: 'system', 'open-webui': 'launch', login: 'launch', settings: 'components', switch: 'launch', 'stop-conflict': 'workspace', 'trim-ports': 'ports' };

const known = (rows, fallback) => {
  const list = (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object');
  const byId = new Map(list.map(row => [row.id, row]));
  const merged = fallback.map(base => {
    const row = byId.get(base.id) || {};
    return { ...base, label: row.label || base.label, ok: row.ok, version: row.version, detail: row.detail, help: row.help, optional: row.optional ?? base.optional };
  });
  for (const row of list) if (!fallback.some(base => base.id === row.id)) merged.push({ icon: 'help', ...row });
  return merged;
};
const stateOf = ok => ok === true ? 'ok' : ok === false ? 'fail' : 'unknown';

export function App({ store }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [results, setResults] = useState({});
  const sentSection = useRef({});
  const status = state.status || {}, busy = state.busy, progress = state.progress;

  useEffect(() => {
    const report = state.progress;
    if (!report || !report.done || report.action === 'status') return;
    const section = sentSection.current[report.action] || SECTION_BY_ACTION[report.action] || 'launch';
    const failed = report.ok === false;
    setResults(before => ({ ...before, [section]: { tone: failed ? 'error' : 'success', text: failed ? (report.error || report.message || '操作失败，请重试。') : (report.message || '已完成。') } }));
  }, [state.progress]);

  function send(action, override) {
    const shell = window.chrome && window.chrome.webview;
    const section = override || SECTION_BY_ACTION[action] || 'launch';
    sentSection.current[action] = section;
    if (!shell || typeof shell.postMessage !== 'function') {
      setResults(before => ({ ...before, [section]: { tone: 'error', text: '未连接 Qlyra 桌面外壳，请在 Qlyra 桌面窗口中打开本页。' } }));
      return;
    }
    setResults(before => {
      const next = { ...before };
      delete next[section];
      if (action === 'setup') delete next.components;
      if (action === 'stop-conflict') { delete next.workspace; delete next.ports; }
      return next;
    });
    store.beginAction(action);
    shell.postMessage(action);
  }

  const feedback = section => results[section] ? <Feedback tone={results[section].tone} message={results[section].text}/> : null;
  const qqState = status.qqLoggedIn === true ? { tone: 'success', value: '已登录' }
    : status.qqLoggedIn === false ? (status.webuiAvailable ? { tone: 'warning', value: '等待扫码登录' } : { tone: 'default', value: '服务未启动' })
      : { tone: 'default', value: '未检测' };
  const botState = status.botConnected === true ? { tone: 'success', value: status.botName ? '已连接 · ' + status.botName : '已连接 QQ' }
    : status.botConnected === false ? { tone: 'default', value: '尚未连接' } : { tone: 'default', value: '未检测' };
  const modelState = status.model ? { tone: 'success', value: status.model } : { tone: 'default', value: status.model === '' ? '尚未设置' : '未检测' };
  const showProgress = busy && progress;
  const percent = showProgress && typeof progress.percent === 'number' && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
  const stepText = showProgress ? (typeof progress.step === 'number' ? '第 ' + progress.step + ' 步' : typeof progress.step === 'string' && progress.step ? progress.step : '') : '';

  // A foreign workspace holding the ports surfaces through status.conflict / status.workspaceError.
  const conflict = status.conflict && typeof status.conflict === 'object' ? status.conflict : null;
  const conflictPorts = conflict && Array.isArray(conflict.ports) ? conflict.ports.filter(port => port !== undefined && port !== null) : [];
  const conflictOwners = conflict && Array.isArray(conflict.owners) ? conflict.owners.filter(Boolean).map(String) : [];
  const conflictText = conflict && (conflictPorts.length || conflictOwners.length)
    ? '其它工作区的 NapCat 正在占用' + (conflictPorts.length ? '端口 ' + conflictPorts.join('、') : '本机端口') + (conflictOwners.length ? '：' + conflictOwners.join('、') : '') + '。'
    : '';
  const workspaceFailure = [status.workspaceError ? String(status.workspaceError) : '', conflictText].filter(Boolean).join('\n');
  const conflicted = Boolean(workspaceFailure);

  const portRows = (Array.isArray(status.ports) ? status.ports : []).filter(row => row && typeof row === 'object');
  const hasExtra = portRows.some(row => row.role === 'extra');
  const hasForeign = portRows.some(row => row.role === 'foreign');
  const systemRows = known(status.system, SYSTEM_ROWS);
  const systemIssues = systemRows.filter(row => row.ok === false).length;
  const systemReady = systemRows.filter(row => row.ok === true).length;
  const launchTitle = busy ? '正在准备…' : conflicted ? '先解决工作区冲突' : status.webuiAvailable ? '机器人已启动' : '让 Qlyra 上线';

  return <div className="wizard">
    <div className="ambient-colors" aria-hidden="true"><i/><i/><i/></div>
    <header className="topbar">
      <span className="brand-mark"><img src="qlyra.png" width="42" height="42" alt=""/></span>
      <h1 className="brand-name">Qlyra</h1>
      <span className="version-badge">{status.version ? 'v ' + status.version : '版本未知'}</span>
      <div className="topbar-workspace">
        <span className="topbar-label">工作区</span>
        <span className="workspace-path">{status.workspace || '尚未选择工作区'}</span>
      </div>
      <ActionButton action="home" variant="ghost" disabled={busy} onAction={send} icon={<Icon name="refresh"/>}>重新检查</ActionButton>
    </header>

    <section className="launch-hub" aria-labelledby="launch-title">
      <div className="launch-heading">
        <span className="launch-mark"><Icon name={busy ? 'loader' : conflicted ? 'alert' : status.webuiAvailable ? 'check' : 'rocket'} size={32}/></span>
        <div><h2 id="launch-title" aria-live="polite">{launchTitle}</h2><p>{conflicted ? '在下方切换项目，或关闭占用端口的其它后台。' : status.webuiAvailable ? '打开 NapCat，继续登录与管理。' : '准备组件、启动服务，然后扫码登录。'}</p></div>
      </div>
      <div className="summary" role="group" aria-label="状态摘要">
        <StatusPill name="QQ" tone={qqState.tone}>{qqState.value}</StatusPill>
        <StatusPill name="机器人" tone={botState.tone}>{botState.value}</StatusPill>
        <StatusPill name="模型" tone={modelState.tone}>{modelState.value}</StatusPill>
        {status.loginPhase && <StatusPill name="登录阶段" tone="default">{String(status.loginPhase)}</StatusPill>}
      </div>
      <div className="actions launch-actions">
        <ActionButton action="setup" variant="primary" disabled={busy} onAction={send} icon={<Icon name={busy ? 'loader' : 'rocket'} size={18}/>}>一键准备并启动</ActionButton>
        <ActionButton action="start" disabled={busy} onAction={send} icon={<Icon name="play"/>}>启动机器人</ActionButton>
        <ActionButton action="open-webui" disabled={busy} onAction={send} icon={<Icon name="browser"/>}>打开 NapCat WebUI</ActionButton>
      </div>
      {showProgress && <div className="progress" role="progressbar" aria-label="运行组件准备进度"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <div className="progress-track"><div className={'progress-fill' + (percent === null ? ' indeterminate' : '')} style={percent === null ? undefined : { width: percent + '%' }}/></div>
        <p className="progress-message">
          {stepText && <span className="progress-step">{stepText}</span>}
          {progress.item && <span className="progress-item">{String(progress.item)}</span>}
          <span className="progress-text">{String(progress.message || '处理中…')}</span>
        </p>
      </div>}
      {feedback('launch')}
    </section>

    <div className="wizard-main">
      <SetupCard className="workspace-card" icon="folder" title="工作区"
        actions={<>
          {conflicted && <ActionButton action="stop-conflict" variant="primary" disabled={busy} onAction={send} icon={<Icon name="alert"/>}>关闭其它后台并继续</ActionButton>}
          <ActionButton action="workspace" disabled={busy} onAction={send} icon={<Icon name="folder"/>}>选择已有项目</ActionButton>
          <ActionButton action="data" disabled={busy} onAction={send} icon={<Icon name="archive"/>}>打开数据目录</ActionButton>
        </>}
        feedback={feedback('workspace')}>
        <p className="path-value">{status.workspace || '尚未选择工作区'}</p>
        {workspaceFailure && <Feedback tone="error" message={workspaceFailure}/>}
        {conflicted && <p className="setup-card-description">关闭其它后台会退出其它工作区的 NapCat，并释放端口。</p>}
      </SetupCard>

      <SetupCard icon="package" title="运行组件" description="NapCat 必需；回答模型可选 Codex 或小米 MiMo。"
        actions={<>
          <ActionButton action="install" disabled={busy} onAction={send} icon={<Icon name="download"/>}>准备运行组件</ActionButton>
        </>}
        feedback={feedback('components')}>
        {known(status.components, COMPONENT_ROWS).map(row => {
          const optional = row.optional === true || (row.optional === undefined && ['codex', 'mimo'].includes(row.id));
          const tone = row.ok === true ? 'ok' : row.ok === false ? (optional ? 'unknown' : 'fail') : 'unknown';
          return <CheckRow key={row.id} icon={row.icon} state={tone}
            stateLabel={row.ok === true ? '已就绪' : row.ok === false ? '未就绪' : '未检测'}
            name={<>{row.label}<span className={'setup-badge' + (optional ? '' : ' required')}>{optional ? '可选' : '必需'}</span><span className="version-chip">{row.version || '版本未知'}</span></>}
            detail={row.detail ? String(row.detail) : row.ok === undefined ? '尚未检测' : row.ok ? '已安装' : '未安装'}
            actions={row.id === 'mimo' && <ActionButton action="settings" className="small" disabled={busy} onAction={action => send(action, 'components')} icon={<Icon name="cog" size={13}/>}>去配置</ActionButton>}/>;
        })}
      </SetupCard>

      <details className="diagnostic-panel span-all" open={systemIssues > 0}>
        <summary><span className="diagnostic-icon"><Icon name="window" size={19}/></span><span>系统环境</span><span className={'diagnostic-status' + (systemIssues ? ' warning' : '')}>{systemIssues ? systemIssues + ' 项需处理' : systemReady === systemRows.length ? '全部就绪' : systemReady + ' / ' + systemRows.length + ' 就绪'}</span><Icon name="chevron-down"/></summary>
        <SetupCard className="diagnostic-content" feedback={feedback('system')}>
          {systemRows.map(row => <CheckRow key={row.id} icon={row.icon} name={row.label} state={stateOf(row.ok)}
            detail={row.detail || (row.ok === undefined ? '尚未检测' : '')} help={row.help}>
            {row.id === 'webview2' && row.ok === false && <span className="check-help">
              <a className="setup-link" target="_blank" rel="noopener noreferrer" href="https://developer.microsoft.com/microsoft-edge/webview2/">下载 WebView2 运行时</a>
            </span>}
          </CheckRow>)}
        </SetupCard>
      </details>

      <details className="diagnostic-panel span-all" open={hasExtra || hasForeign}>
        <summary><span className="diagnostic-icon"><Icon name="globe" size={19}/></span><span>连接与端口</span><span className={'diagnostic-status' + (hasExtra || hasForeign ? ' warning' : '')}>{hasForeign ? '有端口冲突' : hasExtra ? '有多余端口' : portRows.length ? portRows.length + ' 个连接' : '未检测'}</span><Icon name="chevron-down"/></summary>
      <SetupCard className="diagnostic-content ports-card"
        actions={<>
          {hasExtra && <ActionButton action="trim-ports" disabled={busy} onAction={action => send(action, 'ports')}>关闭多余端口</ActionButton>}
          {hasForeign && <ActionButton action="stop-conflict" disabled={busy} onAction={action => send(action, 'ports')}>关闭其它后台</ActionButton>}
        </>}
        feedback={feedback('ports')}>
        {portRows.length ? portRows.map((row, index) => {
          const role = PORT_ROLES[row.role] || { tone: 'unknown', label: '未知', fallback: '' };
          return <CheckRow key={String(row.port ?? index) + ':' + index} icon={row.role === 'required' ? 'globe' : 'alert'}
            name={<>{row.label || '端口'}<span className="version-chip">{String(row.port ?? '—')}</span></>}
            detail={row.detail ? String(row.detail) : role.fallback}
            state={role.tone} stateLabel={role.label}/>;
        }) : <p className="empty-label">未检测</p>}
      </SetupCard>
      </details>
    </div>

    <footer className="footnote">
      <Icon name="window" size={14}/><span>关闭窗口后在托盘继续运行 · 就绪后自动打开 NapCat</span>
    </footer>
  </div>;
}
