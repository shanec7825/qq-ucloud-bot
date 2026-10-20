import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readJSON, saveJSON } from './core.mjs';
import { protectSchoolSecret, unprotectSchoolSecret } from './school-secret.mjs';

const keys = ['onebotToken', 'openaiKey', 'githubToken', 'googleClientSecret', 'googleTokens'];
export class SecretVault {
  constructor(root = new URL('../data/', import.meta.url), env = process.env, codec) {
    this.root = root; this.env = env; this.codec = codec; this.queue = Promise.resolve();
  }
  async load() {
    const file = new URL('secrets.enc.json', this.root), saved = await readJSON(file, null);
    if (!this.codec) this.codec = process.platform === 'win32' ? { protect: protectSchoolSecret, unprotect: unprotectSchoolSecret } : await this.localCodec();
    this.values = saved ? JSON.parse(await this.codec.unprotect(saved.ciphertext)) : {};
  }
  async localCodec() {
    const path = new URL('secrets.key', this.root); let key;
    try { key = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; key = randomBytes(32); await writeFile(path, key, { mode: 0o600, flag: 'wx' }); }
    return {
      protect(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'); },
      unprotect(value) { const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); },
    };
  }
  get(key) {
    if (!keys.includes(key)) throw new Error('未知密钥字段。');
    if (Object.hasOwn(this.values, key)) return this.values[key];
    return ({ onebotToken: this.env.ONEBOT_ACCESS_TOKEN, openaiKey: this.env.OPENAI_API_KEY, githubToken: this.env.GH_TOKEN })[key] || null;
  }
  flags() { return Object.fromEntries(keys.map(key => [key, !!this.get(key)])); }
  set(patch) {
    const work = this.queue.catch(() => {}).then(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !keys.includes(key) || patch[key] !== null && (typeof patch[key] !== 'string' || patch[key].length > 16000 || patch[key].includes('\0')))) throw new Error('密钥字段无效或过长。');
      const values = { ...this.values, ...patch };
      if (JSON.stringify(values).length > 30000) throw new Error('密钥配置过大。');
      const ciphertext = await this.codec.protect(JSON.stringify(values));
      await saveJSON(new URL('secrets.enc.json', this.root), { version: 1, ciphertext }); this.values = values;
      return this.flags();
    });
    this.queue = work; return work;
  }
}
