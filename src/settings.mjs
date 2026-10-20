import { readJSON, saveJSON } from './core.mjs';

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
  bot: { name: v => text(v, 40) && !!v.trim(), ownerQQ: v => v === '' || qq(v), systemPrompt: v => text(v, 12000) },
  ai: { backend: v => ['codex', 'api'].includes(v), model: v => text(v, 100) && !!v.trim(), baseURL: v => address(v, ['https:', 'http:']) && (v.startsWith('https:') || local(v)), apiModel: v => text(v, 100) },
  qq: { url: v => address(v, ['ws:', 'wss:']) && (v.startsWith('wss:') || local(v)) },
  school: { enabled: bool, pollSeconds: v => integer(v, 60, 86400), reminders: bool },
  github: { enabled: bool, authMode: v => ['chatgpt', 'existing', 'token'].includes(v), defaultRepo: v => v === '' || /^[\w.-]+\/[\w.-]+$/.test(v) && v.length <= 200 },
  drive: { enabled: bool, authMode: v => ['chatgpt', 'existing', 'oauth'].includes(v), clientId: v => text(v, 250) && (v === '' || /^[\w.-]+\.apps\.googleusercontent\.com$/.test(v)), rootFolderId: v => v === '' || /^[\w-]{1,200}$/.test(v) },
  library: { root: v => text(v, 1000), sendToModel: bool },
  memory: { enabled: bool, recentLimit: v => integer(v, 2, 40), ttlMinutes: v => integer(v, 1, 1440), groupContext: bool, groupContextLimit: v => integer(v, 2, 60) },
  history: { enabled: bool },
};

export function defaults(env = {}) {
  const allowed = (env.ALLOWED_GROUPS || '').split(',').map(v => v.trim()).filter(qq);
  const history = (env.GROUP_HISTORY_MODEL_GROUPS || '').split(',').map(v => v.trim());
  return {
    version: 1, revision: 0,
    bot: { name: env.BOT_NAME || 'slyra', ownerQQ: env.OWNER_QQ || '', systemPrompt: env.BOT_SYSTEM_PROMPT || DEFAULT_PROMPT },
    ai: { backend: env.AI_BACKEND === 'api' ? 'api' : 'codex', model: env.CODEX_MODEL || 'gpt-6-luna', baseURL: env.OPENAI_BASE_URL || 'https://api.openai.com/v1', apiModel: env.OPENAI_MODEL || '' },
    qq: { url: env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001' },
    school: { enabled: !!env.OWNER_QQ, pollSeconds: Number(env.POLL_SECONDS || 900), reminders: true },
    github: { enabled: true, authMode: 'existing', defaultRepo: '' },
    drive: { enabled: true, authMode: 'existing', clientId: '', rootFolderId: '' },
    library: { root: env.SHARED_PDFS_ROOT || '', sendToModel: env.SHARED_DOCUMENTS_TO_MODEL === 'true' },
    memory: { enabled: true, recentLimit: 16, ttlMinutes: 60, groupContext: true, groupContextLimit: 24 },
    history: { enabled: env.HISTORY_DIGEST_ENABLED === 'true' },
    groups: [...new Set(allowed)].map(id => ({ id, name: '', enabled: true, historyEnabled: history.includes(id) })),
  };
}

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象。');
  const allowed = ['version', 'revision', 'groups', ...Object.keys(rules)];
  if (Object.keys(input).some(key => !allowed.includes(key)) || input.version !== 1 || !integer(input.revision, 0, Number.MAX_SAFE_INTEGER)) throw new Error('配置版本或字段无效。');
  for (const [section, fields] of Object.entries(rules)) {
    const values = input[section];
    if (!values || typeof values !== 'object' || Object.keys(values).length !== Object.keys(fields).length || Object.keys(values).some(key => !fields[key])) throw new Error(`配置分区 ${section} 不完整。`);
    for (const [field, validate] of Object.entries(fields)) if (!validate(values[field])) throw new Error(`配置 ${section}.${field} 无效，请检查内容或范围。`);
  }
  if (!Array.isArray(input.groups) || input.groups.length > 200 || input.groups.some(g => !g || Object.keys(g).sort().join() !== 'enabled,historyEnabled,id,name' || !qq(g.id) || !text(g.name, 80) || !bool(g.enabled) || !bool(g.historyEnabled)) || new Set(input.groups.map(g => g.id)).size !== input.groups.length) throw new Error('群号必须唯一且为 5–15 位数字，最多 200 个群。');
  return structuredClone(input);
}

export class SettingsStore {
  constructor(file = new URL('../data/settings.json', import.meta.url), env = process.env) { this.file = file; this.env = env; this.queue = Promise.resolve(); }
  async load() {
    const saved = await readJSON(this.file, null);
    const migrated = saved && saved.memory && saved.memory.groupContext === undefined && saved.memory.groupContextLimit === undefined ? { ...saved, memory: { ...saved.memory, groupContext: true, groupContextLimit: 24 } } : saved;
    this.value = validateSettings(migrated || defaults(this.env));
    if (!saved || migrated !== saved) await saveJSON(this.file, this.value);
    return this.get();
  }
  get() { return structuredClone(this.value); }
  update(input, expectedRevision) {
    const work = this.queue.catch(() => {}).then(async () => {
      if (expectedRevision !== this.value.revision) { const error = new Error('配置已在其他页面更新，请重新载入后保存。'); error.status = 409; throw error; }
      const next = validateSettings(input); next.revision = this.value.revision + 1;
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
