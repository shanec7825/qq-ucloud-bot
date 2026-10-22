import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { prepareModelContent } from './core.mjs';
import { GROUP_CHAT_PROMPT, taskSystemPrompt } from './chat-rules.mjs';
import { templateSystemPrompt } from './group-templates.mjs';

const runtimeRoot = fileURLToPath(new URL('../data/harness-runtime/', import.meta.url));
const defaultCLI = fileURLToPath(new URL('../tools/deepseek-harness/node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url));
const unavailable = () => new Error('DeepSeek Harness 请求未完成，请检查登录、API Key、模型和额度；诊断内容不会转发给群聊。');
function modelFailure(code) {
  const messages = {
    ACCOUNT_QUOTA: 'DeepSeek Harness 账号额度不足，请在官方 Harness 查看额度，或改用 DeepSeek API Key。',
    ACCOUNT_SIGN_IN_REQUIRED: '请先在本机官方 DeepSeek Harness 桌面端登录账号。',
    MODEL_UNSUPPORTED: '此模型当前不能通过 Harness 使用，请填写官方 Harness 模型列表中的可用名称。',
    CLIENT_UPGRADE_REQUIRED: 'Harness 组件需要更新，请运行 npm run setup:deepseek。',
  };
  return messages[code] ? new Error(messages[code]) : unavailable();
}
export const HARNESS_DISABLED = ['tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh'];

export async function prepareHarnessRun(env = process.env) {
  if (env.DEEPSEEK_HARNESS_BIN && !isAbsolute(env.DEEPSEEK_HARNESS_BIN)) throw new Error('DEEPSEEK_HARNESS_BIN 必须是官方 dsh lib/bin.js 的完整路径。');
  const cli = env.DEEPSEEK_HARNESS_BIN ? resolve(env.DEEPSEEK_HARNESS_BIN) : defaultCLI;
  if (!/\.(?:m?js)$/i.test(cli)) throw new Error('DEEPSEEK_HARNESS_BIN 请填写官方 dsh 的 lib/bin.js 完整路径。');
  try { await access(cli); } catch { throw new Error('DeepSeek Harness 组件未准备，请运行 npm run setup:deepseek。'); }
  const account = env.DEEPSEEK_HARNESS_AUTH === 'account';
  if (!account && !env.DEEPSEEK_API_KEY) throw new Error('请保存 DeepSeek API Key，或选择 Harness 已有账号登录。');
  await mkdir(runtimeRoot, { recursive: true });
  const home = await mkdtemp(join(runtimeRoot, 'request-')), cwd = join(home, 'workspace');
  const cleanup = async () => {
    // Delete only the disposable directory this invocation created, after the child exits.
    const base = await realpath(runtimeRoot), target = await realpath(home).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!target) return;
    const rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Harness 临时目录边界校验失败。');
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  try {
    await mkdir(cwd); const profile = join(home, 'profiles/sdk-minimal'); await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'qq-agent-harness-session', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-sdk-minimal'] } } }));
    const patch = HARNESS_DISABLED.map(id => ({ id, disabled: true }));
    patch.push({ id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: cwd } });
    if (account) {
      // Copy only Harness account/device records. Never import home patches, plugins,
      // API keys, sessions, or chat history, and never modify the user's Harness home.
      const yaml = createRequire(pathToFileURL(cli))('js-yaml');
      const source = join(env.DEEPSEEK_HARNESS_HOME || join(homedir(), '.dsh'), '.credentials.yaml');
      let document;
      try { document = yaml.load(await readFile(source, 'utf8')); } catch { throw new Error('未读取到 Harness 登录。请先在官方桌面端登录 DeepSeek。'); }
      const records = Object.fromEntries(['deepseek-account-platform/default', 'deepseek-account-platform/device']
        .filter(key => document?.records?.[key]).map(key => [key, document.records[key]]));
      if (document?.version !== 1 || !records['deepseek-account-platform/default']) throw new Error('没有可复用的 Harness 账号登录，请先在新版官方桌面端登录，或改用 API Key。');
      await writeFile(join(home, '.credentials.yaml'), JSON.stringify({ version: 1, refs: {}, records }), { mode: 0o600 });
      patch.push({ insert: [
        { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { watch: false } },
        { id: 'authorization', name: '@deepseek-ai/dsh-authorization' },
        { id: 'deepseek-account', name: '@deepseek-ai/dsh-deepseek-account-platform' },
        { id: 'llm-deepseek-account', name: '@deepseek-ai/dsh-llm-deepseek-account' },
      ] });
    }
    const patchPath = join(home, 'qq.patch.yml'); await writeFile(patchPath, JSON.stringify(patch));
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY|^(?:OPENAI|CODEX|DSH)_/i.test(key)));
    Object.assign(childEnv, { DSH_HOME: home, DSH_PERMISSION_MODE: 'read-only', DSH_TELEMETRY_ENABLED: 'false', DSH_PRIMARY_RUNTIME: '' });
    if (!account) childEnv.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
    return { binary: process.execPath, args: [cli, '--profile', 'sdk-minimal', '--patch', patchPath], cwd, env: childEnv, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function askHarness(question, context, env = process.env, { spawner = spawn, prepare = prepareHarnessRun, timeoutMs = 180000 } = {}) {
  const input = await prepareModelContent(question, context);
  const blocks = typeof input === 'string' ? [{ type: 'text', text: input }] : input.map(part => {
    if (part.type === 'text') return part;
    const [, mimeType, data] = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
    return { type: 'image', mimeType, data };
  });
  const rules = await readFile(new URL('./qq-model-instructions.md', import.meta.url), 'utf8');
  const run = await prepare(env);
  run.env.DSH_SYSTEM_PROMPT = rules + '\n管理员设定：\n' + (env.BOT_SYSTEM_PROMPT || '') + '\n机器人名字：' + (env.BOT_NAME || 'slyra') + '\n' + GROUP_CHAT_PROMPT + templateSystemPrompt(context) + taskSystemPrompt(context);
  return new Promise((resolve, reject) => {
    let child, settled = false, buffer = '', size = 0, sequence = 0, answer = '', completed = false;
    const pending = new Map(), sessionId = 'qq-' + randomUUID();
    const cleanup = () => run.cleanup().catch(() => console.error('Harness 临时会话清理失败，请检查 data/harness-runtime。'));
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      for (const entry of pending.values()) entry.reject(unavailable()); pending.clear();
      error ? reject(error) : resolve(answer);
      if (child) child.kill(); else void cleanup();
    };
    const timer = setTimeout(() => finish(new Error('DeepSeek Harness 请求超时，请检查网络或稍后重试。')), timeoutMs);
    const rpc = (method, params) => new Promise((resolve, reject) => {
      if (settled) { reject(unavailable()); return; }
      const id = ++sequence; pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const consume = line => {
      if (settled) return;
      // The account adapter can print catalog diagnostics on stdout. As with
      // the official line transport, ignore non-JSON lines; never forward them.
      let frame; try { frame = JSON.parse(line); } catch { return; }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return;
      if (frame.id != null && pending.has(frame.id)) {
        const entry = pending.get(frame.id); pending.delete(frame.id);
        frame.error ? entry.reject(unavailable()) : entry.resolve(frame.result); return;
      }
      if (frame.method === 'subagent.started') { finish(unavailable()); return; }
      if (frame.method !== 'session.event' || frame.params?.sessionId !== sessionId) return;
      const event = frame.params.event, data = event?.data;
      if (event?.type === 'tool/call' || event?.type === 'request/header' && data?.header?.tools?.length) { finish(unavailable()); return; }
      if (event?.type === 'assistant/message') {
        const content = data?.message?.content;
        if (!Array.isArray(content) || content.some(block => /tool/i.test(block.type))) { finish(unavailable()); return; }
        answer = content.filter(block => block.type === 'text').map(block => block.text).join('');
      }
      if (event?.type === 'turn/end') {
        if (data?.reason?.kind !== 'completed') { finish(modelFailure(data?.reason?.error?.code)); return; }
        completed = true;
      }
    };
    try { child = spawner(run.binary, run.args, { cwd: run.cwd, env: run.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { finish(unavailable()); return; }
    child.once('error', () => finish(unavailable())); child.stdin.on('error', () => finish(unavailable()));
    child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled) return;
      size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) { finish(unavailable()); return; }
      buffer += chunk;
      let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.trim()) consume(line); }
    });
    child.once('close', () => { if (!settled) finish(unavailable()); void cleanup(); });
    (async () => {
      const result = await rpc('initialize', { cwd: run.cwd, provider: env.DEEPSEEK_HARNESS_AUTH === 'account' ? 'deepseek-account' : 'deepseek-official', model: env.DEEPSEEK_HARNESS_MODEL || 'deepseek-flash' });
      if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw unavailable();
      await rpc('session/prompt', { sessionId, contentBlocks: blocks });
      await rpc('session/wait', { sessionId });
      if (!completed || !answer.trim()) throw unavailable();
      finish();
    })().catch(() => finish(unavailable()));
  });
}
