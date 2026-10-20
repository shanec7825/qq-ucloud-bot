import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const READ_TOOLS = new Set(['google_drive.search', 'google_drive.fetch', 'google_drive.list_folder', 'github.get_profile', 'github.list_repositories', 'github.fetch_file']);
const publicError = () => new Error('ChatGPT 插件暂不可用。请确认本机 Codex 已登录同一 ChatGPT 账号，并在 Codex 中连接 Google Drive / GitHub 后重试。');

/** Direct read-only MCP calls through the official App Server; no model turns. */
export class ChatGPTConnectorClient {
  constructor({ binary = process.env.CODEX_BIN || 'codex', spawner = spawn, timeout = 60000, cwd = new URL('../data/connector-runtime/', import.meta.url) } = {}) {
    this.binary = binary; this.spawner = spawner; this.timeout = timeout; this.cwd = cwd; this.sequence = 0; this.pending = new Map(); this.apps = new Map();
  }
  async ready() {
    if (this.disposed) throw publicError();
    if (this.connected) return;
    if (!this.starting) this.starting = this.start().catch(error => { this.close(); throw error; }).finally(() => { this.starting = null; });
    return this.starting;
  }
  async start() {
    const generation = this.generation || 0;
    await mkdir(this.cwd, { recursive: true });
    if (this.disposed || generation !== (this.generation || 0)) throw publicError();
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|OPENAI_BASE_URL|OPENAI_IDENTITY|OPENAI_FEDERATION/i.test(key)) delete env[key];
    const args = ['app-server', '--listen', 'stdio://', '--enable', 'apps', '-c', 'mcp_servers={}', '-c', 'apps._default.enabled=false', '-c', 'project_doc_max_bytes=0', '-c', 'forced_login_method="chatgpt"'];
    for (const flag of ['plugins', 'hooks', 'shell_tool', 'unified_exec', 'memories', 'multi_agent', 'computer_use', 'browser_use', 'image_generation']) args.push('--disable', flag);
    const child = this.child = this.spawner(this.binary, args, { cwd: fileURLToPath(this.cwd), env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = ''; this.tools = null;
    child.stderr.resume(); child.stdout.setEncoding('utf8'); child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 16 * 1024 * 1024) { this.close(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try { this.receive(JSON.parse(line)); } catch { this.close(); break; }
      }
    });
    const exited = () => { if (this.child === child) this.close(); };
    child.on('error', exited); child.on('exit', exited);
    await this.rpc('initialize', { clientInfo: { name: 'slyra_readonly_connectors', version: '0.5.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.notify('initialized');
    const config = { 'features.apps': true, 'apps._default.enabled': false, 'project_doc_max_bytes': 0 };
    let cursor;
    for (let page = 0; page < 5; page++) {
      const result = await this.rpc('app/list', { limit: 100, cursor, forceRefetch: false });
      for (const app of result.data || []) {
        const provider = /^google drive$/i.test(app.name) ? 'google_drive' : /^github$/i.test(app.name) ? 'github' : null;
        if (provider && app.isAccessible) {
          this.apps.set(provider, { id: app.id, name: app.name });
          config[`apps.${app.id}.enabled`] = true;
          config[`apps.${app.id}.destructive_enabled`] = false;
          config[`apps.${app.id}.open_world_enabled`] = false;
        }
      }
      cursor = result.nextCursor; if (!cursor) break;
    }
    if (!this.apps.size) throw publicError();
    const result = await this.rpc('thread/start', { cwd: fileURLToPath(this.cwd), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', config });
    this.threadId = result.thread.id;
    let toolCursor;
    this.tools = {};
    for (let page = 0; page < 5; page++) {
      const result = await this.rpc('mcpServerStatus/list', { threadId: this.threadId, serverName: 'codex_apps', limit: 100, cursor: toolCursor, detail: 'toolsAndAuthOnly' });
      Object.assign(this.tools, result.data?.find(server => server.name === 'codex_apps')?.tools || {});
      toolCursor = result.nextCursor; if (!toolCursor) break;
    }
    this.connected = true; this.touch();
  }
  receive(message) {
    if (message.method && message.id !== undefined) {
      // OAuth/permission prompts need the real user in Codex; never auto-grant them.
      this.child?.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Interactive authorization required; reconnect in Codex.' } }) + '\n'); return;
    }
    const request = this.pending.get(message.id); if (!request) return;
    clearTimeout(request.timer); this.pending.delete(message.id);
    if (message.error) request.reject(publicError()); else request.resolve(message.result);
  }
  notify(method) { this.child?.stdin.write(JSON.stringify({ method }) + '\n'); }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) { reject(publicError()); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(publicError()); this.close(); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  touch() { clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.pending.size) this.close(); else this.touch(); }, 10 * 60000); this.idle.unref(); }
  async call(tool, args) {
    if (!READ_TOOLS.has(tool)) throw new Error('机器人只允许指定的 Drive/GitHub 只读工具。');
    await this.ready();
    if (!this.apps.has(tool.split('.')[0])) throw publicError();
    const annotations = this.tools[tool]?.annotations;
    if (annotations?.readOnlyHint !== true || annotations?.destructiveHint === true || annotations?.openWorldHint === true) throw new Error('这个插件工具没有通过只读检查，未执行。');
    this.touch();
    const result = await this.rpc('mcpServer/tool/call', { threadId: this.threadId, server: 'codex_apps', tool, arguments: args });
    if (result.isError) throw new Error('插件读取失败，请检查文件访问权限或在 Codex 中重新连接账号。');
    if (result.structuredContent) return result.structuredContent;
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { return JSON.parse(text); } catch { return { content: text }; }
  }
  close() {
    this.generation = (this.generation || 0) + 1;
    const child = this.child; this.child = null; this.threadId = null; this.connected = false; this.apps.clear(); clearTimeout(this.idle);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(publicError()); }
    this.pending.clear(); child?.kill();
  }
  dispose() { this.disposed = true; this.close(); }
}

