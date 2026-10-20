import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const path = new URL('../.env', import.meta.url);
let content = await readFile(path, 'utf8');
function set(key, value, preserve = false) {
  const pattern = new RegExp('^' + key + '=(.*)$', 'm');
  const match = pattern.exec(content);
  if (preserve && match?.[1]?.trim()) return;
  content = match ? content.replace(pattern, key + '=' + value) : content + '\n' + key + '=' + value + '\n';
}
const owner = process.argv[2] || /^OWNER_QQ=(.*)$/m.exec(content)?.[1]?.trim();
if (!/^\d{5,15}$/.test(owner || '')) throw new Error('请传入主人 QQ：node scripts/configure.mjs QQ号，或先设置 .env 的 OWNER_QQ。');
set('OWNER_QQ', owner);
set('AI_BACKEND', 'codex');
set('CODEX_BIN', 'codex', true);
set('CODEX_MODEL', 'gpt-6-luna', true);
set('ONEBOT_ACCESS_TOKEN', randomBytes(32).toString('hex'), true);
await writeFile(path, content, { mode: 0o600 });
console.log('已配置主人、订阅 AI 和 OneBot 密钥；未输出密钥。');
