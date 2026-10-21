import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, saveJSON } from './core.mjs';

// All writers of a digest share the same queue, including separate service instances.
const queues = new Map();
export function serializeFile(file, action) {
  const key = resolve(fileURLToPath(file)).toLowerCase();
  const work = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(key, work);
  work.finally(() => { if (queues.get(key) === work) queues.delete(key); }).catch(() => {});
  return work;
}

export class DigestRepository {
  constructor(root = new URL('../data/history/', import.meta.url)) { this.root = root; }
  file(groupId) {
    if (!/^\d{5,15}$/.test(groupId || '')) throw new Error('群号无效。');
    return new URL(`${groupId}/digest.json`, this.root);
  }
  async read(groupId) {
    const value = await readJSON(this.file(groupId), null);
    if (!value) return null;
    const manual = typeof value.manualSummary === 'string' ? value.manualSummary : value.editedByOwner === true ? value.summary : undefined;
    return { ...value, ...(manual !== undefined ? { manualSummary: manual } : {}), summary: manual ?? value.generatedSummary ?? value.summary ?? '' };
  }
  write(groupId, fields) {
    const file = this.file(groupId);
    return serializeFile(file, async () => {
      const old = await this.read(groupId);
      const next = { ...old, ...fields, groupId };
      next.summary = next.manualSummary ?? next.generatedSummary ?? next.summary ?? '';
      await saveJSON(file, next);
      return next;
    });
  }
  saveManual(groupId, summary) {
    if (typeof summary !== 'string' || summary.length > 1000) throw new Error('摘要最多 1000 字。');
    return this.write(groupId, { manualSummary: summary, editedByOwner: true, updatedAt: new Date().toISOString() });
  }
  saveGenerated(groupId, summary, metadata = {}) {
    if (typeof summary !== 'string' || !summary.trim() || summary.length > 1000) throw new Error('历史摘要格式错误');
    return this.write(groupId, { ...metadata, generatedSummary: summary, generatedAt: metadata.updatedAt || new Date().toISOString() });
  }
}