export function googleURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname) || url.username || url.password || url.port || !/^\/(?:file\/d\/|drive\/folders\/|(?:document|spreadsheets|presentation)\/d\/)/.test(url.pathname)) throw new Error('请提供 Google Drive 文件或文件夹的正式链接。');
  return url.href;
}
export function fileRows(data) {
  const found = new Map();
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) walk(item, depth + 1); return; }
    const link = value.url || value.display_url || value.webViewLink;
    if (typeof link === 'string') {
      try { const url = googleURL(link); found.set(url, { url, id: String(value.id || ''), title: String(value.title || value.name || '未命名文件').slice(0, 250), mime: value.mime_type || value.mimeType || '', folder: value.file_or_folder === 'folder' || (value.mime_type || value.mimeType) === 'application/vnd.google-apps.folder' }); } catch {}
    }
    for (const child of Object.values(value)) if (typeof child === 'object') walk(child, depth + 1);
  }
  walk(data); return [...found.values()].slice(0, 20);
}
export function driveQuery(question) {
  const quoted = question.match(/["“「『]([^"”」』]+)["”」』]/u)?.[1];
  if (quoted) return quoted.split('/').at(-1).trim().slice(0, 200);
  const simplified = question.replace(/(?:google\s*drive|谷歌云盘|谷歌网盘|网盘|云盘|drive)/giu, ' ')
    .replace(/帮我|请问|请|能不能|可以|一下|看看|看一下|查看|读取|打开|搜索|查找|总结|概括|分析|列出|告诉我|我的|里面|里边|里的|中的|你能|能否|看到|访问/gu, ' ');
  const filename = simplified.match(/[^\s\/"“”，。！？]+\.(?:pdf|md|txt|docx?|pptx?|xlsx?|csv|json|py|js|ts)\b/iu)?.[0];
  if (filename) return filename.replace(/^的/, '').slice(0, 200);
  return simplified.replace(/有哪些|有什么|文件夹|具体文件|文件内容|文档|内容|资料|文件|上面|这个|那个|怎么说|讲了什么|说了什么/gu, ' ')
    .replace(/^[\s的中上]+|[\s的中上吗呢呀啊，。！？?！：:]+$/gu, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export class ChatGPTResources {
  constructor(client) { this.client = client; this.selections = new Map(); }
  remember(scope, files) {
    if (!/^(private):\d{5,15}$/.test(scope || '')) return;
    this.selections.set(scope, { files, touched: Date.now() });
    if (this.selections.size > 50) this.selections.delete(this.selections.keys().next().value);
  }
  listing(files) { return files.length ? files.map((f, i) => `${i + 1}. ${f.folder ? '[目录]' : '[文件]'} ${f.title}\n${f.url}`).join('\n\n') : '插件未找到匹配文件。可以给我更具体的文件名或 Drive 链接。'; }
  async folder(url, scope) { const files = fileRows(await this.client.call('google_drive.list_folder', { url, top_k: 30 })); this.remember(scope, files); return this.listing(files); }
  async fetch(url) {
    const data = await this.client.call('google_drive.fetch', { url: googleURL(url), download_raw_file: false });
    const text = typeof data.content === 'string' ? data.content : typeof data.text === 'string' ? data.text : JSON.stringify(data);
    return `来源：${url}\n${text.slice(0, 24000)}${text.length > 24000 ? '\n（仅提供前 24000 字符）' : ''}\n只根据实际取得的正文回答；若返回的只是元数据，不能假装读取了正文。`;
  }
  async drive(action, reference, scope) {
    if (!reference && action === '列表') return this.folder('root', scope);
    if (/^https?:\/\//.test(reference)) return action === '列表' ? this.folder(googleURL(reference), scope) : this.fetch(reference);
    const data = await this.client.call('google_drive.search', { query: reference.split('/').at(-1).slice(0, 200), topn: 10, best_effort_fetch: false, ...(action === '列表' ? { item_type: 'folder' } : {}) });
    let files = fileRows(data); const exact = files.filter(f => f.title === reference || f.title === reference.split('/').at(-1)); if (exact.length) files = exact;
    this.remember(scope, files);
    if (files.length !== 1) return this.listing(files) + '\n请指定要打开的文件名、链接或列表中的序号。';
    return files[0].folder ? this.folder(files[0].url, scope) : this.fetch(files[0].url);
  }
  async driveQuestion(question, scope) {
    const link = question.match(/https?:\/\/[^\s"“”<>]+/u)?.[0]?.replace(/[，。！？）)]+$/u, '');
    if (link) return /\/folders\//.test(googleURL(link)) ? this.folder(link, scope) : this.fetch(link);
    const previous = this.selections.get(scope);
    if (previous && Date.now() - previous.touched < 15 * 60000 && /这份|这个|那个|那份|它|刚才|第[一二三四五六七八九十\d]+[个份项]/u.test(question)) {
      const ordinal = question.match(/第([一二三四五六七八九十\d]+)[个份项]/u)?.[1];
      const index = ordinal ? /^\d+$/.test(ordinal) ? Number(ordinal) - 1 : '一二三四五六七八九十'.indexOf(ordinal) : previous.files.length === 1 ? 0 : -1;
      if (index >= 0 && previous.files[index]) { const file = previous.files[index]; return file.folder ? this.folder(file.url, scope) : this.fetch(file.url); }
      return this.listing(previous.files) + '\n请指定列表中的序号或文件名。';
    }
    const query = driveQuery(question);
    if (!query) return this.folder('root', scope);
    return this.drive(/文件夹|目录/u.test(question) && !/\.(pdf|md|txt|docx?|pptx?|xlsx?)/i.test(query) ? '列表' : '读取', query, scope);
  }
  async github(reference = '') {
    if (!reference.trim()) {
      const data = await this.client.call('github.list_repositories', { page_size: 50, page_offset: 0 });
      return JSON.stringify(data).slice(0, 20000);
    }
    let ref;
    if (/^https:\/\/github\.com\//.test(reference)) {
      const url = new URL(reference), parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname !== 'github.com' || url.username || url.password || parts.length < 2) throw new Error('GitHub 文件链接无效。');
      const repository = parts.slice(0, 2).join('/');
      if (parts[2] === 'blob' && parts.length >= 5) { ref = decodeURIComponent(parts[3]); reference = repository + ' ' + parts.slice(4).map(decodeURIComponent).join('/'); }
      else if (parts.length === 2) reference = repository;
      else throw new Error('请使用仓库链接或 GitHub 文件的 blob 链接。');
    }
    const match = /^([\w.-]+\/[\w.-]+)(?:\s+(.+))?$/.exec(reference.trim());
    if (!match || match[2]?.split('/').some(part => part === '..' || part === '.')) throw new Error('请指定 GitHub 仓库及相对文件路径。');
    const data = await this.client.call('github.fetch_file', { repository_full_name: match[1], path: match[2] || 'README.md', ...(ref ? { ref } : {}) });
    return `${data.display_url || match[1]}\n${String(data.content || JSON.stringify(data)).slice(0, 24000)}`;
  }
  githubQuestion(question, defaultRepo = '') {
    const link = question.match(/https:\/\/github\.com\/[^\s"“”<>]+/u)?.[0]?.replace(/[，。！？）)]+$/u, '');
    const match = question.match(/([\w.-]+\/[\w.-]+)(?:\s+([^\s，。！？]+\.[a-z0-9]+))?/iu);
    return this.github(link || (match ? match[1] + (match[2] ? ' ' + match[2] : '') : defaultRepo));
  }
}
