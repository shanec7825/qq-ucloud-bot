// File-only launcher fixtures. The desktop bridge records requests; no service is started or stopped.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const output = new URL('data/', root);
const errors = [], externalRequests = [];
const richStatus = {
  version: '2.2.0', workspace: 'D:\\fixture\\QQ Agent 项目', qqLoggedIn: false,
  webuiAvailable: false, botConnected: false, botName: '课程助手', model: 'MiMo 测试模型',
  system: [
    { id: 'os', label: 'Windows 11', ok: true, detail: 'Windows 11 23H2' },
    { id: 'dotnet', ok: true, detail: '.NET Desktop Runtime 8.0' },
    { id: 'webview2', ok: true, detail: 'WebView2 已安装' },
    { id: 'node', ok: true, detail: 'Node.js v24' },
    { id: 'powershell', ok: true, detail: 'PowerShell 7.4' },
  ],
  components: [
    { id: 'napcat', ok: true, version: 'NapCat 4.x', detail: '已安装' },
    { id: 'codex', ok: true, version: 'Codex CLI', detail: 'ChatGPT 认证已就绪', optional: true },
    { id: 'mimo', ok: true, version: 'MiMo v2.6', detail: '已配置测试模型', optional: true },
  ],
  ports: [
    { port: 6099, label: 'NapCat WebUI', role: 'required' },
    { port: 3001, label: 'OneBot', role: 'required' },
    { port: 6100, label: '管理接口', role: 'required', detail: '仅本机访问' },
  ],
};

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CAPTURE_BROWSER || 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await context.route(/^https?:\/\//, route => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__launcherActions = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: action => window.__launcherActions.push(action) };
  });
  await page.goto(new URL('desktop/assets/home.html', root).href);
  await page.locator('.launch-hub').waitFor();

  async function status(value) {
    await page.evaluate(async next => {
      window.renderStatus(next);
      await new Promise(requestAnimationFrame);
    }, value);
  }
  async function progress(value) {
    await page.evaluate(async next => {
      window.renderProgress(next);
      await new Promise(requestAnimationFrame);
    }, value);
  }
  async function busy(expected) {
    await page.waitForFunction(disabled => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.length > 0 && buttons.every(button => button.disabled === disabled);
    }, expected);
  }
  async function action(name, expected) {
    const previous = await page.evaluate(() => window.__launcherActions.length);
    await page.getByRole('button', { name, exact: true }).click();
    const actions = await page.evaluate(() => window.__launcherActions);
    assert.equal(actions.length, previous + 1, name + ' sends one bridge request');
    assert.equal(actions.at(-1), expected, name + ' sends the original protocol action');
  }
  const diagnostics = page.locator('details.diagnostic-panel');

  // Rich v2 status, legacy subsets and missing payloads all retain stable fallback rows.
  await status(richStatus);
  assert.equal(await page.locator('.check-row').count(), 11, '5 system + 3 component + 3 port rows');
  assert.equal(await page.locator('.check-state.ok').count(), 11);
  assert.match(await page.locator('.summary').innerText(), /MiMo 测试模型/);
  assert.equal(await diagnostics.nth(0).getAttribute('open'), null, 'healthy environment stays collapsed');
  assert.equal(await diagnostics.nth(1).getAttribute('open'), null, 'healthy connections stay collapsed');
  await status({
    ...richStatus,
    system: richStatus.system.map(row => row.id === 'webview2' ? { ...row, ok: false, detail: '未安装 WebView2', help: '安装后重新检查。' } : row),
    components: richStatus.components.slice(0, 2),
  });
  assert.notEqual(await diagnostics.nth(0).getAttribute('open'), null, 'failed environment expands automatically');
  assert.equal(await page.getByRole('link', { name: '下载 WebView2 运行时' }).getAttribute('href'), 'https://developer.microsoft.com/microsoft-edge/webview2/');
  assert.equal(await page.locator('.check-row').count(), 11, 'missing MiMo still has a fallback row');
  await status({ qqLoggedIn: true, botConnected: true, model: 'legacy-model', workspace: 'D:\\legacy' });
  assert.equal(await page.locator('.check-row').count(), 8);
  assert.equal(await page.locator('.check-state.unknown').count(), 8);
  assert.match(await page.locator('.summary').innerText(), /legacy-model/);
  for (const missing of [{}, null]) {
    await status(missing);
    assert.equal(await page.locator('.check-row').count(), 8);
    assert.equal(await page.locator('.check-state.unknown').count(), 8);
    assert.equal(await page.locator('.ports-card .empty-label').textContent(), '未检测');
    assert.match(await page.locator('.workspace-card .path-value').innerText(), /尚未选择工作区/);
  }

  // Only the closing setup event releases the UI; nested completions and polling cannot interrupt it.
  await action('一键准备并启动', 'setup');
  await busy(true);
  assert.equal(await page.locator('[role=progressbar]').isVisible(), true);
  await progress({ action: 'install', step: 2, item: 'napcat', message: '正在下载测试组件', percent: 42 });
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '42');
  await progress({ action: 'install', message: '组件准备完成', done: true, ok: true });
  await busy(true);
  await progress({ action: 'start', step: 1, message: '正在启动测试服务' });
  await progress({ action: 'start', message: '测试服务已就绪', done: true, ok: true });
  await busy(true);
  await progress({ action: 'status', message: 'poll-must-stay-invisible', done: true, ok: true });
  await busy(true);
  assert.equal(await page.getByText('poll-must-stay-invisible').count(), 0);
  await progress({ action: 'setup', message: '测试启动完成', done: true, ok: true });
  await busy(false);
  assert.equal(await page.locator('[role=progressbar]').count(), 0);
  await progress({ action: 'status', done: true, ok: true });
  await busy(false);

  // Standalone preparation/start and error routing keep the same shell contract.
  await action('准备运行组件', 'install');
  await busy(true);
  await progress({ action: 'install', message: '测试组件已就绪', percent: 100, done: true, ok: true });
  await busy(false);
  await action('启动机器人', 'start');
  await busy(true);
  await progress({ action: 'start', done: true, ok: false, error: 'fixture 启动错误：请检查运行组件' });
  await busy(false);
  assert.equal(await page.locator('.launch-hub .feedback.error').isVisible(), true);
  assert.match(await page.locator('.launch-hub .feedback.error').innerText(), /fixture 启动错误/);

  // Workspace mismatch, port cleanup and model settings only record mock requests.
  await status({
    ...richStatus, workspaceError: 'workspace-mismatch：6099 来自其它项目。',
    conflict: { owners: ['C:\\other\\tools\\napcat\\napcat.exe'], ports: [6099] },
    ports: [...richStatus.ports,
      { port: 7000, label: '调试端口', role: 'extra', detail: '配置中的多余监听' },
      { port: 5600, label: '其它工作区', role: 'foreign', detail: '其它后台占用' },
    ],
  });
  assert.equal(await page.locator('.check-row').count(), 13);
  assert.match(await page.locator('.workspace-card .feedback.error').innerText(), /workspace-mismatch/);
  assert.notEqual(await diagnostics.nth(1).getAttribute('open'), null);
  await action('去配置', 'settings');
  await busy(false);
  await action('关闭其它后台并继续', 'stop-conflict');
  await busy(true);
  await progress({ action: 'stop-conflict', done: true, ok: true, message: '模拟冲突恢复完成' });
  await busy(false);
  await action('关闭多余端口', 'trim-ports');
  await busy(true);
  await progress({ action: 'trim-ports', done: true, ok: true, message: '模拟剪裁完成' });
  await busy(false);
  await action('关闭其它后台', 'stop-conflict');
  await progress({ action: 'stop-conflict', done: true, ok: true, message: '模拟关闭完成' });
  await busy(false);
  await status(richStatus);
  assert.equal(await page.getByRole('button', { name: '关闭其它后台并继续' }).count(), 0);
  for (const [name, expected] of [['重新检查', 'home'], ['选择已有项目', 'workspace'], ['打开数据目录', 'data'], ['打开 NapCat WebUI', 'open-webui']]) await action(name, expected);

  // Responsive screenshots cover the same page in both themes with long user-supplied values.
  await status({ ...richStatus, workspace: 'D:\\fixture\\名称很长的课程资料和机器人工作区\\QQ Agent 项目', model: 'MiMo / Codex 用于验证窄屏的长模型名称' });
  for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, width + ' ' + theme + ' has no horizontal overflow');
    assert.notEqual(await page.locator('.ambient-colors i').first().evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.screenshot({ path: fileURLToPath(new URL('ui-refresh-launcher-' + width + '-' + theme + '.png', output)), fullPage: true, animations: 'disabled' });
  }

  // Reduced motion removes ambient/progress animations; keyboard users see focus and can operate details.
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  assert.equal(await page.locator('.ambient-colors i').first().evaluate(node => getComputedStyle(node).animationName), 'none');
  await progress({ action: 'install', message: '测试不确定进度' });
  assert.equal(await page.locator('.progress-fill.indeterminate').evaluate(node => getComputedStyle(node).animationName), 'none');
  await progress({ action: 'install', done: true, ok: true, message: '已完成' });
  await busy(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.locator('.launch-hub').waitFor();
  await status(richStatus);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '重新检查');
  assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true);
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '一键准备并启动');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__launcherActions.at(-1)), 'setup');
  await progress({ action: 'setup', done: true, ok: true, message: '键盘测试完成' });
  await busy(false);
  await diagnostics.nth(0).locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.notEqual(await diagnostics.nth(0).getAttribute('open'), null);
  await page.keyboard.press('Space');
  assert.equal(await diagnostics.nth(0).getAttribute('open'), null);

  assert.deepEqual(errors, [], 'no browser errors');
  assert.deepEqual(externalRequests, [], 'no external requests or real backend access');
  console.log('Launcher UI checks passed: rich/legacy/missing status; setup/install/start and nested progress; polling/errors; workspace recovery/ports/model callback; 375/1440 light/dark; reduced motion and keyboard. All desktop actions were mocked.');
} finally {
  await browser.close();
}
