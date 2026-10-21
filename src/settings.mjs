import { readJSON, saveJSON } from './core.mjs';
import { templateIds } from './group-templates.mjs';
import { migrateSettings } from './settings-migrations.mjs';
import { writeFile } from 'node:fs/promises';

export const DEFAULT_PROMPT = '自然随意地交流，可以幽默、接梗。根据问题决定详略；需要解释时把问题讲清楚。';
const qq = value => typeof value === 'string' && /^\d{5,15}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const bool = value => typeof value === 'boolean';
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const address = (value, protocols) => {
  try { const url = new URL(value); return protocols.includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
};
const local = value => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
const rules = {
  realtime: { enabled: bool, groups: v => Array.isArray(v) && v.length <= 20 && v.every(qq) && new Set(v).size === v.length, recipientQQ: v => v === '' || qq(v), accountId: v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v), debounceSeconds: v => integer(v, 1, 120), focus: v => text(v, 2000) },
  agent: { enabled: bool, writes: bool, maxSteps: v => integer(v, 1, 8) },
  bot: { name: v => text(v, 40) && !!v.trim(), ownerQQ: v => v === '' || qq(v), systemPrompt: v => text(v, 12000) },
  ai: { backend: v => ['codex', 'api'].includes(v), model: v => text(v, 100) && !!v.trim(), baseURL: v => address(v, ['https:', 'http:']) && (v.startsWith('https:') || local(v)), apiModel: v => text(v, 100) },
  qq: { url: v => address(v, ['ws:', 'wss:']) && (v.startsWith('wss:') || local(v)) },
  school: { enabled: bool, pollSeconds: v => integer(v, 60, 86400), reminders: bool },
  github: { enabled: bool, authMode: v => ['chatgpt', 'existing', 'token'].includes(v), defaultRepo: v => v === '' || /^[\w.-]+\/[\w.-]+$/.test(v) && v.length <= 200 },
  drive: { enabled: bool, accessMode: v => ['read', 'write'].includes(v), authMode: v => ['chatgpt', 'existing', 'oauth'].includes(v), clientId: v => text(v, 250) && (v === '' || /^[\w.-]+\.apps\.googleusercontent\.com$/.test(v)), rootFolderId: v => v === '' || /^[\w-]{1,200}$/.test(v) },
  library: { root: v => text(v, 1000), sendToModel: bool },
  memory: { enabled: bool, recentLimit: v => integer(v, 2, 40), ttlMinutes: v => integer(v, 1, 1440), groupContext: bool, groupContextLimit: v => integer(v, 2, 60) },
  history: { enabled: bool },
  monitor: { enabled: bool, groups: v => Array.isArray(v) && v.length <= 20 && v.every(qq) && new Set(v).size === v.length,
    intervalMinutes: v => integer(v, 15, 10080), lookbackDays: v => integer(v, 1, 30), maxMessages: v => integer(v, 20, 500),
    notify: bool, recipientQQ: v => v === '' || qq(v), focus: v => text(v, 2000) },
};

