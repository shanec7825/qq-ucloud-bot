// Live local UI verification. Saves current settings unchanged; never invokes the model or sends QQ messages.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
if (!process.argv.includes('--live')) throw new Error('使用 --live 验证本机已安装的 NapCat 页面。');
const config = JSON.parse(await readFile(new URL('../tools/napcat/napcat/config/webui.json', import.meta.url), 'utf8'));
const folder = new URL('../data/', import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CAPTURE_BROWSER || 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage(), errors = []; let nativeLoginChecks = 0;
  page.on('pageerror', error => {
    if (error.message === 'Unauthorized' && error.stack?.includes('/webui/assets/') && !error.stack.includes('/plugin/napcat-plugin-slyra/')) nativeLoginChecks++;
    else errors.push(error.message);
  });
  await page.goto('http://127.0.0.1:6099/webui/web_login');
  await page.getByPlaceholder(/token/i).fill(config.token);
  await page.locator('button').filter({ hasText: /^\s*登录\s*$/ }).click();
  await page.waitForURL(url => !url.pathname.includes('web_login'), { timeout: 30000 });
  await page.goto('http://127.0.0.1:6099/webui/extension');
  const panel = page.frameLocator('iframe[title="extension-page"]');
  await panel.locator('#shell').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await panel.locator('body').getAttribute('data-napcat'), 'true');
  assert.equal(await panel.locator('#login').isVisible(), false);
  assert.ok(await panel.locator('[data-setting="bot.name"]').inputValue());
  await panel.locator('#save-settings').click();
  await panel.locator('#feedback').filter({ hasText: '已保存并应用' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('napcat-slyra-desktop.png', folder)), fullPage: true,
    mask: [panel.locator('[data-setting="bot.ownerQQ"]')] });
  await panel.locator('[data-tab="connections"]').click();
  await panel.locator('[data-view="connections"]').waitFor({ state: 'visible' });
  for (const section of ['school.enabled', 'github.authMode', 'drive.authMode']) assert.equal(await panel.locator('[data-setting="' + section + '"]').isVisible(), true);
  await panel.locator('[data-tab="groups"]').click(); await panel.locator('[data-view="groups"]').waitFor({ state: 'visible' }); assert.equal(await panel.locator('#group-list').isVisible(), true);
  await panel.locator('[data-tab="memory"]').click(); await panel.locator('#note-scope option').first().waitFor({ state: 'attached' });
  assert.equal(await panel.locator('#note-form').isVisible(), true); assert.equal(await panel.locator('#digest-text').isVisible(), true);
  await page.screenshot({ path: fileURLToPath(new URL('napcat-slyra-memory.png', folder)), fullPage: true });
  // Native tabs sit in a pointer-drag strip in some builds; keyboard activation is reliable.
  await page.getByRole('tab', { name: '群通知整理 (群通知整理)', exact: true }).press('Space');
  await panel.locator('body[data-plugin="napcat-plugin-slyra-monitor"]').waitFor({ state: 'visible' });
  await panel.locator('#monitor-tools').waitFor({ state: 'visible' });
  assert.equal(await panel.locator('[data-setting="monitor.enabled"]').isVisible(), true);
  assert.equal(await panel.locator('[data-setting="monitor.recipientQQ"]').isVisible(), true);
  await panel.locator('#refresh-monitor').click();
  await panel.locator('#save-settings').click();
  await panel.locator('#feedback').filter({ hasText: '已保存并应用' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('napcat-slyra-monitor.png', folder)), fullPage: true,
    mask: [panel.locator('[data-setting="monitor.recipientQQ"]')] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('side-bar-open', 'false'));
  await page.reload(); await panel.locator('#shell').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: '群通知整理 (群通知整理)', exact: true }).press('Space');
  await panel.locator('#monitor-tools').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await panel.locator('html').evaluate(node => node.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('napcat-slyra-mobile.png', folder)), fullPage: true,
    mask: [panel.locator('[data-setting="monitor.recipientQQ"]')] });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, nativeLoginChecks, checks: ['NapCat实际口令登录', '两个插件免二次登录', '配置原值保存', '所有服务/群组/记忆控件', '通知设置与报告', '移动端布局'], modelCalls: 0, sentQQMessages: 0 }));
} finally { await browser.close(); }
