import { spawn } from 'node:child_process';

export class CodexAccount {
  constructor({ binary = process.env.CODEX_BIN || 'codex', spawner = spawn } = {}) { this.binary = binary; this.spawn = spawner; this.pending = new Map(); this.sequence = 0; }
  async ready() {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|OPENAI_BASE_URL|OPENAI_IDENTITY|OPENAI_FEDERATION/i.test(key)) delete env[key];
      const child = this.child = this.spawn(this.binary, ['app-server', '--listen', 'stdio://', '-c', 'forced_login_method="chatgpt"'], { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      child.stderr.resume(); child.stdout.setEncoding('utf8'); child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        buffer += chunk; if (buffer.length > 512000) { this.close(); return; }
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try {
            const data = JSON.parse(line), request = this.pending.get(data.id);
            if (request) { clearTimeout(request.timer); this.pending.delete(data.id); data.error ? request.reject(new Error('Codex 登录操作未完成。')) : request.resolve(data.result); }
            if (data.method === 'account/login/completed') this.loginPending = false;
          } catch { /* Ignore non-protocol diagnostics; never expose account tokens. */ }
        }
      });
      child.on('error', () => this.close()); child.on('exit', () => { if (this.child === child) this.close(); });
      await this.rpc('initialize', { clientInfo: { name: 'qq_agent_account', version: '0.9.0' }, capabilities: {} });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    })().catch(error => { this.close(); throw error; });
    return this.starting;
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) { reject(new Error('本机 Codex 未就绪。')); return; }
      const id = ++this.sequence, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 登录响应超时。')); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async status() {
    await this.ready(); const data = await this.rpc('account/read', { refreshToken: false });
    return { authenticated: data.account?.type === 'chatgpt', method: data.account?.type || 'none', loginPending: !!this.loginPending };
  }
  async begin() {
    if ((await this.status()).authenticated) return { authenticated: true };
    if (this.loginPending) throw new Error('登录窗口已打开，请先完成登录后检查状态。');
    const data = await this.rpc('account/login/start', { type: 'chatgpt' }), url = new URL(data.authUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) throw new Error('Codex 返回的授权地址未通过检查。');
    this.loginPending = true; return { authenticated: false, authUrl: url.href };
  }
  close() {
    const child = this.child; this.child = null; this.starting = null; this.loginPending = false;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('本机 Codex 登录连接中断。')); }
    this.pending.clear(); child?.kill();
  }
}
