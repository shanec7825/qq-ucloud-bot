import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSchool, renewSchoolSession } from '../src/school-login.mjs';
import { SchoolClient, saveJSON, readJSON } from '../src/core.mjs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const page = () => new Response('<input name="execution" value="e1s1">', { headers: { 'set-cookie': 'JSESSIONID=test; Path=/; Secure' } });
test('标准认证只向学校发送密码，保留特殊字符；仅返回必要会话', async () => {
  const calls = [];
  const session = await loginSchool('test-user', 'test#password&+', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return page();
    if (calls.length === 2) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('password'), 'test#password&+');
      assert.equal(body.get('execution'), 'e1s1'); assert.equal(body.get('type'), 'username_password');
      assert.equal(options.headers.cookie, 'JSESSIONID=test');
      return new Response(null, { status: 302, headers: { location: 'https://ucloud.bupt.edu.cn/?ticket=one-use-ticket' } });
    }
    assert.ok(!options.body?.includes('test#password'));
    if (calls.length === 3) return Response.json({ access_token: 'access1', refresh_token: 'refresh1', user_id: '10001' });
    if (calls.length === 4) return Response.json({ data: [{ id: 'student', roleName: '学生' }] });
    return Response.json({ access_token: 'access2', refresh_token: 'refresh2', user_id: '10001' });
  }, async () => 'sealed-token');
  assert.equal(session.userId, '10001'); assert.equal(session.headers['blade-auth'], 'access2');
  assert.ok(!JSON.stringify(session).includes('refresh')); assert.ok(!JSON.stringify(session).includes('password'));
  assert.equal(session.renewal, 'sealed-token');
  assert.equal(calls.length, 5); assert.ok(calls.every(call => ['auth.bupt.edu.cn', 'apiucloud.bupt.edu.cn'].includes(new URL(call.url).hostname)));
});
test('续期只向学校发送解密后的续期凭据，不返回明文；到期并发请求只续期一次', async () => {
  const session = { userId: '10001', headers: { 'blade-auth': 'old', identity: 'student' }, renewal: 'sealed-old' };
  const next = await renewSchoolSession(session, async (url, options) => {
    assert.equal(new URL(url).hostname, 'apiucloud.bupt.edu.cn');
    assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'temporary-refresh');
    return Response.json({ access_token: 'new', refresh_token: 'next-refresh' });
  }, async () => 'temporary-refresh', async () => 'sealed-new');
  assert.equal(next.headers['blade-auth'], 'new'); assert.equal(next.renewal, 'sealed-new');
  assert.ok(!JSON.stringify(next).includes('temporary-refresh'));
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('../data/renew-test-', import.meta.url)));
  try {
    const file = pathToFileURL(join(dir, 'session.json')); let renewals = 0;
    await saveJSON(file, { ...session, headers: { ...session.headers, 'blade-auth': 'x.' + Buffer.from('{"exp":1}').toString('base64url') + '.x' } });
    const client = new SchoolClient(file, async (_url, options) => { assert.equal(options.headers['blade-auth'], 'new'); return Response.json({ data: { records: [] } }); }, async () => { renewals++; await new Promise(resolve => setTimeout(resolve, 10)); return next; });
    await Promise.all([client.request('/test'), client.request('/test')]);
    assert.equal(renewals, 1); assert.equal((await readJSON(file)).renewal, 'sealed-new');
    await assert.rejects(() => client.request('https://evil.test/'), /学校域名外/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('验证码不自动破解，错误密码不重试，异常跳转不发送 ticket', async () => {
  let count = 0;
  await assert.rejects(() => loginSchool('u', 'p', async () => { count++; return new Response('<input name="execution" value="e"> <script>config.captcha = {id:"x"}</script>'); }), { code: 'CAPTCHA_REQUIRED' });
  assert.equal(count, 1);
  for (const response of [new Response('Invalid credentials.', { status: 401 }), new Response(null, { status: 302, headers: { location: 'https://evil.test/?ticket=secret' } })]) {
    count = 0;
    await assert.rejects(() => loginSchool('u', 'p', async () => ++count === 1 ? page() : response), error => ['INVALID_CREDENTIALS', 'INVALID_SERVICE_REDIRECT'].includes(error.code));
    assert.equal(count, 2);
  }
});
