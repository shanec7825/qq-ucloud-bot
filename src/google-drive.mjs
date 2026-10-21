import { randomBytes, createHash } from 'node:crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const escaped = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function bounded(response, limit = 1024 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Google 请求失败（HTTP ${response.status}），请检查授权和 Drive API。`); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('Google 返回内容过大。'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
export class GoogleDrive {
  constructor({ settings, vault, fetcher = fetch, now = Date.now }) { this.settings = settings; this.vault = vault; this.fetcher = fetcher; this.now = now; this.pending = new Map(); }
  begin(origin, session, { write = false } = {}) {
    const config = this.settings().drive;
    if (write && config.accessMode !== 'write') throw new Error('请先在管理台明确启用 Drive 写入授权。');
    const scope = write ? 'https://www.googleapis.com/auth/drive' : DRIVE_SCOPE;
    if (!config.clientId || !this.vault.get('googleClientSecret')) throw new Error('请先保存 Google OAuth Client ID 和 Client Secret。');
    if (this.pending.size >= 20) throw new Error('授权请求过多，请稍后再试。');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const redirect = origin + '/oauth/google/callback';
    for (const [key, value] of this.pending) if (value.expires < this.now()) this.pending.delete(key);
    this.pending.set(state, { verifier, redirect, session, scope, clientId: config.clientId, clientSecret: this.vault.get('googleClientSecret'), expires: this.now() + 600000 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect, response_type: 'code', scope,
      access_type: 'offline', prompt: 'consent', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    return { url: url.href, redirectURI: redirect };
  }
  async tokenRequest(body) {
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    return JSON.parse(await bounded(response, 32000));
  }
  async complete(state, code, validSession) {
    const request = this.pending.get(state); this.pending.delete(state);
    if (!request || request.expires < this.now() || !validSession(request.session) || typeof code !== 'string' || code.length > 4000) throw new Error('Google 授权已过期，请回管理台重新连接。');
    const config = this.settings().drive;
    if (config.clientId !== request.clientId || this.vault.get('googleClientSecret') !== request.clientSecret) throw new Error('Google 客户端配置已改变，请重新连接。');
    const token = await this.tokenRequest({ client_id: request.clientId, client_secret: request.clientSecret, code, redirect_uri: request.redirect, grant_type: 'authorization_code', code_verifier: request.verifier });
    if (!token.access_token || !token.refresh_token || token.scope && !token.scope.split(' ').includes(request.scope)) throw new Error('未取得要求的 Drive 授权或续期凭据，请重新授权。');
    if (request.scope !== DRIVE_SCOPE && config.accessMode !== 'write') throw new Error('写入授权配置已改变，请重新连接。');
    await this.vault.set({ googleTokens: JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token, scopes: (token.scope || request.scope).split(' '), expires: this.now() + Number(token.expires_in || 3600) * 1000, clientId: request.clientId }) });
    this.authorizationRevision = (this.authorizationRevision || 0) + 1;
  }
  async accessToken() {
    const saved = this.vault.get('googleTokens');
    if (!saved) throw new Error('请先在管理台连接 Google Drive。');
    const token = JSON.parse(saved), clientId = this.settings().drive.clientId;
    if (token.clientId !== clientId) throw new Error('Google 客户端已改变，请重新授权。');
    if (token.expires > this.now() + 60000) return token.access_token;
    if (!this.refreshing) this.refreshing = (async () => {
      const next = await this.tokenRequest({ client_id: clientId, client_secret: this.vault.get('googleClientSecret'), refresh_token: token.refresh_token, grant_type: 'refresh_token' });
      if (!next.access_token) throw new Error('Google 登录已失效，请重新授权。');
      // A completed refresh must not resurrect credentials after configuration changed.
      if (this.vault.get('googleTokens') !== saved || this.settings().drive.clientId !== clientId) throw new Error('Google 配置已改变，请重试。');
      const value = { ...token, access_token: next.access_token, refresh_token: next.refresh_token || token.refresh_token, expires: this.now() + Number(next.expires_in || 3600) * 1000 };
      await this.vault.set({ googleTokens: JSON.stringify(value) }); return value.access_token;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async get(path, query = {}, limit = 1024 * 1024) {
    const url = new URL('https://www.googleapis.com/drive/v3/' + path); url.search = new URLSearchParams(query).toString();
    return bounded(await this.fetcher(url, { headers: { authorization: 'Bearer ' + await this.accessToken() }, redirect: 'error', signal: AbortSignal.timeout(20000) }), limit);
  }
  async check() { const result = JSON.parse(await this.get('about', { fields: 'user(displayName,emailAddress)' })); return result.user?.displayName || 'Google Drive'; }
  async children(parent, name) {
    const q = `'${escaped(parent)}' in parents and trashed = false` + (name ? ` and name = '${escaped(name)}'` : '');
    return JSON.parse(await this.get('files', { q, fields: 'files(id,name,mimeType,size),nextPageToken', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }));
  }
  async read(action, path) {
    if (typeof path !== 'string' || path.length > 1000 || path.includes(':') || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')) throw new Error('请输入 Drive 中的相对路径。');
    let parent = this.settings().drive.rootFolderId || 'root', target;
    const parts = path.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      const matches = (await this.children(parent, parts[index])).files || [];
      if (matches.length !== 1) throw new Error('Drive 路径不存在或有重名，请在 Drive 中使用唯一名称。');
      target = matches[0]; parent = target.id;
      if (index < parts.length - 1 && target.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Drive 中间路径不是文件夹。');
    }
    if (action === '列表') {
      if (target && target.mimeType !== 'application/vnd.google-apps.folder') throw new Error('请选择 Drive 文件夹。');
      const result = await this.children(parent);
      return (result.files || []).map(f => `${f.mimeType === 'application/vnd.google-apps.folder' ? '[目录]' : '[文件]'} ${f.name}`).join('\n') + (result.nextPageToken ? '\n（仅显示前 100 项）' : '') || '目录为空。';
    }
    if (!target || Number(target.size || 0) > 32000) throw new Error('请选择不超过 32KB 的文本文件。');
    const exports = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' };
    if (exports[target.mimeType]) return this.get(`files/${encodeURIComponent(target.id)}/export`, { mimeType: exports[target.mimeType] }, 32000);
    if (!/\.(txt|md|csv|json|py|js|ts|html|xml|yaml|yml|log)$/i.test(target.name)) throw new Error('私人 Drive 目前只读取文本、代码和可导出的 Google 文档。');
    return this.get(`files/${encodeURIComponent(target.id)}`, { alt: 'media', supportsAllDrives: 'true' }, 32000);
  }
}
