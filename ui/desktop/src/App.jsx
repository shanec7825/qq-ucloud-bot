import React, { useEffect, useState, useSyncExternalStore } from 'react';
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
const COMPONENT_ROWS = [
  { id: 'napcat', label: 'NapCat 运行组件', icon: 'package', optional: false },
  { id: 'codex', label: 'Codex CLI', icon: 'sparkles', optional: true },
];
const SECTION_BY_ACTION = { install: 'components', setup: 'launch', start: 'launch', 'stop-bot': 'launch', workspace: 'workspace', data: 'workspace', home: 'system', 'open-webui': 'launch', login: 'launch', settings: 'launch', switch: 'launch' };

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
  const status = state.status || {}, busy = state.busy, progress = state.progress;

  useEffect(() => {
    const report = state.progress;
    if (!report || !report.done || report.action === 'status') return;
    const section = SECTION_BY_ACTION[report.action] || 'launch';
    const failed = report.ok === false;
    setResults(before => ({ ...before, [section]: { tone: failed ? 'error' : 'success', text: failed ? (report.error || report.message || '操作失败，请重试。') : (report.message || '已完成。') } }));
  }, [state.progress]);

  function send(action) {
    const shell = window.chrome && window.chrome.webview;
    const section = SECTION_BY_ACTION[action] || 'launch';
    if (!shell || typeof shell.postMessage !== 'function') {
      setResults(before => ({ ...before, [section]: { tone: 'error', text: '未连接 QQ Agent 桌面外壳，请在 QQ Agent 桌面窗口中打开本页。' } }));
      return;
    }
    setResults(before => {
      const next = { ...before };
      delete next[section];
      if (action === 'setup') delete next.components;
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

  return <div className="wizard">
    <header className="topbar">
      <span className="brand-mark"><Icon name="bot" size={22}/></span>
      <h1 className="brand-name">QQ Agent</h1>
      <span className="version-badge">{status.version ? 'v ' + status.version : '版本未知'}</span>
      <div className="topbar-workspace">
        <span className="topbar-label">工作区</span>
        <span className="workspace-path">{status.workspace || '尚未选择工作区'}</span>
      </div>
      <ActionButton action="home" variant="ghost" disabled={busy} onAction={send} icon={<Icon name="refresh"/>}>重新检查</ActionButton>
    </header>

    <div className="summary" role="group" aria-label="状态摘要">
      <StatusPill name="QQ 状态" tone={qqState.tone}>{qqState.value}</StatusPill>
      <StatusPill name="机器人" tone={botState.tone}>{botState.value}</StatusPill>
      <StatusPill name="模型" tone={modelState.tone}>{modelState.value}</StatusPill>
      {status.loginPhase && <StatusPill name="登录阶段" tone="default">{String(status.loginPhase)}</StatusPill>}
    </div>

    <div className="wizard-main">
      <SetupCard className="span-all" icon="window" title="系统环境" description="请先确认这台电脑的系统组件齐备，缺项会随附修复指引。"
        feedback={feedback('system')}>
        {known(status.system, SYSTEM_ROWS).map(row => <CheckRow key={row.id} icon={row.icon} name={row.label} state={stateOf(row.ok)}
          detail={row.detail || (row.ok === undefined ? '尚未检测' : '')} help={row.help}>
          {row.id === 'webview2' && row.ok === false && <span className="check-help">
            <a className="setup-link" target="_blank" rel="noopener noreferrer" href="https://developer.microsoft.com/microsoft-edge/webview2/">下载 WebView2 运行时</a>
          </span>}
        </CheckRow>)}
      </SetupCard>

      <SetupCard icon="folder" title="工作区" description="机器人读写作业、记忆与配置的项目目录。"
        actions={<>
          <ActionButton action="workspace" disabled={busy} onAction={send}>选择已有项目</ActionButton>
          <ActionButton action="data" disabled={busy} onAction={send}>打开数据目录</ActionButton>
        </>}
        feedback={status.workspaceError ? <Feedback tone="error" message={String(status.workspaceError)}/> : feedback('workspace')}>
        <p className="path-value">{status.workspace || '尚未选择工作区'}</p>
      </SetupCard>

      <SetupCard icon="package" title="运行时组件" description="NapCat 为必需组件；Codex 用于 AI 能力，可稍后再装。"
        actions={<>
          <ActionButton action="install" variant="primary" disabled={busy} onAction={send} icon={<Icon name="download"/>}>准备运行组件</ActionButton>
        </>}
        feedback={feedback('components')}>
        {known(status.components, COMPONENT_ROWS).map(row => {
          const optional = row.optional !== false && (row.optional === true || row.id === 'codex');
          const tone = row.ok === true ? 'ok' : row.ok === false ? (optional ? 'unknown' : 'fail') : 'unknown';
          return <CheckRow key={row.id} icon={row.icon} state={tone}
            stateLabel={row.ok === true ? '已就绪' : row.ok === false ? '未就绪' : '未检测'}
            name={<>{row.label}<span className={'setup-badge' + (optional ? '' : ' required')}>{optional ? '可选' : '必需'}</span><span className="version-chip">{row.version || '版本未知'}</span></>}
            detail={row.detail || (row.ok === undefined ? '尚未检测' : row.ok ? '已安装' : '未安装')}/>;
        })}
        {showProgress && <div className="progress" role="progressbar" aria-label="运行组件准备进度"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <div className="progress-track"><div className={'progress-fill' + (percent === null ? ' indeterminate' : '')} style={percent === null ? undefined : { width: percent + '%' }}/></div>
          <p className="progress-message">
            {stepText && <span className="progress-step">{stepText}</span>}
            {progress.item && <span className="progress-item">{String(progress.item)}</span>}
            <span className="progress-text">{String(progress.message || '处理中…')}</span>
          </p>
        </div>}
      </SetupCard>

      <SetupCard className="span-all" icon="rocket" title="启动" description="服务就绪后会自动打开 NapCat 原版 WebUI，扫码登录与插件设置都在原版界面完成。"
        actions={<>
          <ActionButton action="start" variant="primary" disabled={busy} onAction={send} icon={<Icon name="play"/>}>启动机器人</ActionButton>
          <ActionButton action="setup" variant="primary" disabled={busy} onAction={send} icon={<Icon name="download"/>}>一键准备并启动</ActionButton>
          <ActionButton action="open-webui" disabled={busy} onAction={send} icon={<Icon name="globe"/>}>打开 NapCat WebUI</ActionButton>
        </>}
        feedback={feedback('launch')}>
        <p className="setup-card-description">首次使用：先准备运行组件，再启动机器人；也可以一键完成全部步骤。</p>
      </SetupCard>
    </div>

    <footer className="footnote">
      窗口关闭后会收起到系统托盘。运行管理、账号切换、停止机器人等都在任务栏托盘图标的右键菜单中操作。服务就绪后本窗口会自动跳转到 NapCat 原版 WebUI。
    </footer>
  </div>;
}
