import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: process.env.CAPTURE_BROWSER || 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();
const safeURL = value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return ''; } };
const errors = [];
page.on('pageerror', error => errors.push({ kind: 'script', message: error.message.slice(0, 250) }));
page.on('requestfailed', request => errors.push({ kind: 'request', url: safeURL(request.url()), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'http', url: safeURL(response.url()), status: response.status() }); });
try {
  await page.goto('https://auth.bupt.edu.cn/authserver/login?service=https://ucloud.bupt.edu.cn', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('input[type="password"]'), null, { timeout: 15000 }).catch(() => {});
  console.log(JSON.stringify({ browser: process.env.CAPTURE_BROWSER || 'chrome', origin: safeURL(page.url()), passwordVisible: await page.locator('input[type="password"]').first().isVisible(), page: await page.evaluate(() => ({ title: document.title, passwordInputs: document.querySelectorAll('input[type="password"]').length, scriptCount: document.scripts.length, frames: document.querySelectorAll('iframe').length })), errors }, null, 2));
} catch (error) { console.log(JSON.stringify({ error: error.message.slice(0, 300), errors })); }
finally { await browser.close(); }
