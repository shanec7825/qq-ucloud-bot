// Protocol v1 bridge between the WinForms+WebView2 shell and the setup wizard.
// Shell -> page: window.renderStatus(status) and window.renderProgress(progress).
// Page -> shell: window.chrome.webview.postMessage('<action>').
// home.html installs a bootstrap queue first so both render* functions exist before this bundle runs.

const LONG_ACTIONS = new Set(['install', 'start', 'setup', 'stop-bot']);
const DEFAULT_MESSAGE = {
  install: '正在准备运行组件，首次下载可能需要几分钟…',
  start: '正在启动机器人…',
  setup: '正在准备组件并启动机器人…',
  'stop-bot': '正在停止机器人…',
};

export function createBridgeStore() {
  let snapshot = { status: {}, progress: null, busy: false, activeAction: null };
  const listeners = new Set();
  const emit = next => { snapshot = next; for (const listener of listeners) listener(); };

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; },
    // A status refresh always restores the buttons and clears the transient progress display.
    setStatus(value) {
      emit({ status: value && typeof value === 'object' ? value : {}, progress: null, busy: false, activeAction: null });
    },
    setProgress(value) {
      const progress = value && typeof value === 'object' ? value : null;
      if (!progress) return;
      const action = typeof progress.action === 'string' ? progress.action : '';
      // The 12s status poll also completes with {action:'status',done:true}; it must never disturb the wizard.
      if (action === 'status') return;
      if (!progress.done) {
        emit({ ...snapshot, progress, busy: true, activeAction: snapshot.activeAction || action || null });
        return;
      }
      // done:true ends the run. "setup" chains install/start completions before its own closing done event,
      // so a setup run stays busy until that final {action:'setup',done:true} arrives.
      const waiting = snapshot.activeAction === 'setup' && action !== 'setup';
      emit({ ...snapshot, progress, busy: waiting, activeAction: waiting ? snapshot.activeAction : null });
    },
    // Arms the busy state as soon as the user starts a long-running shell action.
    beginAction(action) {
      if (!LONG_ACTIONS.has(action)) return;
      emit({ ...snapshot, busy: true, activeAction: action, progress: { action, message: DEFAULT_MESSAGE[action] || '正在处理…', done: false } });
    },
  };
}

export function installBridge(store) {
  const pending = Array.isArray(window.__qqAgentEvents) ? window.__qqAgentEvents : [];
  window.__qqAgentEvents = [];
  window.renderStatus = value => store.setStatus(value);
  window.renderProgress = value => store.setProgress(value);
  for (const event of pending) {
    if (!Array.isArray(event)) continue;
    if (event[0] === 'status') store.setStatus(event[1]); else store.setProgress(event[1]);
  }
}
