import { randomUUID } from 'node:crypto';
import { readJSON, saveJSON } from './core.mjs';
import { DigestRepository, serializeFile } from './digest-repository.mjs';

export function memoryScope(value) {
  if (value !== 'global' && !/^(group|private):\d{5,15}$/.test(value || '') && !/^profile:[A-Za-z0-9_-]{1,40}$/.test(value || '')) throw new Error('记忆范围无效。');
  return value;
}
const kinds = ['fact', 'preference', 'instruction'];
function normalize(note) {
  return { ...note, kind: note.kind ?? 'fact', tags: note.tags ?? [], enabled: note.enabled ?? true,
    source: note.source ?? { type: 'owner' } };
}
export class ManagedMemory {
  constructor(root = new URL('../data/', import.meta.url)) { this.root = root; this.digests = new DigestRepository(new URL('history/', root)); }
  file() { return new URL('memory-notes.json', this.root); }
  async list() { return (await readJSON(this.file(), [])).map(normalize); }
  context(event, { profileId } = {}) {
    const scope = `${event.message_type === 'group' ? 'group' : 'private'}:${event.message_type === 'group' ? event.group_id : event.user_id}`;
    const profileScope = /^[A-Za-z0-9_-]{1,40}$/.test(profileId || '') ? `profile:${profileId}` : null;
    return this.list().then(notes => {
      let budget = 6000;
      return notes.filter(note => note.enabled === true && (note.scope === 'global' || note.scope === scope || (profileScope && note.scope === profileScope))).slice(-20).reverse().flatMap(({ scope, text }) => { const value = text.slice(0, budget); budget -= value.length; return value ? [{ scope, text: value }] : []; }).reverse();
    });
  }
  mutate(action) { return serializeFile(this.file(), action); }
  put(input) {
    return this.mutate(async () => {
      if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new Error('记忆内容应为 1–2000 字。');
      memoryScope(input.scope);
      if (input.kind !== undefined && !kinds.includes(input.kind)) throw new Error('记忆类型无效。');
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('记忆启停值无效。');
      if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 30))) throw new Error('标签最多 10 个，每个 1–30 字。');
      const notes = await this.list(); const index = input.id ? notes.findIndex(note => note.id === input.id) : -1;
      if (input.id && index < 0) throw new Error('记忆已不存在，请刷新。');
      if (!input.id && notes.length >= 200) throw new Error('最多保存 200 条记忆。');
      const previous = index < 0 ? {} : notes[index];
      const note = normalize({ ...previous, id: input.id || randomUUID(), scope: input.scope, text: input.text.trim(),
        kind: input.kind ?? previous.kind ?? 'fact', tags: input.tags ? [...new Set(input.tags.map(tag => tag.trim()))] : previous.tags ?? [],
        enabled: input.enabled ?? previous.enabled ?? true, updatedAt: new Date().toISOString() });
      if (index < 0) notes.push(note); else notes[index] = note;
      await saveJSON(this.file(), notes); return note;
    });
  }
  remove(id) { return this.mutate(async () => { const notes = await this.list(); await saveJSON(this.file(), notes.filter(note => note.id !== id)); }); }
  digestFile(groupId) { return this.digests.file(groupId); }
  digest(groupId) { return this.digests.read(groupId); }
  saveDigest(groupId, summary) { return this.digests.saveManual(groupId, summary); }
}
