import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { AgentTools, ToolAgent } from './agent-tools.mjs';
import { AgentGitHub } from './agent-github.mjs';
import { AgentDrive } from './agent-drive.mjs';
import { AgentSchool } from './agent-school.mjs';
import { NativeAgentTools } from './agent-native.mjs';
import { SchoolClient, readJSON, saveJSON, notificationPlan, askAI } from './core.mjs';
import { OneBot } from './onebot.mjs';
import { PublicCatalog, upcoming } from './access.mjs';
import { PrivateResources } from './resources.mjs';
import { GoogleDrive } from './google-drive.mjs';
import { askCodex } from './codex-ai.mjs';
import { askDeepSeek } from './deepseek-ai.mjs';
import { askHarness } from './deepseek-harness.mjs';
import { ConversationMemory } from './persona.mjs';
import { createMessageHandler } from './message-handler.mjs';
import { SharedLibrary } from './shared-library.mjs';
import { MessageMedia } from './message-media.mjs';
import { OutgoingMedia } from './outgoing-media.mjs';
import { XiaomiSpeech } from './xiaomi-speech.mjs';
import { SpeechReferenceStore } from './speech-reference.mjs';
import { speechDirection, planSpeechStyle } from './speech-direction.mjs';
import { HistoryDigest } from './history-digest.mjs';
import { ManagedMemory } from './managed-memory.mjs';
import { modelEnv } from './settings.mjs';
import { ChatGPTConnectorClient, ChatGPTResources } from './chatgpt-connectors.mjs';
import { GroupMembers } from './group-members.mjs';
import { RealtimeNotices } from './realtime-notices.mjs';
import { NoticeMonitor } from './notice-monitor.mjs';
import { moduleActive } from './plugin-modules.mjs';
import { CodexAccount } from './codex-account.mjs';
import { groupTemplate } from './group-templates.mjs';
import { resolveGroupPolicy, profileSettings, resolveConversation } from './group-policy.mjs';
import { MODULES, MODULE_IDS } from './module-registry.mjs';
import { MessageWorkspace } from './message-workspace.mjs';
import { ConversationLearner } from './conversation-learning.mjs';
import { OnlineMedia } from './online-media.mjs';
import { contactMemoryMode } from './group-policy.mjs';

