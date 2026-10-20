import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function main() {
  const config = JSON.parse(await readFile(new URL('../tools/napcat/napcat/config/webui.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256').update(config.token + '.napcat').digest('hex');
  async function request(path, body, credential) {
    const response = await fetch('http://127.0.0.1:6099/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: 'Bearer ' + credential } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return response.json();
  }
  const auth = await request('/auth/login', { hash });
  if (!auth.data?.Credential) throw new Error('WebUI 认证未完成。');
  const state = await request('/QQLogin/CheckLoginStatus', {}, auth.data.Credential);
  console.log(JSON.stringify({ loggedIn: state.data?.isLogin, phase: state.data?.loginPhase }));
}
main().catch(() => { console.error('无法读取本机 QQ 登录状态。'); process.exitCode = 1; });
