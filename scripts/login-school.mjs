import { createInterface } from 'node:readline';
import { loginSchool } from '../src/school-login.mjs';
import { saveSchoolSession } from '../src/core.mjs';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log('学校标准认证就绪；凭据只从本次标准输入接收，不保存、不回显。');
const input = createInterface({ input: process.stdin, terminal: false });
try {
  let credentials;
  for await (const line of input) { credentials = JSON.parse(line); input.close(); break; }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  if (!credentials?.username || !credentials?.password) throw new Error('MISSING_CREDENTIALS');
  const session = await loginSchool(credentials.username, credentials.password);
  credentials = null;
  await saveSchoolSession(new URL('../data/session.json', import.meta.url), session);
  console.log('学校标准认证成功；已保存会话和本机加密的续期凭据，不保存密码。');
} catch (error) {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  console.error(JSON.stringify({ code: error.code || 'LOGIN_FAILED', ...(error.status ? { httpStatus: error.status } : {}) }));
  process.exitCode = 1;
}
