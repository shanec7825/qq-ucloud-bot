// Standard CAS form and UCloud OAuth flow; endpoint conventions cross-checked
// against https://github.com/byrdocs/bupt-auth (MIT). No browser or CAPTCHA bypass.
const service = 'https://ucloud.bupt.edu.cn';
const loginURL = 'https://auth.bupt.edu.cn/authserver/login?service=' + service;
const api = 'https://apiucloud.bupt.edu.cn';
const authorization = 'Basic ' + Buffer.from('portal:portal_secret').toString('base64');
import { protectSchoolSecret, unprotectSchoolSecret } from './school-secret.mjs';
export class SchoolLoginError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export async function loginSchool(username, password, fetcher = fetch, protector = protectSchoolSecret) {
  const request = (url, options = {}) => fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
  const page = await request(loginURL);
  if (!page.ok) throw new SchoolLoginError('LOGIN_PAGE_FAILED', page.status);
  const html = await page.text();
  const execution = html.match(/<input\b[^>]*\bname=["']execution["'][^>]*\bvalue=["']([^"']+)["']/i)?.[1];
  if (!execution) throw new SchoolLoginError('LOGIN_FORM_UNAVAILABLE');
  if (/config\.captcha\s*=\s*\{/.test(html)) throw new SchoolLoginError('CAPTCHA_REQUIRED');
  const cookies = (page.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).filter(Boolean).join('; ');
  if (!cookies) throw new SchoolLoginError('LOGIN_COOKIE_UNAVAILABLE');
  const form = new URLSearchParams({ username, password, submit: '登录', type: 'username_password', execution: execution.replace(/&amp;/g, '&'), _eventId: 'submit' });
  const result = await request(loginURL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, referer: loginURL }, body: form.toString() });
  if (result.status !== 302) {
    const text = await result.text();
    throw new SchoolLoginError(/Invalid credentials|用户名.*密码.*错误|密码错误/i.test(text) ? 'INVALID_CREDENTIALS' : /验证码|captcha/i.test(text) ? 'CAPTCHA_REQUIRED' : 'LOGIN_REJECTED', result.status);
  }
  const target = new URL(result.headers.get('location') || '', loginURL);
  if (target.origin !== service || !target.searchParams.get('ticket')) throw new SchoolLoginError('INVALID_SERVICE_REDIRECT');
  const ticket = target.searchParams.get('ticket');
  const json = async (path, options = {}) => {
    const response = await request(api + path, options);
    if (!response.ok) throw new SchoolLoginError('UCLOUD_REQUEST_REJECTED', response.status);
    const value = await response.json();
    if (value.success === false || value.code != null && ![0, 200].includes(Number(value.code))) throw new SchoolLoginError('UCLOUD_RESPONSE_REJECTED');
    return value;
  };
  const tokenHeaders = { authorization, 'content-type': 'application/x-www-form-urlencoded', 'tenant-id': '000000', referer: service + '/' };
  const token = await json('/ykt-basics/oauth/token', { method: 'POST', headers: tokenHeaders, body: new URLSearchParams({ ticket, grant_type: 'third' }).toString() });
  if (!token.access_token || !token.refresh_token) throw new SchoolLoginError('UCLOUD_TOKEN_MISSING');
  const roles = (await json('/ykt-basics/userroledomaindept/listByUserId', { headers: { authorization, 'blade-auth': token.access_token } })).data;
  if (!Array.isArray(roles) || !roles.length) throw new SchoolLoginError('STUDENT_ROLE_MISSING');
  const role = roles.find(item => String(item.roleName).includes('学生')) || roles[0];
  const active = await json('/ykt-basics/oauth/token', { method: 'POST', headers: tokenHeaders, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, identity: String(role.id) }).toString() });
  const access = active.access_token;
  const userId = active.user_id || token.user_id;
  if (!access || !userId) throw new SchoolLoginError('UCLOUD_SESSION_MISSING');
  // Only a Windows-user-bound encrypted renewal credential is persisted.
  return { userId: String(userId), headers: { authorization, 'blade-auth': access, identity: String(role.id), 'tenant-id': '000000' }, renewal: await protector(active.refresh_token || token.refresh_token), capturedAt: new Date().toISOString() };
}

export async function renewSchoolSession(session, fetcher = fetch, unprotect = unprotectSchoolSecret, protect = protectSchoolSecret) {
  if (!session.renewal) throw new SchoolLoginError('RENEWAL_UNAVAILABLE');
  const refresh = await unprotect(session.renewal);
  const response = await fetcher(api + '/ykt-basics/oauth/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', 'tenant-id': session.headers['tenant-id'] || '000000' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, identity: session.headers.identity }).toString(),
  });
  if (!response.ok) throw new SchoolLoginError('RENEWAL_REJECTED', response.status);
  const value = await response.json();
  if (!value.access_token) throw new SchoolLoginError('RENEWAL_REJECTED');
  return { ...session, headers: { ...session.headers, 'blade-auth': value.access_token }, renewal: value.refresh_token ? await protect(value.refresh_token) : session.renewal, renewedAt: new Date().toISOString() };
}
