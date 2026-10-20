// Opt-in live local UI verification. Saves current settings unchanged; never calls a model or sends QQ messages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
if (!process.argv.includes('--live')) throw new Error('使用 --live 验证本机 NapCat 插件配置。');
const config = JSON.parse(await readFile(new URL('../tools/napcat/napcat/config/webui.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: process.env.CAPTURE_BROWSER || 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => { if (!(error.message === 'Unauthorized' && error.stack?.includes('/webui/assets/'))) errors.push(error.message); });
  await page.goto('http://127.0.0.1:6099/webui/web_login');
  await page.getByPlaceholder(/token/i).fill(config.token); await page.locator('button').filter({ hasText: /^\s*登录\s*$/ }).click();
  await page.waitForURL(url => !url.pathname.includes('web_login'));
  await page.goto('http://127.0.0.1:6099/webui/plugins');
  const open = async plugin => {
    const card = page.locator('div.group.w-full').filter({ has: page.getByRole('heading', { name: plugin.name, exact: true }) });
    await card.waitFor({ state: 'visible' }); assert.equal(await card.getByRole('button').count(), 2);
    await card.getByRole('button').first().click();
    const panel = page.frameLocator('iframe[data-qq-agent]'); await panel.locator('#shell').waitFor({ state: 'visible' });
    assert.equal(await panel.locator('body').getAttribute('data-module'), plugin.module); assert.equal(await panel.locator('#login').isVisible(), false); return panel;
  };
  for (const plugin of PLUGIN_MODULES) {
    const panel = await open(plugin);
    if (plugin.module === 'core') {
      await panel.locator('#codex-status').click(); await panel.locator('#codex-account-state').filter({ hasText: /已登录|尚未|等待/ }).waitFor();
      await panel.locator('[data-tab="memory"]').click(); await panel.locator('#note-scope option').first().waitFor({ state: 'attached' });
      await panel.locator('[data-tab="bot"]').click();
    } else if (plugin.module === 'notices') {
      await panel.locator('#monitor-tools').waitFor({ state: 'visible' }); await panel.locator('#refresh-monitor').click();
    } else {
      assert.equal(await panel.locator('[data-service="' + plugin.module + '"]').isVisible(), true);
      for (const service of ['github', 'drive', 'ucloud'].filter(name => name !== plugin.module)) assert.equal(await panel.locator('[data-service="' + service + '"]').isVisible(), false);
    }
    await panel.locator('#save-settings').click(); await panel.locator('#feedback').filter({ hasText: '已保存并应用' }).waitFor();
    await page.screenshot({ path: fileURLToPath(new URL('../data/napcat-module-' + plugin.module + '.png', import.meta.url)), fullPage: true,
      mask: [panel.locator('[data-setting="bot.ownerQQ"]'), panel.locator('[data-setting="monitor.recipientQQ"]')] });
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isVisible(), false);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.evaluate(() => localStorage.setItem('side-bar-open', 'false')); await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  const panel = await open(PLUGIN_MODULES.find(plugin => plugin.module === 'notices'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await panel.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../data/napcat-module-mobile.png', import.meta.url)), fullPage: true,
    mask: [panel.locator('[data-setting="monitor.recipientQQ"]')] });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, moduleConfigWindows: 5, modelRequests: 0, qqMessagesSent: 0 }));
} finally { await browser.close(); }
