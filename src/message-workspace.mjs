import { readJSON, saveJSON } from './core.mjs';
import { serializeFile } from './digest-repository.mjs';
import { createHash } from 'node:crypto';

const statuses = ['pending', 'done', 'archived'];
export class MessageWorkspace {
  constructor({ monitor, root = new URL('../data/notices/', import.meta.url) }) { this.monitor = monitor; this.root = root; }
  file() { return new URL('inbox-state.json', this.root); }
  async sourceItems() {
    return (await this.monitor.reports()).slice(0, 100).flatMap(report => {
      const sourceItems = (report.items || []).slice(0, 15), occurrences = new Map();
      const counts = new Map();
      for (const item of sourceItems) counts.set(item.id, (counts.get(item.id) || 0) + 1);
      return sourceItems.map(item => {
        let id = `${report.id}:${item.id}`;
        if (counts.get(item.id) > 1) {
          // Source IDs identify evidence, so multiple tasks can legitimately share one.
          const content = JSON.stringify([item.title, item.summary, item.priority, item.deadlineText, item.sources]);
          const suffix = createHash('sha256').update(content).digest('hex');
          const key = `${id}:${suffix}`, occurrence = (occurrences.get(key) || 0) + 1;
          occurrences.set(key, occurrence);
          id = `${key}:${occurrence}`;
        }
        return {
          id, reportId: report.id, itemId: item.id, groupId: report.groupId,
          groupName: report.groupName, title: item.title, summary: item.summary, priority: item.priority,
          deadlineText: item.deadlineText || '', sources: structuredClone(item.sources || []), createdAt: report.createdAt,
          ...(report.delivery ? { delivery: report.delivery } : {}),
        };
      });
    });
  }
  async list() {
    const [items, state] = await Promise.all([this.sourceItems(), readJSON(this.file(), {})]);
    const counts = { pending: 0, done: 0, archived: 0 };
    for (const item of items) { item.status = statuses.includes(state[item.id]?.status) ? state[item.id].status : 'pending'; counts[item.status]++; }
    return { items, counts };
  }
  setStatus(id, status) {
    if (typeof id !== 'string' || id.length > 256 || !statuses.includes(status)) throw new Error('事项身份或状态无效。');
    return serializeFile(this.file(), async () => {
      const items = await this.sourceItems(), item = items.find(item => item.id === id);
      if (!item) throw new Error('事项已不存在，请刷新。');
      const old = await readJSON(this.file(), {}), next = {};
      // Bound the state to source reports still retained by the monitor.
      for (const source of items) if (statuses.includes(old[source.id]?.status)) next[source.id] = old[source.id];
      next[id] = { status, updatedAt: new Date().toISOString() };
      await saveJSON(this.file(), next);
      return { ...item, status };
    });
  }
}