const project = new URL('../', import.meta.url);
const execute = promisify(execFile);
export class BotRuntime {
  constructor(store, vault, { root = new URL('data/', project), botFactory = (...args) => new OneBot(...args) } = {}) {
    this.store = store; this.vault = vault; this.root = root; this.botFactory = botFactory; this.checks = {}; this.transportVersion = 0;
    this.transports = new Map(); this.accountServices = new Map(); this.selfIds = new Map();
    this.pendingActions = new Map(); this.agentSessions = new Map(); this.toolAudit = []; this.credentialVersion = 0;
    this.memory = new ConversationMemory(); this.notes = new ManagedMemory(root);
    this.learner = new ConversationLearner({ root, ai: (q, c) => this.ai(q, c), modeFor: event => {
      const current = this.store.get(), conversation = resolveConversation(current, event);
      return !this.stopped && moduleActive(root, 'core') && conversation.enabled && conversation.profileId === (event.profileId || '') ? contactMemoryMode(current, event) : 'normal';
    } });
    this.school = new SchoolClient(new URL('session.json', root));
    this.schoolAgent = new AgentSchool(this.school, { getUserId: async () => (await readJSON(new URL('session.json', root))).userId });
    this.catalog = new PublicCatalog(new URL('public-assignments.json', root), new URL('public/books.json', project));
    this.google = new GoogleDrive({ settings: () => store.get(), vault });
    this.connectors = new ChatGPTConnectorClient(); this.native = new ChatGPTResources(this.connectors);
    this.account = new CodexAccount();
    this.history = new HistoryDigest({ root: new URL('history/', root), ai: (q, c) => this.ai(q, c) });
    this.proxy = {
      call: (action, params, options = {}) => this.transport(options.accountId).call(action, params),
      send: (target, text, options = {}) => {
        const accountId = target.accountId || options?.accountId || 'default';
        if (target.group_id && !resolveGroupPolicy(this.store.get(), target.group_id, accountId).canReply) throw new Error('\u6b64\u7fa4\u7981\u6b62\u673a\u5668\u4eba\u53d1\u8a00\u3002');
        const { accountId: ignored, ...recipient } = target;
        return this.transport(accountId).send(recipient, text, options);
      },
      sendSegments: (target, segments, options = {}) => {
        const accountId = target.accountId || options.accountId || 'default';
        if (target.group_id && !resolveGroupPolicy(this.store.get(), target.group_id, accountId).canReply) throw new Error('\u6b64\u7fa4\u7981\u6b62\u673a\u5668\u4eba\u53d1\u8a00\u3002');
        const { accountId: ignored, ...recipient } = target;
        return this.transport(accountId).sendSegments(recipient, segments, options);
      },
    };
    this.media = new MessageMedia(this.proxy);
    this.outgoingMedia = new OutgoingMedia(root);
    this.onlineMedia = new OnlineMedia(this.outgoingMedia);
    this.speechReferences = new SpeechReferenceStore(root);
    this.speech = new XiaomiSpeech({ settings: () => this.config().speech, key: () => this.vault.get('mimoKey'), referenceAudio: id => this.speechReferences.dataURL(id) });
    this.monitor = new NoticeMonitor({ settings: () => this.config(), ai: (q, c) => this.ai(q, c), send: (target, text) => this.proxy.send(target, text), root: new URL('notices/', root) });
    this.inbox = new MessageWorkspace({ monitor: this.monitor, root });
    this.realtime = new RealtimeNotices({ settings: () => this.config(), ai: (q, c) => this.ai(q, c), record: batch => this.inbox.recordNotifications(batch) });
    this.members = new GroupMembers(this.proxy, () => [...new Set([...this.store.get().groups.map(group => group.id), ...(this.store.get().bindings || []).filter(b => b.accountId === 'default' && b.kind === 'group').map(b => b.targetId)])].filter(id => resolveGroupPolicy(this.store.get(), id).canReply));
    this.handler = createMessageHandler({ bot: this.proxy, memory: this.memory, getDependencies: event => this.dependencies(event) });
  }
  transport(accountId = 'default') {
    if (this.stopped) throw new Error('QQ stopped.');
    const entry = this.transports.get(accountId);
    const bot = entry?.bot || (accountId === 'default' ? this.bot : null);
    if (!bot) throw new Error('QQ account is not connected.');
    return bot;
  }
  services(accountId) {
    if (accountId === 'default') return { media: this.media, members: this.members };
    if (!this.accountServices.has(accountId)) {
      const proxy = { call: (action, params) => this.proxy.call(action, params, { accountId }) };
      this.accountServices.set(accountId, { media: new MessageMedia(proxy), members: new GroupMembers(proxy, () => {
        const config = this.store.get();
        return (config.bindings || []).filter(b => b.accountId === accountId && b.kind === 'group' && resolveGroupPolicy(config, b.targetId, accountId).canReply).map(b => b.targetId);
      }) });
    }
    return this.accountServices.get(accountId);
  }
  config() {
    const config = this.store.get();
    for (const [section, module] of [['github', 'github'], ['drive', 'drive'], ['school', 'ucloud'], ['monitor', 'notices']]) config[section].enabled &&= moduleActive(this.root, module);
    if (config.realtime) config.realtime.enabled &&= moduleActive(this.root, 'notices');
    config.speech.enabled &&= moduleActive(this.root, 'speech');
    return config;
  }
  env(config = this.store.get()) {
    return modelEnv(config, { openaiKey: this.vault.get('openaiKey'), deepseekKey: this.vault.get('deepseekKey'), mimoKey: this.vault.get('mimoKey'), githubToken: config.github.authMode === 'token' ? this.vault.get('githubToken') : '' });
  }
  async ai(question, context, config = this.config(), options = {}) {
    const env = this.env(config);
    if (config.ai.backend === 'api') return askAI(question, context, env, fetch, options);
    if (['mimo-api', 'mimo-token-plan-cn'].includes(config.ai.backend)) {
      const tokenPlan = config.ai.backend === 'mimo-token-plan-cn';
      const validKey = tokenPlan ? /^t{1,2}p-/i.test(env.OPENAI_API_KEY || '') : /^sk-/i.test(env.OPENAI_API_KEY || '');
      if (!validKey) throw new Error(tokenPlan ? 'MiMo Token Plan 中国集群需要 tp- 或 ttp- Key，请在模型设置中保存 MiMo Key。' : 'MiMo 按量 API 需要 sk- Key，请在模型设置中保存 MiMo Key。');
      return askAI(question, context, env, fetch, options);
    }
    if (config.ai.backend === 'deepseek') return askDeepSeek(question, context, env, fetch, options);
    if (config.ai.backend === 'deepseek-harness') return askHarness(question, context, env, options);
    if (config.ai.backend === 'codex') return askCodex(question, context, env, undefined, options);
    throw new Error('未知模型来源，请重新选择模型服务。');
  }
  agent(config) {
    const live = () => this.config();
    const github = config.github.enabled && config.github.authMode !== 'chatgpt' ? new AgentGitHub({ token: async () => {
      const current = live();
      if (!current.agent.enabled || !current.github.enabled || current.github.authMode !== config.github.authMode) throw new Error('GitHub 设置已改变。');
      if (current.github.authMode === 'token') return this.vault.get('githubToken');
      const { stdout } = await execute(process.env.GH_BIN || fileURLToPath(new URL('tools/gh/bin/gh.exe', project)), ['auth', 'token', '--hostname', 'github.com'], { windowsHide: true, shell: false, timeout: 10000, maxBuffer: 16000, env: { ...process.env, GH_CONFIG_DIR: fileURLToPath(new URL('gh/', this.root)), GH_HOST: 'github.com' } });
      return stdout.trim();
    } }) : null;
    const drive = config.drive.enabled && config.drive.authMode === 'oauth' ? new AgentDrive({ google: this.google, canWrite: () => live().agent.enabled && live().agent.writes && live().drive.enabled && live().drive.authMode === 'oauth' && live().drive.accessMode === 'write' }) : null;
    const providers = [...(config.github.enabled && config.github.authMode === 'chatgpt' ? ['github'] : []), ...(config.drive.enabled && config.drive.authMode === 'chatgpt' ? ['google_drive'] : [])];
    const native = providers.length ? new NativeAgentTools({ client: this.connectors, providers }) : null;
    const tools = new AgentTools({ owner: () => live().bot.ownerQQ, settings: () => live().agent, github, drive, native, school: config.school.enabled ? this.school : null, schoolSubmission: config.school.enabled ? this.schoolAgent : null,
      signature: () => createHash('sha256').update(JSON.stringify([live(), this.transportVersion, this.credentialVersion, this.memory.version, this.google.authorizationRevision || 0, this.vault.get('githubToken'), this.vault.get('openaiKey')])).digest('hex'),
      audit: entry => { this.toolAudit.push(entry); this.toolAudit = this.toolAudit.slice(-100); },
    });
    tools.pending = this.pendingActions;
    return new ToolAgent({ tools, ai: (question, context) => this.ai(question, context, config), settings: () => live().agent, sessions: config.memory.enabled ? this.agentSessions : new Map(), context: event => ({ conversation: config.memory.enabled ? this.memory.get(event) : [], botName: config.bot.name }) });
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
        return this.native.driveQuestion(question, config.memory.enabled ? this.memory.key(event) + ':epoch:' + this.memory.version : undefined);
      } } : {}),
      ...(config.github.authMode === 'chatgpt' ? { githubQuestion: (question, event) => {
        if (!config.github.enabled || event.message_type !== 'private' || String(event.user_id) !== config.bot.ownerQQ) throw new Error('只有主人私聊可读取私人 GitHub。');
        return this.native.githubQuestion(question, config.github.defaultRepo);
      } } : {}),
    };
  }
  dependencies(event) {
    const base = this.config(), conversation = resolveConversation(base, event), accountId = conversation.accountId;
    let config = event ? profileSettings(base, conversation.targetId, accountId, conversation.kind) : base;
    const memoryMode = contactMemoryMode(base, event);
    config = { ...config, memory: { ...config.memory, enabled: memoryMode === 'memory' } };
    const enabled = config.groups.filter(g => g.enabled);
    const services = this.services(accountId);
    if (!this.library || this.libraryRoot !== config.library.root) { this.libraryRoot = config.library.root; this.library = config.library.root ? new SharedLibrary(config.library.root) : null; }
    const catalog = config.school.enabled ? this.catalog : {
      list: async () => 'UCloud 未启用。', detail: async () => 'UCloud 未启用。', upcomingTasks: async () => [], books: () => this.catalog.books(),
    };
    const groupIds = [...new Set([...config.groups.map(g => g.id), ...(config.bindings || []).filter(b => b.accountId === accountId && b.kind === 'group').map(b => b.targetId)])];
    const policies = groupIds.map(id => resolveGroupPolicy(config, id, accountId));
    const observable = !this.stopped && (base.accounts?.find(a => a.id === accountId)?.enabled ?? accountId === 'default') && (!event?.transportGeneration || this.transports.get(accountId)?.generation === event.transportGeneration);
    return { enabled: observable && (!event || !Object.hasOwn(event, 'profileId') || event.profileId === conversation.profileId) && (conversation.kind !== 'private' || conversation.enabled) && moduleActive(this.root, 'core'), observeEnabled: observable, observe: event => { this.realtime.observe(event); if (moduleActive(this.root, 'core') && conversation.enabled) services.media.remember?.(event); }, capabilities: JSON.stringify([config, this.memory.version]), groups: policies.filter(g => g.canReply).map(g => g.id), owner: config.bot.ownerQQ, botName: config.bot.name, school: this.school, catalog,
      memoryMode, learn: event => this.learner.observe(event, { profileId: conversation.profileId, mode: memoryMode }),
      resources: this.resources(config), agent: this.agent(config), ai: (q, c, options) => this.ai(q, c, config, options), library: this.library, media: services.media, members: services.members,
      outgoingMedia: { list: event => this.outgoingMedia.available(event), outgoing: (event, id) => this.outgoingMedia.outgoing(event, id), collect: (event, input) => this.outgoingMedia.collect(event, input, { call: (action, params) => this.proxy.call(action, params, { accountId }) }) },
      speech: config.speech.enabled ? { ...speechDirection(config.speech), autoReply: config.speech.autoReply,
        plan: (text, event) => planSpeechStyle(text, { ai: (q, c) => this.ai(q, c, config), direction: speechDirection(config.speech), conversation: config.memory.enabled ? this.memory.get(event).slice(-4).map(row => ({ speaker: row.speaker, text: row.text })) : [] }),
        synthesize: (text, event, direction) => this.speech.synthesize(text, [accountId, event.message_type, event.group_id || event.user_id].join(':'), direction),
        synthesizeBatch: (requests, event, options) => this.speech.synthesizeBatch(requests, [accountId, event.message_type, event.group_id || event.user_id].join(':'), options) } : null,
      stickers: { list: event => services.media.listStickers(event), outgoing: (event, id) => services.media.outgoingSticker(event, id), send: (event, id) => this.proxy.sendSegments({ ...(event.message_type === 'group' ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }), accountId }, [services.media.outgoingSticker(event, id)]) },
      notes: config.memory.enabled ? { context: (event, query) => this.learner.context(event, { profileId: conversation.profileId, mode: memoryMode, query }) } : null, monitor: this.monitor, groupTemplate: id => groupTemplate(config.groups.find(group => group.id === id)),
      history: config.memory.enabled && config.history.enabled ? { context: id => enabled.some(g => g.id === id && g.historyEnabled) ? this.history.context(id) : null } : null,
      persona: async () => ({ voice: [], learned: false }), shareDocumentsWithModel: config.library.sendToModel, transportVersion: this.transportVersion,
    };
  }
  apply() {
    this.learner.reconcile();
    const config = this.config(); this.memory.configure({ ...config.memory, enabled: true });
    const personaSignature = JSON.stringify([config.accounts, config.bindings, config.profiles, config.groups, config.bot, config.ai, config.chat]);
    if (this.personaSignature && this.personaSignature !== personaSignature) this.memory.clear('all');
    this.personaSignature = personaSignature;
    const identities = new Map(config.groups.map(group => [group.id, JSON.stringify([profileSettings(config, group.id).bot, profileSettings(config, group.id).ai, group.profileId, group.template, group.templatePrompt])]));
    if (this.groupIdentities) for (const [id, identity] of this.groupIdentities) if (identities.get(id) !== identity) this.memory.clear('group:' + id);
    this.groupIdentities = identities;
    this.members.retain();
    for (const scope of this.memory.sessions.keys()) if (scope.startsWith('group:') && !config.groups.some(group => group.enabled && 'group:' + group.id === scope)) this.memory.clear(scope);
    const appSignature = JSON.stringify([config.drive.authMode, config.drive.rootFolderId, config.drive.enabled, config.github.authMode, config.github.enabled, config.bot.ownerQQ, config.memory.enabled]);
    if (appSignature !== this.appSignature) { this.appSignature = appSignature; this.native.selections.clear(); }
    if (config.bot.ownerQQ && (config.drive.enabled && config.drive.authMode === 'chatgpt' || config.github.enabled && config.github.authMode === 'chatgpt')) this.connectors.ready().catch(() => {});
    else if (this.connectors.child) this.connectors.close();
    const accounts = config.accounts || [{ id: 'default', enabled: true, url: config.qq.url }];
    for (const [id, entry] of this.transports) if (!accounts.some(a => a.id === id && a.enabled)) {
      entry.bot.close(); this.transports.delete(id); this.selfIds.delete(id); this.accountServices.delete(id); this.transportVersion++;
    }
    for (const account of accounts) {
      if (!account.enabled) continue;
      const token = this.vault.get(account.id === 'default' ? 'onebotToken' : `onebotToken:${account.id}`) || '';
      const url = account.id === 'default' ? config.qq.url : account.url;
      const signature = JSON.stringify([url, token]);
      if (this.transports.get(account.id)?.signature === signature) continue;
      this.transports.get(account.id)?.bot.close(); this.transports.delete(account.id); this.selfIds.delete(account.id); this.accountServices.delete(account.id);
      const generation = ++this.transportVersion;
      if (!token) continue;
      const entry = { signature, generation, bot: null };
      entry.bot = this.botFactory(url, token, async incoming => {
        if (this.stopped || this.transports.get(account.id) !== entry) return;
        const selfId = String(incoming.self_id || '');
        if (!/^\d{5,15}$/.test(selfId)) return;
        const previous = this.selfIds.get(account.id);
        if (previous && previous !== selfId || [...this.selfIds].some(([id, value]) => id !== account.id && value === selfId)) return;
        if (entry.selfId && entry.selfId !== selfId) {
          for (const scope of this.memory.sessions.keys()) if (scope.startsWith(`account:${account.id}:`)) this.memory.clear(scope);
          const services = this.services(account.id); services.members.clear(); services.media.stickers.clear();
          this.agentSessions.clear(); this.pendingActions.clear(); this.native.selections.clear();
          for (const scope of this.learner.watched.keys()) if (scope.startsWith(`account:${account.id}:`)) this.learner.invalidate(scope);
        }
        entry.selfId = selfId;
        this.selfIds.set(account.id, selfId);
        const event = { ...incoming, accountId: account.id, transportGeneration: entry.generation };
        event.profileId = resolveConversation(this.config(), event).profileId;
        return this.handler(event);
      }, { onConnect: () => {
        if (this.stopped || this.transports.get(account.id) !== entry) return;
        // A new authenticated connection may belong to a newly logged-in QQ.
        // Revoke old work before accepting its first lifecycle/message event.
        this.selfIds.delete(account.id); entry.generation = ++this.transportVersion;
      } });
      this.transports.set(account.id, entry); entry.bot.connect();
    }
    this.bot = this.transports.get('default')?.bot || null;

  }
  async start() {
    this.state = await readJSON(new URL('state.json', this.root), { initialized: false, known: [], sent: {} });
    if (!Array.isArray(this.state.known) || !this.state.sent || typeof this.state.sent !== 'object') throw new Error('提醒状态格式无效，请检查 data/state.json。');
    this.apply(); this.interval = setInterval(() => this.tick().catch(() => {}), 1000); this.interval.unref(); this.tick().catch(() => {});
  }
  stop() { this.stopped = true; this.learner.close(); clearInterval(this.interval); for (const entry of this.transports.values()) entry.bot.close(); this.transports.clear(); this.transportVersion++; this.connectors.dispose(); this.account.close(); }
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
      this.realtime.tick().catch(() => {});
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
      if (!this.stopped && moduleActive(this.root, 'core') && current.history.enabled && !this.handler.isBusy() && (!this.lastHistory || Date.now() - this.lastHistory > 60000)) {
        this.lastHistory = Date.now();
        await this.history.tick(current.groups.filter(g => g.enabled && g.historyEnabled).map(g => g.id));
      }
    } finally { this.ticking = false; }
  }
  async status() {
    const exists = async name => { try { await access(new URL(name, this.root)); return true; } catch { return false; } };
    return {
      accounts: (this.store.get().accounts || []).map(a => ({ id: a.id, name: a.name, enabled: a.enabled, connected: this.transports.get(a.id)?.bot.socket?.readyState === WebSocket.OPEN, selfId: this.selfIds.get(a.id) || '', configured: !!this.vault.get(a.id === 'default' ? 'onebotToken' : `onebotToken:${a.id}`) })),
      qq: { connected: this.bot?.socket?.readyState === WebSocket.OPEN, configured: !!this.vault.get('onebotToken'), accountConfigured: !!this.store.get().bot.ownerQQ },
      configured: { ucloud: await exists('session.json'), github: this.store.get().github.authMode === 'chatgpt' ? this.connectors.apps.has('github') : !!this.vault.get('githubToken') || await exists('gh/hosts.yml'), drive: this.store.get().drive.authMode === 'chatgpt' ? this.connectors.apps.has('google_drive') : !!this.vault.get('googleTokens') || await exists('rclone.conf') },
      checks: this.checks, realtime: this.realtime.status(), pendingMessages: this.handler.isBusy(), messageDelivery: this.handler.status?.(), settingsRevision: this.store.get().revision,
      modules: Object.fromEntries(MODULE_IDS.map(name => [name, moduleActive(this.root, name)])),
    };
  }
  workspace() {
    const config = this.config();
    return { revision: config.revision, modules: MODULES.map(module => ({ ...module, active: moduleActive(this.root, module.id) })), profiles: config.profiles, accounts: config.accounts, bindings: config.bindings,
      groups: [...new Set([...config.groups.map(group => group.id), ...config.monitor.groups])].map(id => resolveGroupPolicy(config, id)) };
  }
  async groups(accountId = 'default') {
    const rows = await this.proxy.call('get_group_list', {}, { accountId });
    return (Array.isArray(rows) ? rows : []).map(g => ({ id: String(g.group_id), name: String(g.group_name || '').slice(0, 80) }));
  }
  async contacts(accountId = 'default') {
    const [groups, friends] = await Promise.allSettled([
      this.groups(accountId), this.proxy.call('get_friend_list', {}, { accountId }),
    ]);
    return {
      groups: groups.status === 'fulfilled' ? groups.value : [],
      friends: friends.status === 'fulfilled' && Array.isArray(friends.value) ? friends.value.map(f => ({ id: String(f.user_id), name: String(f.remark || f.nickname || f.user_id).slice(0, 80) })) : [],
      errors: [groups.status === 'rejected' && '群列表读取失败，请检查这个 QQ 是否在线。', friends.status === 'rejected' && '好友列表读取失败，请检查这个 QQ 是否在线。'].filter(Boolean),
    };
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
      const modelMessage = service === 'model' && ['deepseek', 'deepseek-harness', 'mimo-api', 'mimo-token-plan-cn'].includes(config.ai.backend) ? error instanceof TypeError ? (config.ai.backend.startsWith('mimo-') ? 'MiMo API 网络请求失败，请检查连接。' : 'DeepSeek 网络请求失败，请检查网络连接。') : error.message : null;
      return this.checks[service] = { ok: false, message: native ? 'ChatGPT 插件读取失败，请确认本机 Codex 使用同一账号且插件已连接。' : modelMessage || messages[service] || '连接失败。', checkedAt: new Date().toISOString() };
    }
  }
}
