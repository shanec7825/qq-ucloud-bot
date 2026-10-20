import { randomUUID } from 'node:crypto';
import { readJSON, saveJSON } from './core.mjs';

export function memoryScope(value) {
  if (value !== 'global' && !/^(group|private):\d{5,15}$/.test(value || '')) throw new Error('记忆范围无效。');
  return value;
}
export class ManagedMemory {
  constructor(root = new URL('../data/', import.meta.url)) { this.root = root; this.queue = Promise.resolve(); }
  file() { return new URL('memory-notes.json', this.root); }
  async list() { return readJSON(this.file(), []); }
  context(event) {
    const scope = `${event.message_type === 'group' ? 'group' : 'private'}:${event.message_type === 'group' ? event.group_id : event.user_id}`;
    return this.list().then(notes => {
      let budget = 6000;
      return notes.filter(note => note.scope === 'global' || note.scope === scope).slice(-20).reverse().flatMap(({ scope, text }) => { const value = text.slice(0, budget); budget -= value.length; return value ? [{ scope, text: value }] : []; }).reverse();
    });
  }
  mutate(action) { const work = this.queue.catch(() => {}).then(action); this.queue = work; return work; }
  put(input) {
    return this.mutate(async () => {
      if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new Error('记忆内容应为 1–2000 字。');
      memoryScope(input.scope);
      const notes = await this.list(); const index = input.id ? notes.findIndex(note => note.id === input.id) : -1;
      if (input.id && index < 0) throw new Error('记忆已不存在，请刷新。');
      if (!input.id && notes.length >= 200) throw new Error('最多保存 200 条记忆。');
      const note = { id: input.id || randomUUID(), scope: input.scope, text: input.text.trim(), updatedAt: new Date().toISOString() };
      if (index < 0) notes.push(note); else notes[index] = note;
      await saveJSON(this.file(), notes); return note;
    });
  }
  remove(id) { return this.mutate(async () => { const notes = await this.list(); await saveJSON(this.file(), notes.filter(note => note.id !== id)); }); }
  digestFile(groupId) { if (!/^\d{5,15}$/.test(groupId || '')) throw new Error('群号无效。'); return new URL(`history/${groupId}/digest.json`, this.root); }
  async digest(groupId) { return readJSON(this.digestFile(groupId), null); }
  saveDigest(groupId, summary) {
    if (typeof summary !== 'string' || summary.length > 1000) throw new Error('摘要最多 1000 字。');
    return this.mutate(async () => { const old = await this.digest(groupId); await saveJSON(this.digestFile(groupId), { ...old, groupId, summary, updatedAt: new Date().toISOString(), editedByOwner: true }); });
  }
}
