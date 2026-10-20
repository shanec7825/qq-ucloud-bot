import { segments } from './message-content.mjs';

const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) : '';
const validId = value => /^\d{5,15}$/.test(String(value));

// Names are group-local transport metadata. Never infer a real identity from a nickname.
export class GroupMembers {
  constructor(bot, allowed, now = Date.now) { this.bot = bot; this.allowed = allowed; this.now = now; this.groups = new Map(); this.generation = 0; }
  accepts(event) { return event.message_type === 'group' && this.allowed().includes(String(event.group_id)); }
  entry(event) {
    const id = String(event.group_id);
    if (!this.groups.has(id)) this.groups.set(id, { members: new Map(), refreshedAt: 0, retryAt: 0, groupName: '', complete: false });
    if (this.groups.size > 100) this.groups.delete(this.groups.keys().next().value);
    return this.groups.get(id);
  }
  observe(event) {
    if (!this.accepts(event) || !validId(event.user_id)) return;
    const entry = this.entry(event), id = String(event.user_id), previous = entry.members.get(id) || {};
    const member = { ...previous, user_id: id };
    for (const key of ['card', 'nickname']) if (clean(event.sender?.[key])) member[key] = clean(event.sender[key]);
    if (member.card || member.nickname) entry.members.set(id, member);
    if (entry.members.size > 2048) entry.members.delete(entry.members.keys().next().value);
    if (event.group_name) entry.groupName = clean(event.group_name);
  }
  async prepare(event) {
    if (!this.accepts(event)) return;
    const entry = this.entry(event), now = this.now();
    if (entry.pending) return entry.pending;
    if (now < entry.retryAt || entry.complete && now - entry.refreshedAt < 5 * 60000) return;
    const generation = this.generation;
    entry.pending = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.bot.call('get_group_member_list', { group_id: String(event.group_id), no_cache: true })),
        Promise.resolve().then(() => this.bot.call('get_group_info', { group_id: String(event.group_id), no_cache: true })),
      ]);
      if (!this.accepts(event) || generation !== this.generation) return;
      const [members, info] = results;
      if (members.status === 'fulfilled' && Array.isArray(members.value)) {
        const rows = members.value.filter(row => validId(row.user_id) && (row.group_id == null || String(row.group_id) === String(event.group_id)));
        entry.members = new Map(rows.slice(0, 2048).map(row => [String(row.user_id), { user_id: String(row.user_id), card: clean(row.card), nickname: clean(row.nickname) }]));
        entry.total = rows.length; entry.complete = true; entry.refreshedAt = this.now();
      } else { entry.complete = false; entry.retryAt = this.now() + 60000; }
      if (info.status === 'fulfilled' && String(info.value?.group_id) === String(event.group_id)) entry.groupName = clean(info.value.group_name);
      this.observe(event);
    })().finally(() => { entry.pending = null; });
    return entry.pending;
  }
  describe(event, memory) {
    if (!this.accepts(event)) return memory?.describe?.(event) || {};
    const id = String(event.user_id ?? event.sender?.user_id ?? ''), cached = this.groups.get(String(event.group_id))?.members.get(id) || {};
    const sender = { ...cached };
    for (const key of ['card', 'nickname']) if (clean(event.sender?.[key])) sender[key] = clean(event.sender[key]);
    return { ...(memory?.describe?.({ ...event, user_id: id, sender }) || {}), senderName: clean(sender.card) || clean(sender.nickname), card: clean(sender.card), nickname: clean(sender.nickname) };
  }
  context(event, question, memory) {
    if (!this.accepts(event)) return null;
    const entry = this.groups.get(String(event.group_id));
    if (!entry) return null;
    const ids = [String(event.user_id), ...segments(event).filter(part => part.type === 'at').map(part => String(part.data?.qq))];
    const names = [...entry.members.values()].filter(row => [row.card, row.nickname].some(name => name?.length >= 2 && question.includes(name)));
    // Keep the full roster on this machine. Only identify people involved in this question.
    const selected = [...new Set([...ids, ...names.map(row => row.user_id)])].filter(id => entry.members.has(id)).slice(0, 16);
    return { groupName: entry.groupName, members: selected.map(id => { const { speaker, senderName, card, nickname } = this.describe({ ...event, user_id: id, sender: {} }, memory); return { speaker, senderName, card, nickname }; }),
      total: Math.max(entry.total ?? 0, entry.members.size), complete: entry.complete && entry.members.size === selected.length,
      note: '只提供当前发言者和问题中明确 @、点名的成员，不是全员名册。群名片和 QQ 昵称可能同名或变更，不代表真实姓名；未经确认不要猜绰号对应。' };
  }
  clear() { this.generation++; this.groups.clear(); }
  retain() { this.generation++; for (const id of this.groups.keys()) if (!this.allowed().includes(id)) this.groups.delete(id); }
}
