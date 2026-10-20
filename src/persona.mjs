import { readJSON } from './core.mjs';
import { createHash } from 'node:crypto';
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
  constructor(limit = 16) { this.limit = limit; this.ttl = 3600000; this.enabled = true; this.groupContext = true; this.groupContextLimit = 24; this.sessions = new Map(); this.version = 0; }
  configure({ recentLimit, ttlMinutes, enabled, groupContext = true, groupContextLimit = 24 }) {
    if (this.groupContext !== groupContext) this.version++;
    this.limit = recentLimit; this.ttl = ttlMinutes * 60000; this.enabled = enabled; this.groupContext = groupContext; this.groupContextLimit = groupContextLimit;
    if (!enabled) { this.clear('all'); return; }
    for (const session of this.sessions.values()) { session.entries = session.entries.slice(-this.limit); session.background = groupContext ? session.background.slice(-groupContextLimit) : []; }
  }
  key(event) { return event.message_type === 'group' ? `group:${event.group_id}` : `private:${event.user_id}`; }
  describe(event, assistant = false) {
    const id = String(event.user_id ?? event.sender?.user_id ?? 'unknown');
    return { speaker: assistant || id === String(event.self_id) ? '机器人' : event.message_type === 'group' ? '群友-' + createHash('sha256').update(this.key(event) + ':' + id).digest('hex').slice(0, 10) : '用户',
      senderName: assistant ? '' : String(event.sender?.card || event.sender?.nickname || '').replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 60),
      messageId: String(event.message_id ?? '').slice(0, 40), replyTo: String(event.inReplyTo ?? segments(event).find(part => part.type === 'reply')?.data?.id ?? '').slice(0, 40),
      time: Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? new Date(Math.min(Number(event.time) * 1000, 8640000000000000)).toISOString() : new Date().toISOString() };
  }
  session(event) {
    const now = Date.now();
    this.prune();
    const key = this.key(event);
    if (!this.sessions.has(key)) this.sessions.set(key, { entries: [], background: [], touched: now });
    if (this.sessions.size > 100) this.sessions.delete(this.sessions.keys().next().value);
    return this.sessions.get(key);
  }
  prune() {
    const now = Date.now();
    for (const [key, value] of this.sessions) {
      if (now - value.touched > this.ttl) this.sessions.delete(key);
      else { value.background = value.background.filter(row => now - row.observedAt <= Math.min(this.ttl, 15 * 60000)); value.entries = value.entries.filter(row => now - row.recordedAt <= this.ttl); }
    }
  }
  observe(event) {
    if (!this.enabled || !this.groupContext || event.message_type !== 'group') return;
    const session = this.session(event), row = { ...this.describe(event), text: contentText(event).slice(0, 240), observedAt: Date.now() };
    if (row.messageId && session.background.some(item => item.messageId === row.messageId)) return;
    session.background.push(row); session.background = session.background.slice(-this.groupContextLimit); session.touched = Date.now();
  }
  background(event) {
    if (!this.enabled || !this.groupContext) return [];
    this.prune();
    const session = this.sessions.get(this.key(event));
    const rows = (session?.background || []).filter(row => row.messageId !== String(event.message_id ?? '')).slice(-this.groupContextLimit);
    let size = 0; const result = [];
    for (const row of rows.toReversed()) { size += JSON.stringify(row).length; if (size > 10000) break; result.unshift(row); }
    return structuredClone(result);
  }
  add(event, text, assistant = false) {
    if (!this.enabled) return;
    const key = this.key(event);
    const session = this.session(event);
    session.entries.push({ ...this.describe(event, assistant), text: String(text).slice(0, 1500), recordedAt: Date.now() });
    session.entries = session.entries.slice(-this.limit); session.touched = Date.now(); this.sessions.set(key, session);
  }
  get(event) { this.prune(); return this.enabled ? this.sessions.get(this.key(event))?.entries || [] : []; }
  list() { this.prune(); return [...this.sessions].map(([scope, session]) => ({ scope, touched: session.touched, entries: session.entries, background: session.background })); }
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
