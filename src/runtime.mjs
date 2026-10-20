import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SchoolClient, readJSON, saveJSON, notificationPlan, askAI } from './core.mjs';
import { OneBot } from './onebot.mjs';
import { PublicCatalog, upcoming } from './access.mjs';
import { PrivateResources } from './resources.mjs';
import { GoogleDrive } from './google-drive.mjs';
import { askCodex } from './codex-ai.mjs';
import { ConversationMemory, loadPersona } from './persona.mjs';
import { createMessageHandler } from './message-handler.mjs';
import { SharedLibrary } from './shared-library.mjs';
import { MessageMedia } from './message-media.mjs';
import { HistoryDigest } from './history-digest.mjs';
import { ManagedMemory } from './managed-memory.mjs';
import { modelEnv } from './settings.mjs';
import { ChatGPTConnectorClient, ChatGPTResources } from './chatgpt-connectors.mjs';
import { GroupMembers } from './group-members.mjs';
import { NoticeMonitor } from './notice-monitor.mjs';
import { moduleActive } from './plugin-modules.mjs';
import { CodexAccount } from './codex-account.mjs';
import { groupTemplate } from './group-templates.mjs';

const project = new URL('../', import.meta.url);
export class BotRuntime {
  constructor(store, vault, { root = new URL('data/', project), botFactory = (...args) => new OneBot(...args) } = {}) {
    this.store = store; this.vault = vault; this.root = root; this.botFactory = botFactory; this.checks = {}; this.transportVersion = 0;
    this.memory = new ConversationMemory(); this.notes = new ManagedMemory(root);
    this.school = new SchoolClient(new URL('session.json', root));
    this.catalog = new PublicCatalog(new URL('public-assignments.json', root), new URL('public/books.json', project));
    this.google = new GoogleDrive({ settings: () => store.get(), vault });
    this.connectors = new ChatGPTConnectorClient(); this.native = new ChatGPTResources(this.connectors);
    this.account = new CodexAccount();
    this.history = new HistoryDigest({ root: new URL('history/', root), ai: (q, c) => this.ai(q, c) });
    this.proxy = { call: (...args) => { if (!this.bot) throw new Error('QQ 尚未连接，请配置 OneBot。'); return this.bot.call(...args); }, send: (target, ...args) => {
      if (target.group_id && this.store.get().monitor.groups.includes(String(target.group_id))) throw new Error('监测群禁止机器人发言。');
      if (!this.bot) throw new Error('QQ 尚未连接。'); return this.bot.send(target, ...args);
    } };
    this.media = new MessageMedia(this.proxy);
    this.monitor = new NoticeMonitor({ settings: () => this.config(), ai: (q, c) => this.ai(q, c), send: (target, text) => this.proxy.send(target, text), root: new URL('notices/', root) });
    this.members = new GroupMembers(this.proxy, () => this.store.get().groups.filter(group => group.enabled).map(group => group.id));
    this.handler = createMessageHandler({ bot: this.proxy, memory: this.memory, getDependencies: () => this.dependencies() });
  }
  config() {
    const config = this.store.get();
    for (const [section, module] of [['github', 'github'], ['drive', 'drive'], ['school', 'ucloud'], ['monitor', 'notices']]) config[section].enabled &&= moduleActive(this.root, module);
    return config;
  }
  env(config = this.store.get()) {
    return modelEnv(config, { openaiKey: this.vault.get('openaiKey'), githubToken: config.github.authMode === 'token' ? this.vault.get('githubToken') : '' });
  }
  async ai(question, context, config = this.config()) {
    const env = this.env(config);
    return config.ai.backend === 'api' ? askAI(question, context, env) : askCodex(question, context, env);
  }
  resources(config) {
    const env = this.env(config), legacy = new PrivateResources(env);
    return {
      github: reference => {
        if (!config.github.enabled) throw new Error('GitHub 连接已停用，请在管理台启用。');
        if (config.github.authMode === 'chatgpt') return this.native.github(reference || config.github.defaultRepo);
        if (config.github.authMode === 'token' && !this.vault.get('githubToken')) throw new Error('请先在管理台保存 GitHub Token。');
        return legacy.github(reference || config.github.defaultRepo);
      },
      drive: (action, path) => {
        if (!config.drive.enabled) throw new Error('Google Drive 已停用，请在管理台启用。');
        if (config.drive.authMode === 'chatgpt') return this.native.drive(action, path);
        if (config.drive.authMode === 'oauth') return this.google.read(action, path);
        if (config.drive.rootFolderId) env.RCLONE_DRIVE_ROOT_FOLDER_ID = config.drive.rootFolderId;
        return legacy.drive(action, path);
      },
      ...(config.drive.authMode === 'chatgpt' ? { driveQuestion: (question, event) => {
        if (!config.drive.enabled) throw new Error('Google Drive 已停用。');
        if (event.message_type !== 'private' || String(event.user_id) !== config.bot.ownerQQ) throw new Error('只有主人私聊可读取私人 Drive。');
        return this.native.driveQuestion(question, config.memory.enabled ? 'private:' + String(event.user_id) : undefined);
      } } : {}),
      ...(config.github.authMode === 'chatgpt' ? { githubQuestion: (question, event) => {
        if (!config.github.enabled || event.message_type !== 'private' || String(event.user_id) !== config.bot.ownerQQ) throw new Error('只有主人私聊可读取私人 GitHub。');
        return this.native.githubQuestion(question, config.github.defaultRepo);
      } } : {}),
    };
  }
  dependencies() {
    const config = this.config(), enabled = config.groups.filter(g => g.enabled);
    if (!this.library || this.libraryRoot !== config.library.root) { this.libraryRoot = config.library.root; this.library = config.library.root ? new SharedLibrary(config.library.root) : null; }
    const catalog = config.school.enabled ? this.catalog : {
      list: async () => 'UCloud 未启用。', detail: async () => 'UCloud 未启用。', upcomingTasks: async () => [], books: () => this.catalog.books(),
    };
    return { enabled: !this.stopped && moduleActive(this.root, 'core'), capabilities: JSON.stringify([config.github.enabled, config.drive.enabled, config.school.enabled]), groups: enabled.filter(g => !config.monitor.groups.includes(g.id)).map(g => g.id), owner: config.bot.ownerQQ, botName: config.bot.name, school: this.school, catalog,
      resources: this.resources(config), ai: (q, c) => this.ai(q, c, config), library: this.library, media: this.media, members: this.members,
      notes: config.memory.enabled ? this.notes : null, monitor: this.monitor, groupTemplate: id => groupTemplate(config.groups.find(group => group.id === id)),
      history: config.memory.enabled && config.history.enabled ? { context: id => enabled.some(g => g.id === id && g.historyEnabled) ? this.history.context(id) : null } : null,
      persona: loadPersona, shareDocumentsWithModel: config.library.sendToModel, transportVersion: this.transportVersion,
    };
  }
  apply() {
    const config = this.config(); this.memory.configure(config.memory);
    this.members.retain();
    for (const scope of this.memory.sessions.keys()) if (scope.startsWith('group:') && !config.groups.some(group => group.enabled && 'group:' + group.id === scope)) this.memory.clear(scope);
    const appSignature = JSON.stringify([config.drive.authMode, config.drive.rootFolderId, config.drive.enabled, config.github.authMode, config.github.enabled, config.bot.ownerQQ, config.memory.enabled]);
    if (appSignature !== this.appSignature) { this.appSignature = appSignature; this.native.selections.clear(); }
    if (config.bot.ownerQQ && (config.drive.enabled && config.drive.authMode === 'chatgpt' || config.github.enabled && config.github.authMode === 'chatgpt')) this.connectors.ready().catch(() => {});
    else if (this.connectors.child) this.connectors.close();
    const token = this.vault.get('onebotToken') || '', signature = JSON.stringify([config.qq.url, token]);
    if (signature !== this.transportSignature) {
      this.transportSignature = signature; this.transportVersion++; this.bot?.close(); this.bot = null;
      this.members.clear();
      if (token) { this.bot = this.botFactory(config.qq.url, token, this.handler); this.bot.connect(); }
    }
  }
  async start() {
    this.state = await readJSON(new URL('state.json', this.root), { initialized: false, known: [], sent: {} });
    if (!Array.isArray(this.state.known) || !this.state.sent || typeof this.state.sent !== 'object') throw new Error('提醒状态格式无效，请检查 data/state.json。');
    this.apply(); this.interval = setInterval(() => this.tick().catch(() => {}), 1000); this.interval.unref(); this.tick().catch(() => {});
  }
  stop() { this.stopped = true; clearInterval(this.interval); this.bot?.close(); this.connectors.dispose(); this.account.close(); }
  async sync() {
    if (this.schoolLoginBusy) throw new Error('学校登录正在进行，请稍后同步。');
    if (!this.config().school.enabled) throw new Error('请先启用 UCloud 插件与作业功能。');
    if (!this.syncing) this.syncing = (async () => {
      const tasks = await this.catalog.refresh(this.school);
      this.checks.ucloud = { ok: true, message: `同步成功，${upcoming(tasks).length} 项未截止作业`, checkedAt: new Date().toISOString() };
      return tasks;
    })().catch(error => { this.checks.ucloud = { ok: false, message: '同步失败，请重新登录学校账号或稍后重试。', checkedAt: new Date().toISOString() }; throw error; }).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      if (!this.lastMemoryPrune || Date.now() - this.lastMemoryPrune >= 60000) { this.memory.prune(); this.lastMemoryPrune = Date.now(); }
      const config = this.config();
      if (config.school.enabled && (!this.lastPoll || Date.now() - this.lastPoll >= config.school.pollSeconds * 1000)) {
        this.lastPoll = Date.now();
        try {
          const tasks = upcoming(await this.sync());
          if (config.school.reminders && config.bot.ownerQQ && this.bot?.socket?.readyState === WebSocket.OPEN) {
            for (const notice of notificationPlan(tasks, this.state).filter(n => n.key.startsWith('due:'))) {
              if (!this.config().school.enabled || !this.store.get().school.reminders || this.store.get().bot.ownerQQ !== config.bot.ownerQQ) break;
              await this.proxy.send({ user_id: config.bot.ownerQQ }, notice.text); this.state.sent[notice.key] = true;
              await saveJSON(new URL('state.json', this.root), this.state);
            }
          }
          this.state.initialized = true; this.state.known = [...new Set([...this.state.known, ...tasks.map(t => t.id)])];
          await saveJSON(new URL('state.json', this.root), this.state);
        } catch { /* Safe diagnostics are available in the local admin status. */ }
      }
      const current = this.config();
      if (!this.stopped && current.monitor.enabled && !this.handler.isBusy() && (!this.lastMonitor || Date.now() - this.lastMonitor >= 60000)) {
        this.lastMonitor = Date.now(); await this.monitor.run();
      }
      if (!this.stopped && moduleActive(this.root, 'core') && current.history.enabled && current.memory.enabled && !this.handler.isBusy() && (!this.lastHistory || Date.now() - this.lastHistory > 60000)) {
        this.lastHistory = Date.now();
        await this.history.tick(current.groups.filter(g => g.enabled && g.historyEnabled).map(g => g.id));
      }
    } finally { this.ticking = false; }
  }
  async status() {
    const exists = async name => { try { await access(new URL(name, this.root)); return true; } catch { return false; } };
    return {
      qq: { connected: this.bot?.socket?.readyState === WebSocket.OPEN, configured: !!this.vault.get('onebotToken'), accountConfigured: !!this.store.get().bot.ownerQQ },
      configured: { ucloud: await exists('session.json'), github: this.store.get().github.authMode === 'chatgpt' ? this.connectors.apps.has('github') : !!this.vault.get('githubToken') || await exists('gh/hosts.yml'), drive: this.store.get().drive.authMode === 'chatgpt' ? this.connectors.apps.has('google_drive') : !!this.vault.get('googleTokens') || await exists('rclone.conf') },
      checks: this.checks, pendingMessages: this.handler.isBusy(), settingsRevision: this.store.get().revision,
      modules: Object.fromEntries(['core', 'github', 'drive', 'ucloud', 'notices'].map(name => [name, moduleActive(this.root, name)])),
    };
  }
  async groups() {
    const rows = await this.proxy.call('get_group_list', {});
    return (Array.isArray(rows) ? rows : []).map(g => ({ id: String(g.group_id), name: String(g.group_name || '').slice(0, 80) }));
  }
  async check(service) {
    try {
      let message;
      if (service === 'ucloud') { await this.sync(); return this.checks.ucloud; }
      if (service === 'github') { await this.resources(this.config()).github(''); message = '已验证 GitHub 读取权限'; }
      else if (service === 'drive') { await this.resources(this.config()).drive('列表', ''); message = '已验证 Google Drive 读取权限'; }
      else if (service === 'model') { await this.ai('仅回复：连接成功', {}); message = '模型已返回文字'; }
      else throw new Error('未知连接。');
      return this.checks[service] = { ok: true, message, checkedAt: new Date().toISOString() };
    } catch (error) {
      const messages = { github: '连接失败，请检查 Token 权限或已有 gh 登录。', drive: '连接失败，请检查 Google 授权、Drive API 或已有 rclone 登录。', model: '连接失败，请检查模型名、登录与额度。', ucloud: '连接失败，请重新登录学校账号。' };
      const config = this.store.get();
      const native = service === 'drive' && config.drive.authMode === 'chatgpt' || service === 'github' && config.github.authMode === 'chatgpt';
      return this.checks[service] = { ok: false, message: native ? 'ChatGPT 插件读取失败，请确认本机 Codex 使用同一账号且插件已连接。' : messages[service] || '连接失败。', checkedAt: new Date().toISOString() };
    }
  }
}
