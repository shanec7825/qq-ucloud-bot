import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function allowedRoute(method, path) {
  const rules = { GET: /^(?:session|state|workspace|inbox|groups|memory|monitor|codex\/account)$/,
    PUT: /^(?:settings|secrets|inbox\/item|memory\/notes|memory\/digest)$/,
    POST: /^(?:runtime\/stop|codex\/login|monitor\/run|ucloud\/login|google\/authorize|check\/(?:github|drive|ucloud|model))$/,
    DELETE: /^(?:memory\/conversations|memory\/notes\/[\w-]{1,100})$/ };
  return typeof method === 'string' && Object.hasOwn(rules, method) && typeof path === 'string' && rules[method].test(path);
}

export class AdminBridge {
  constructor(projectRoot, fetcher = fetch) { this.root = projectRoot; this.fetch = fetcher; }
  async session() {
    if (!this.login) this.login = (async () => {
      const info = JSON.parse(await readFile(join(this.root, 'data', 'admin-info.json'), 'utf8'));
      const origin = new URL(info.origin);
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid local origin');
      const key = (await readFile(join(this.root, 'data', 'admin-access.key'), 'utf8')).trim();
      if (!/^[\w-]{43}$/.test(key)) throw new Error('Invalid management key');
      const response = await this.fetch(origin.origin + '/api/session', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { origin: origin.origin, 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error('Local authentication failed');
      const csrf = (await response.json()).csrf, cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (typeof csrf !== 'string' || !cookie?.startsWith('slyra_admin=')) throw new Error('Invalid local session');
      return { origin: origin.origin, csrf, cookie };
    })().catch(error => { this.login = null; throw error; });
    return this.login;
  }
  async request(method, path, value, retry = true) {
    if (!allowedRoute(method, path)) return { status: 400, data: { error: '不支持的配置操作。' } };
    if (JSON.stringify(value ?? null).length > 90000) return { status: 413, data: { error: '请求内容过大。' } };
    const session = await this.session();
    // The bridge cookie, bootstrap key and CSRF token never leave the plugin server.
    if (path === 'session') return { status: 200, data: { csrf: 'napcat-session' } };
    const response = await this.fetch(session.origin + '/api/' + path, { method, redirect: 'error', signal: AbortSignal.timeout(190000),
      headers: { origin: session.origin, cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': 'application/json' },
      ...(method !== 'GET' ? { body: JSON.stringify(value ?? {}) } : {}) });
    if ([401, 403].includes(response.status) && retry) { this.login = null; return this.request(method, path, value, false); }
    return { status: response.status, data: await response.json() };
  }
}

export function registerBridge(ctx, bridge) {
  // Authenticated NapCat API only. Never register a NoAuth management route.
  ctx.router.post('/bridge', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) { res.status(403).json({ error: '请在 NapCat 页面操作。' }); return; } }
      catch { res.status(403).json({ error: '无效来源。' }); return; }
    }
    try {
      const { method, path, value } = req.body || {};
      const result = await bridge.request(method, path, value);
      res.status(result.status).json(result.data);
    } catch { res.status(503).json({ error: '机器人服务未连接，请确认 slyra 服务正在运行后重试。' }); }
  });
}
