import { readJSON } from './core.mjs';
import { segments, contentText } from './message-content.mjs';

export function messageText(event) {
  return Array.isArray(event.message) ? event.message.filter(part => part.type === 'text').map(part => String(part.data?.text || '')).join('').trim() :
    String(event.raw_message || event.message || '').replace(/\[CQ:[^\]]+\]/g, '').trim();
}

export function scrubSample(text) {
  return String(text).replace(/https?:\/\/\S+/gi, '[链接]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, '[电话]').replace(/\b\d{5,}\b/g, '[号码]')
    .replace(/(?:密码|token|api.?key|secret)\s*[:：=]\s*\S+/gi, '[凭据]').slice(0, 280);
}

export function styleSamples(messages, selfId) {
  return messages.filter(message => String(message.user_id) !== String(selfId)).map(messageText).filter(text => text && !text.startsWith('/'))
    .slice(-300).map(scrubSample).filter(Boolean);
}

export class ConversationMemory {
  constructor(limit = 16) { this.limit = limit; this.ttl = 3600000; this.enabled = true; this.sessions = new Map(); this.version = 0; }
  configure({ recentLimit, ttlMinutes, enabled }) { this.limit = recentLimit; this.ttl = ttlMinutes * 60000; this.enabled = enabled; for (const session of this.sessions.values()) session.entries = session.entries.slice(-this.limit); }
  key(event) { return event.message_type === 'group' ? `group:${event.group_id}` : `private:${event.user_id}`; }
  add(event, text, assistant = false) {
    if (!this.enabled) return;
    const key = this.key(event);
    const existing = this.sessions.get(key);
    const session = existing && Date.now() - existing.touched <= this.ttl ? existing : { aliases: new Map(), entries: [], touched: Date.now() };
    const id = String(event.user_id);
    if (!session.aliases.has(id)) session.aliases.set(id, '群友' + (session.aliases.size + 1));
    session.entries.push({ speaker: assistant ? '机器人' : event.message_type === 'group' ? session.aliases.get(id) : '用户', text: String(text).slice(0, 1500) });
    session.entries = session.entries.slice(-this.limit); session.touched = Date.now(); this.sessions.set(key, session);
    for (const [sessionKey, value] of this.sessions) if (Date.now() - value.touched > this.ttl) this.sessions.delete(sessionKey);
    if (this.sessions.size > 100) this.sessions.delete(this.sessions.keys().next().value);
  }
  get(event) { const session = this.sessions.get(this.key(event)); return this.enabled && session && Date.now() - session.touched <= this.ttl ? session.entries : []; }
  list() { return [...this.sessions].filter(([, session]) => Date.now() - session.touched <= this.ttl).map(([scope, session]) => ({ scope, touched: session.touched, entries: session.entries })); }
  clear(scope) { this.version++; if (scope === 'all') this.sessions.clear(); else this.sessions.delete(scope); }
}

export async function loadPersona(groupId) {
  const profile = await readJSON(new URL(`../data/persona-${groupId}.json`, import.meta.url), null);
  if (profile?.groupId !== String(groupId)) return { voice: ['自然随意地交流，可以幽默、接梗，按问题需要回答，不强行演人设。'], learned: false };
  return { voice: profile.voice, learned: true };
}

export function incomingText(event, groups) {
  if (event.post_type !== 'message' || !['group', 'private'].includes(event.message_type) || String(event.user_id) === String(event.self_id)) return null;
  if (event.message_type === 'group') {
    const id = String(event.group_id);
    if (!groups.includes(id)) return null;
    if (!segments(event).some(part => part.type === 'at' && String(part.data?.qq) === String(event.self_id))) return null;
  }
  return contentText(event) || (event.message_type === 'group' ? '有人 @ 你，向对方简短回应。' : null);
}
