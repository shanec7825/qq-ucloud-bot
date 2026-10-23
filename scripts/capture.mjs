import { saveSchoolSession } from '../src/core.mjs';
import { sessionFromRequest, successfulSchoolResponse } from '../src/capture-session.mjs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

async function main() {
  const { chromium } = await import('playwright');
  let credentials;
  if (process.argv.includes('--credentials-stdin')) {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = createInterface({ input: process.stdin, terminal: false });
    console.log('等待本次登录凭据；只在内存使用，不保存、不输出。');
    for await (const line of input) { credentials = JSON.parse(line); input.close(); break; }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    if (!credentials?.username || !credentials?.password) throw new Error('缺少本次登录凭据。');
  }
  // 学校认证页在附带的测试版 Chromium 中可能卡住，优先使用本机正式版 Chrome。
  const headless = process.argv.includes('--headless');
  const context = await chromium.launchPersistentContext(fileURLToPath(new URL(headless ? '../data/school-browser-headless/' : '../data/school-browser/', import.meta.url)), {
    headless, channel: process.env.CAPTURE_BROWSER || 'chrome',
  });
  let captured = false;
  let resolveCapture;
  const done = new Promise(resolve => { resolveCapture = resolve; });
  context.on('close', () => resolveCapture(false));
  if (process.argv.includes('--diagnose')) context.on('response', async response => {
    const url = new URL(response.url());
    if (url.origin === 'https://auth.bupt.edu.cn' && response.request().method() === 'POST') {
      let errorHint = '';
      try { const text = await response.text(); errorHint = [...text.matchAll(/(?:用户名或密码错误|密码错误|认证失败|验证码错误|账号锁定|登录失败|登录成功|操作失败|invalid credentials|Invalid credentials)/g)].map(m => m[0]).join(' '); } catch {}
      console.log(JSON.stringify({ authPostPath: url.pathname, status: response.status(), errorHint }));
    }
  });
  const cancel = () => resolveCapture(false);
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  context.on('request', async request => {
    if (captured) return;
    try {
      if (process.argv.includes('--diagnose')) {
        const url = new URL(request.url());
        if (url.hostname === 'apiucloud.bupt.edu.cn') console.log(JSON.stringify({ schoolPath: url.pathname, method: request.method(), queryKeys: [...url.searchParams.keys()] }));
      }
      const session = sessionFromRequest(request.url(), await request.allHeaders());
      if (!session || captured) return;
      captured = true;
      const response = await request.response();
      if (!response || !successfulSchoolResponse(response.status(), await response.json())) { captured = false; return; }
      await saveSchoolSession(new URL('../data/session.json', import.meta.url), { ...session, capturedAt: new Date().toISOString() });
      console.log('学校接口已验证成功，登录态已保存。接下来运行 npm run check 同步最近截止作业。');
      resolveCapture(true);
    } catch { captured = false; console.error('该请求未能完成验证或保存；窗口继续等待，可刷新学校首页重试。'); }
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    console.log(headless ? '正在无界面检查学校认证，不弹出窗口。' : '已打开专用普通 Chrome 学校窗口，登录状态会保存在本机供下次复用。请在此窗口登录并进入首页或课程列表；成功捕获后自动关闭。');
    try { await page.goto(credentials ? 'https://auth.bupt.edu.cn/authserver/login?dev=1&service=https%3A%2F%2Fucloud.bupt.edu.cn' : 'https://ucloud.bupt.edu.cn/', { waitUntil: 'load', timeout: 60000 }); }
    catch { console.error('学校页面暂未加载完成，窗口保持打开。请检查网络后在窗口刷新。'); }
    if (process.argv.includes('--diagnose')) {
      const url = new URL(page.url());
      console.log(JSON.stringify({ origin: url.origin, path: url.pathname, title: await page.title(), passwordVisible: await page.locator('input[type="password"]').first().isVisible().catch(() => false), loginError: (await page.locator('#errorDiv p, .alert-danger').allTextContents()).join(' ').slice(0, 180) }));
    }
    if (credentials) {
      const url = new URL(page.url());
      if (url.origin !== 'https://auth.bupt.edu.cn' || url.pathname !== '/authserver/login') throw new Error('未进入学校认证域名，停止填写。');
      await page.locator('#loginForm input[name="username"]').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#loginForm input[name="username"]').fill(credentials.username);
      await page.locator('#loginForm input[name="password"]').fill(credentials.password);
      await page.locator('#loginForm input[name="type"]').evaluate(input => { input.value = 'username_password'; });
      credentials = null;
      await page.locator('#loginForm input[type="submit"]').click();
      console.log('已向学校提交一次登录；等待学校验证及云邮接口，不会自动重试密码。');
      await page.waitForURL(url => url.hostname !== 'auth.bupt.edu.cn', { timeout: 20000 }).catch(() => {});
      if (!captured) console.log(JSON.stringify({ origin: new URL(page.url()).origin, path: new URL(page.url()).pathname, loginError: (await page.locator('#errorDiv p, .alert-danger').allTextContents()).join(' ').slice(0, 180), ...(new URL(page.url()).origin === 'https://auth.bupt.edu.cn' ? { loginText: (await page.locator('body').innerText()).slice(0, 700) } : {}) }));
    }
    if (!await done) { console.error('学校窗口已关闭或捕获已取消，尚未保存新登录态。'); process.exitCode = 1; }
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); await context.close(); }
}
main().catch(error => { console.error(error.name === 'TimeoutError' ? '学校登录页未在等待时间内完成加载；没有确认登录成功。' : '学校登录流程未完成（' + error.name + '），没有确认登录成功。'); process.exitCode = 1; });