export function defaults(env = {}) {
  const allowed = (env.ALLOWED_GROUPS || '').split(',').map(v => v.trim()).filter(qq);
  const history = (env.GROUP_HISTORY_MODEL_GROUPS || '').split(',').map(v => v.trim());
  return {
    version: 3, revision: 0, profiles: [], accounts: [{ id: 'default', name: 'Default QQ', enabled: true, url: env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001', defaultProfileId: '' }], bindings: [],
    realtime: { enabled: false, groups: [], recipientQQ: '', accountId: 'default', debounceSeconds: 10, focus: '\u8003\u8bd5\u3001\u9009\u8bfe\u3001\u62a5\u540d\u3001\u6750\u6599\u63d0\u4ea4\u3001\u622a\u6b62\u65f6\u95f4\u3001\u8bfe\u7a0b\u8c03\u6574\u3001\u5956\u52a9\u8bc4\u4f18\u53ca\u91cd\u8981\u6d3b\u52a8\u3002' }, agent: { enabled: false, writes: false, maxSteps: 4 },
    bot: { name: env.BOT_NAME || 'slyra', ownerQQ: env.OWNER_QQ || '', systemPrompt: env.BOT_SYSTEM_PROMPT || DEFAULT_PROMPT },
    ai: { backend: env.AI_BACKEND === 'api' ? 'api' : 'codex', model: env.CODEX_MODEL || 'gpt-6-luna', baseURL: env.OPENAI_BASE_URL || 'https://api.openai.com/v1', apiModel: env.OPENAI_MODEL || '' },
    qq: { url: env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001' },
    school: { enabled: !!env.OWNER_QQ, pollSeconds: Number(env.POLL_SECONDS || 900), reminders: true },
    github: { enabled: true, authMode: 'existing', defaultRepo: '' },
    drive: { enabled: true, accessMode: 'read', authMode: 'existing', clientId: '', rootFolderId: '' },
    library: { root: env.SHARED_PDFS_ROOT || '', sendToModel: env.SHARED_DOCUMENTS_TO_MODEL === 'true' },
    memory: { enabled: true, recentLimit: 16, ttlMinutes: 60, groupContext: true, groupContextLimit: 24 },
    history: { enabled: env.HISTORY_DIGEST_ENABLED === 'true' },
    monitor: { enabled: false, groups: [], intervalMinutes: 120, lookbackDays: 7, maxMessages: 200, notify: false, recipientQQ: '', focus: '考试、选课、报名、材料提交、截止时间、课程调整、奖助评优及重要活动。忽略闲聊、广告、重复转发和个人隐私。' },
    groups: [...new Set(allowed)].map(id => ({ id, name: '', enabled: true, historyEnabled: history.includes(id), template: 'auto', templatePrompt: '', profileId: '' })),
  };
}

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象。');
  input = migrateSettings(input);
  if (Array.isArray(input.groups)) input.groups = input.groups.map(group => group && typeof group === 'object' && !Array.isArray(group) ? { template: 'auto', templatePrompt: '', ...group } : group);
  const allowed = ['version', 'revision', 'groups', 'profiles', 'accounts', 'bindings', ...Object.keys(rules)];
  if (Object.keys(input).some(key => !allowed.includes(key)) || input.version !== 3 || !integer(input.revision, 0, Number.MAX_SAFE_INTEGER)) throw new Error('配置版本或字段无效。');
  if (!Array.isArray(input.profiles) || input.profiles.length > 50 || input.profiles.some(p => !p || Object.keys(p).sort().join() !== 'id,model,name,systemPrompt' || typeof p.id !== 'string' || p.id === '_' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id) || !text(p.name, 40) || !p.name.trim() || !text(p.systemPrompt, 12000) || !text(p.model, 100)) || new Set(input.profiles.map(p => p.id)).size !== input.profiles.length) throw new Error('角色设置有误，请检查名称、模型和角色设定；最多 50 个角色。');
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
  const profileRef = value => value === '' || input.profiles.some(p => p.id === value);
  if (!Array.isArray(input.accounts) || input.accounts.length < 1 || input.accounts.length > 20 || !input.accounts.some(a => a.id === 'default') || input.accounts.some(a => !a || Object.keys(a).sort().join() !== 'defaultProfileId,enabled,id,name,url' || !identifier(a.id) || !text(a.name, 40) || !a.name.trim() || !bool(a.enabled) || !rules.qq.url(a.url) || !profileRef(a.defaultProfileId)) || new Set(input.accounts.map(a => a.id)).size !== input.accounts.length) throw new Error('QQ 账号设置有误，请检查账号备注、连接地址和默认角色；最多 20 个账号。');
  if (!Array.isArray(input.bindings) || input.bindings.length > 1000 || input.bindings.some(b => !b || Object.keys(b).sort().join() !== 'accountId,enabled,id,kind,profileId,targetId' || !identifier(b.id) || !input.accounts.some(a => a.id === b.accountId) || !['group', 'private'].includes(b.kind) || !qq(b.targetId) || !profileRef(b.profileId) || !bool(b.enabled)) || new Set(input.bindings.map(b => b.id)).size !== input.bindings.length || new Set(input.bindings.map(b => `${b.accountId}:${b.kind}:${b.targetId}`)).size !== input.bindings.length) throw new Error('角色分配有误，请选择已有账号和角色，填写有效的群号或好友 QQ；同一聊天只能分配一次。');
  if (!input.accounts.some(a => a.id === input.realtime?.accountId)) throw new Error('群消息提醒使用的 QQ 已不存在，请重新选择账号。');
  for (const [section, fields] of Object.entries(rules)) {
    const values = input[section];
    if (!values || typeof values !== 'object' || Object.keys(values).length !== Object.keys(fields).length || Object.keys(values).some(key => !fields[key])) throw new Error(`配置分区 ${section} 不完整。`);
    for (const [field, validate] of Object.entries(fields)) if (!validate(values[field])) throw new Error(`配置 ${section}.${field} 无效，请检查内容或范围。`);
  }
  if (!Array.isArray(input.groups) || input.groups.length > 200 || input.groups.some(g => !g || Object.keys(g).sort().join() !== 'enabled,historyEnabled,id,name,profileId,template,templatePrompt' || !qq(g.id) || !text(g.name, 80) || !bool(g.enabled) || !bool(g.historyEnabled) || !templateIds.includes(g.template) || !text(g.templatePrompt, 2000) || typeof g.profileId !== 'string' || !(g.profileId === '' || input.profiles.some(p => p.id === g.profileId))) || new Set(input.groups.map(g => g.id)).size !== input.groups.length) throw new Error('群号、场景模板或群提示词无效，群号必须唯一且方案必须存在，最多 200 个群。');
  return structuredClone(input);
}

export class SettingsStore {
  constructor(file = new URL('../data/settings.json', import.meta.url), env = process.env) { this.file = file; this.env = env; this.queue = Promise.resolve(); }
  async load() {
    const saved = await readJSON(this.file, null);
    let migrated = saved;
    if (saved && saved.memory && saved.memory.groupContext === undefined && saved.memory.groupContextLimit === undefined) migrated = { ...migrated, memory: { ...saved.memory, groupContext: true, groupContextLimit: 24 } };
    if (migrated && !Object.hasOwn(migrated, 'monitor')) migrated = { ...migrated, monitor: defaults({}).monitor };
    this.value = validateSettings(migrated || defaults(this.env));
    if (saved?.version === 1 || saved?.version === 2) {
      const backup = new URL(this.file.href); backup.pathname = backup.pathname.replace(/\.json$/, '') + `.v${saved.version}.backup.json`;
      try { await writeFile(backup, JSON.stringify(saved, null, 2), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!saved || JSON.stringify(saved) !== JSON.stringify(this.value)) await saveJSON(this.file, this.value);
    return this.get();
  }
  get() { return structuredClone(this.value); }
  update(input, expectedRevision) {
    const work = this.queue.catch(() => {}).then(async () => {
      if (expectedRevision !== this.value.revision) { const error = new Error('配置已在其他页面更新，请重新载入后保存。'); error.status = 409; throw error; }
      const candidate = structuredClone(input), account = candidate.accounts?.find(a => a.id === 'default');
      if (account && candidate.qq) {
        const previousAccount = this.value.accounts.find(a => a.id === 'default');
        const accountChanged = account.url !== previousAccount.url, legacyChanged = candidate.qq.url !== this.value.qq.url;
        if (accountChanged && legacyChanged && account.url !== candidate.qq.url) throw new Error('默认 QQ 账号连接地址不一致。');
        if (accountChanged) candidate.qq.url = account.url;
        else account.url = candidate.qq.url;
      }
      const next = validateSettings(candidate); next.revision = this.value.revision + 1;
      await saveJSON(this.file, next); this.value = next; return this.get();
    });
    this.queue = work; return work;
  }
}

export function modelEnv(settings, secrets = {}, base = process.env) {
  return { ...base, BOT_NAME: settings.bot.name, BOT_SYSTEM_PROMPT: settings.bot.systemPrompt, AI_BACKEND: settings.ai.backend,
    CODEX_MODEL: settings.ai.model, OPENAI_MODEL: settings.ai.apiModel, OPENAI_BASE_URL: settings.ai.baseURL,
    OPENAI_API_KEY: secrets.openaiKey || '', GH_TOKEN: secrets.githubToken || '' };
}
