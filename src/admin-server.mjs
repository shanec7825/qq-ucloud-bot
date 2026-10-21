import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { loginSchool } from './school-login.mjs';
import { saveJSON } from './core.mjs';
import { memoryScope } from './managed-memory.mjs';
import { GROUP_TEMPLATES } from './group-templates.mjs';

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
async function body(request) {
  if (!String(request.headers['content-type'] || '').startsWith('application/json')) fail(415, '请使用 JSON 请求。');
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 100000) fail(413, '请求过大。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON 格式无效。'); }
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startAdmin({ store, vault, runtime, root = new URL('../data/', import.meta.url), port = 6100, login = loginSchool, now = Date.now }) {
  let napcatOrigin;
  try { const ui = JSON.parse(await readFile(new URL('napcat-ui.json', root), 'utf8')); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(ui.origin)) napcatOrigin = ui.origin; } catch {}
  let accessKey;
  const keyFile = new URL('admin-access.key', root);
  try { accessKey = (await readFile(keyFile, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; accessKey = randomBytes(32).toString('base64url'); await writeFile(keyFile, accessKey, { flag: 'wx', mode: 0o600 }); }
  if (!/^[\w-]{43}$/.test(accessKey)) throw new Error('本机管理密钥格式错误，请检查 data/admin-access.key。');
  const sessions = new Map(); let origin, loginBusy = false, attempts = { count: 0, since: now() };
  const validSession = token => { const session = sessions.get(token); if (!session || session.expires < now()) { sessions.delete(token); return null; } return session; };
  const server = createServer(async (req, res) => {
    const json = (value, status = 200, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(value)); };
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      // Binding to loopback plus an exact Host check prevents DNS rebinding.
      if (req.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !req.url.startsWith('/') || req.url.startsWith('//')) fail(403, '只允许本机管理地址。');
      const url = new URL(req.url, origin), route = url.pathname;
      if (route === '/' && req.method === 'GET') { res.writeHead(303, { location: (napcatOrigin || 'http://127.0.0.1:6099') + '/webui/plugins#' }); res.end(); return; }
      if (route === '/oauth/google/callback' && req.method === 'GET') {
        if (url.searchParams.has('error')) fail(400, 'Google 授权未完成，请返回管理台重试。');
        await runtime.google.complete(url.searchParams.get('state'), url.searchParams.get('code'), token => !!validSession(token));
        runtime.checks.drive = { ok: true, message: 'Google 只读授权已完成，请测试连接。', checkedAt: new Date().toISOString() };
        res.writeHead(303, { location: napcatOrigin ? napcatOrigin + '/webui/plugins#' : '/#connections' }); res.end(); return;
      }
      if (!route.startsWith('/api/')) fail(404, '页面不存在。');
      if (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') fail(403, '请从本机管理台操作。');
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) fail(403, '请求来源无效。');
      if (route === '/api/session' && req.method === 'POST') {
        if (now() - attempts.since > 60000) attempts = { count: 0, since: now() };
        if (attempts.count >= 8) fail(429, '登录尝试过多，请一分钟后重试。');
        const input = await body(req);
        if (!equal(input.key, accessKey)) { attempts.count++; fail(401, '管理密钥不正确，请用本机启动链接打开。'); }
        attempts.count = 0;
        for (const [key] of sessions) validSession(key);
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
        sessions.set(token, { csrf, expires: now() + 12 * 3600000 });
        json({ csrf }, 200, { 'set-cookie': `slyra_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` }); return;
      }
      const token = /(?:^|;\s*)slyra_admin=([\w-]+)/.exec(req.headers.cookie || '')?.[1], session = validSession(token);
      if (!session) fail(401, '请先登录本机管理台。');
      if (!['GET', 'HEAD'].includes(req.method) && !equal(req.headers['x-csrf-token'], session.csrf)) fail(403, '操作校验失效，请刷新管理台。');
      if (route === '/api/session' && req.method === 'GET') { json({ csrf: session.csrf }); return; }
      if (route === '/api/logout' && req.method === 'POST') { sessions.delete(token); json({ ok: true }, 200, { 'set-cookie': 'slyra_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return; }
      if (route === '/api/state' && req.method === 'GET') { json({ settings: store.get(), groupTemplates: GROUP_TEMPLATES, secrets: vault.flags(), status: await runtime.status(), googleRedirectURI: origin + '/oauth/google/callback' }); return; }
      if (route === '/api/workspace' && req.method === 'GET') { json(runtime.workspace()); return; }
      if (route === '/api/inbox' && req.method === 'GET') { json(await runtime.inbox.list()); return; }
      if (route === '/api/inbox/item' && req.method === 'PUT') {
        const input = await body(req);
        if (!input || Object.keys(input).sort().join() !== 'id,status' || typeof input.id !== 'string' || !['pending', 'done', 'archived'].includes(input.status)) fail(400, '事项身份或状态无效。');
        json({ item: await runtime.inbox.setStatus(input.id, input.status) }); return;
      }
      if (route === '/api/runtime/stop' && req.method === 'POST') {
        runtime.stop(); res.once('finish', () => { server.close(); server.closeAllConnections(); }); json({ ok: true }); return;
      }
      if (route === '/api/settings' && req.method === 'PUT') {
        const input = await body(req), old = store.get();
        const next = await store.update(input.settings, input.revision);
        // A different OAuth client must obtain its own grant, never reuse a prior account token.
        if (old.drive.clientId !== next.drive.clientId) await vault.set({ googleTokens: null });
        runtime.checks = {}; runtime.apply(); json({ settings: next }); return;
      }
      if (route === '/api/secrets' && req.method === 'PUT') {
        const input = await body(req), allowed = ['onebotToken', 'openaiKey', 'githubToken', 'googleClientSecret'];
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key))) fail(400, '不支持的密钥字段。');
        if (Object.hasOwn(input, 'googleClientSecret') && input.googleClientSecret !== vault.get('googleClientSecret')) input.googleTokens = null;
        const flags = await vault.set(input); runtime.checks = {}; runtime.apply(); json({ secrets: flags }); return;
      }
      if (route === '/api/ucloud/login' && req.method === 'POST') {
        if (loginBusy || runtime.syncing) fail(409, '学校登录或同步正在进行，请稍后重试。');
        const input = await body(req);
        if (typeof input.username !== 'string' || !input.username.trim() || input.username.length > 80 || typeof input.password !== 'string' || !input.password || input.password.length > 500) fail(400, '请填写学号和密码。');
        loginBusy = true; runtime.schoolLoginBusy = true;
        try { const result = await login(input.username.trim(), input.password); input.password = ''; await saveJSON(new URL('session.json', root), result); runtime.lastPoll = 0; runtime.checks.ucloud = { ok: true, message: '学校登录成功，密码未保存；可同步作业。', checkedAt: new Date().toISOString() }; json({ ok: true }); }
        catch (error) { fail(400, /CAPTCHA/.test(error.code || '') ? '学校要求验证码，请使用浏览器登录备用流程。' : '学校登录未成功，请检查账号、密码或学校网络。'); }
        finally { input.password = ''; loginBusy = false; runtime.schoolLoginBusy = false; }
        return;
      }
      if (route === '/api/google/authorize' && req.method === 'POST') { json(runtime.google.begin(origin, token)); return; }
      if (/^\/api\/check\/(github|drive|ucloud|model)$/.test(route) && req.method === 'POST') { json(await runtime.check(route.split('/').at(-1))); return; }
      if (route === '/api/groups' && req.method === 'GET') { json({ groups: await runtime.groups() }); return; }
      if (route === '/api/codex/account' && req.method === 'GET') { json(await runtime.account.status()); return; }
      if (route === '/api/codex/login' && req.method === 'POST') { json(await runtime.account.begin()); return; }
      if (route === '/api/monitor' && req.method === 'GET') { json(await runtime.monitor.status()); return; }
      if (route === '/api/monitor/run' && req.method === 'POST') {
        const input = await body(req);
        if (!input || Object.keys(input).some(key => key !== 'groupId') || input.groupId !== undefined && !/^\d{5,15}$/.test(input.groupId)) fail(400, '监测群号无效。');
        if (runtime.handler.isBusy()) fail(409, '正在处理聊天消息，请稍后整理。');
        json(await runtime.monitor.run({ force: true, groupId: input.groupId })); return;
      }
      if (route === '/api/memory' && req.method === 'GET') {
        const config = store.get(); const digests = await Promise.all(config.groups.map(async g => ({ groupId: g.id, name: g.name, digest: await runtime.notes.digest(g.id) })));
        json({ notes: await runtime.notes.list(), conversations: runtime.memory.list(), digests }); return;
      }
      if (route === '/api/memory/notes' && req.method === 'PUT') { json({ note: await runtime.notes.put(await body(req)) }); return; }
      if (/^\/api\/memory\/notes\/[\w-]+$/.test(route) && req.method === 'DELETE') { await runtime.notes.remove(route.split('/').at(-1)); json({ ok: true }); return; }
      if (route === '/api/memory/digest' && req.method === 'PUT') {
        const input = await body(req); if (!store.get().groups.some(g => g.id === input.groupId)) fail(400, '请先配置该群组。');
        await runtime.notes.saveDigest(input.groupId, input.summary); json({ ok: true }); return;
      }
      if (route === '/api/memory/conversations' && req.method === 'DELETE') {
        const input = await body(req); if (input.scope !== 'all') memoryScope(input.scope);
        runtime.memory.clear(input.scope); json({ ok: true }); return;
      }
      fail(404, '接口不存在。');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json({ error: error instanceof SyntaxError ? '返回内容格式异常，请检查配置或重新授权。' : error instanceof TypeError ? '请求格式或网络连接异常，请检查后重试。' : error.message || '操作未完成。' }, error.status || 400);
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  await saveJSON(new URL('admin-info.json', root), { origin, pid: process.pid, startedAt: new Date().toISOString() });
  await writeFile(new URL('admin-launch.html', root), '<!doctype html><meta charset="utf-8"><title>打开机器人管理台</title><h1>本机机器人管理台</h1><p>该链接含本机管理密钥，请勿分享。</p><a href="' + origin + '/#key=' + accessKey + '">打开管理台</a>', { mode: 0o600 });
  return { server, origin, accessKey, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
