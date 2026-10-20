import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexAccount } from '../src/codex-account.mjs';

function accountFixture() {
  let type = 'none', url = 'https://auth.openai.com/oauth/authorize?client_id=test'; const calls = [];
  const account = new CodexAccount({ spawner: (_binary, args, options) => {
    assert.equal(args[0], 'app-server'); assert.ok(!Object.keys(options.env).some(key => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)));
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('exit', 0);
    child.stdin.on('data', chunk => {
      for (const line of chunk.toString().trim().split('\n')) {
        const request = JSON.parse(line); if (!request.id) continue; calls.push(request.method);
        const result = request.method === 'account/read' ? { account: type === 'none' ? null : { type, email: 'private@example.test', accessToken: 'PRIVATE_TOKEN' } } : request.method === 'account/login/start' ? { type: 'chatgpt', authUrl: url, loginId: 'not-exposed' } : {};
        queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'));
      }
    }); return child;
  } });
  return { account, calls, setType: value => type = value, setURL: value => url = value };
}

test('订阅状态与网页登录只走官方账户 RPC，不发起模型请求或回显账号凭据', async () => {
  const fixture = accountFixture();
  try {
    assert.equal((await fixture.account.status()).authenticated, false);
    assert.equal((await fixture.account.begin()).authUrl.startsWith('https://auth.openai.com/'), true);
    await assert.rejects(() => fixture.account.begin(), /已打开/);
    fixture.setType('chatgpt'); const status = await fixture.account.status();
    assert.equal(status.authenticated, true); assert.ok(!JSON.stringify(status).includes('PRIVATE_TOKEN')); assert.ok(!JSON.stringify(status).includes('@'));
    assert.deepEqual(await fixture.account.begin(), { authenticated: true });
    assert.ok(fixture.calls.every(method => ['initialize', 'account/read', 'account/login/start'].includes(method)));
  } finally { fixture.account.close(); }
});

test('API Key 登录不冒充 Plus；授权 URL 必须是官方 HTTPS 地址', async () => {
  const fixture = accountFixture();
  try { fixture.setType('apiKey'); assert.equal((await fixture.account.status()).authenticated, false); fixture.setURL('https://evil.test/login'); await assert.rejects(() => fixture.account.begin(), /授权地址/); }
  finally { fixture.account.close(); }
});
