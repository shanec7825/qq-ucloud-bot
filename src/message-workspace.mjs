import { readJSON, saveJSON } from './core.mjs';
import { serializeFile } from './digest-repository.mjs';
import { createHash } from 'node:crypto';
import { calendarExport } from './calendar-export.mjs';

const statuses = ['pending', 'done', 'archived'];
function project(report, origin) {
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
          id, origin, reportId: report.id, itemId: item.id, groupId: report.groupId,
          groupName: report.groupName, title: item.title, summary: item.summary, priority: item.priority,
          deadlineText: item.deadlineText || '', sources: structuredClone(item.sources || []), createdAt: report.createdAt, outputFormat: report.outputFormat || 'concise',
        };
      });
}
export class MessageWorkspace {
  constructor({ monitor, root = new URL('../data/notices/', import.meta.url), now = Date.now }) { this.monitor = monitor; this.root = root; this.now = now; }
  file() { return new URL('todo-items.json', this.root); }
  notificationFile() { return new URL('live-notifications.json', this.root); }
  async sourceItems() {
    const [live, reports] = await Promise.all([readJSON(this.notificationFile(), []), this.monitor.reports()]);
    return [...live.slice(0, 100).flatMap(report => project(report, 'live')), ...reports.slice(0, 100).flatMap(report => project(report, 'digest'))];
  }
  recordNotifications(batch) {
    if (!batch || typeof batch.id !== 'string' || !/^[a-f0-9]{32}$/.test(batch.id) || typeof batch.groupId !== 'string' || !Array.isArray(batch.items) || batch.items.length > 15) throw new Error('本地通知格式无效。');
    return serializeFile(this.notificationFile(), async () => {
      const reports = await readJSON(this.notificationFile(), []);
      if (reports.some(report => report.id === batch.id)) return { added: 0 };
      const report = { id: batch.id, groupId: batch.groupId, groupName: String(batch.groupName || '群 ' + batch.groupId).slice(0, 80), accountIds: (batch.accountIds || []).slice(0, 20), createdAt: batch.createdAt, outputFormat: batch.outputFormat || 'concise', items: structuredClone(batch.items) };
      await saveJSON(this.notificationFile(), [report, ...reports].slice(0, 100)); return { added: report.items.length };
    });
  }
  async storedTodos() {
    const saved = await readJSON(this.file(), null);
    if (saved) return Array.isArray(saved.items) ? saved.items : [];
    // Preserve deliberate status edits without promoting every old report to a task.
    const legacy = await readJSON(new URL('inbox-state.json', this.root), {}), sources = await this.sourceItems();
    return sources.filter(item => statuses.includes(legacy[item.id]?.status)).map(item => ({ ...item, status: legacy[item.id].status, addedAt: legacy[item.id].updatedAt || item.createdAt }));
  }
  async list() {
    return serializeFile(this.file(), async () => {
      const items = await this.storedTodos(), counts = { pending: 0, done: 0, archived: 0 };
      if (items.length && !await readJSON(this.file(), null)) await saveJSON(this.file(), { version: 1, items });
      for (const item of items) if (statuses.includes(item.status)) counts[item.status]++;
      return { items: structuredClone(items), counts };
    });
  }
  async notifications() {
    const [sources, todos] = await Promise.all([this.sourceItems(), this.storedTodos()]);
    const added = new Set(todos.map(item => item.id)), items = sources.filter(item => item.origin === 'live').map(item => ({ ...item, inTodo: added.has(item.id) })), groups = new Map();
    for (const item of items) { if (!groups.has(item.groupId)) groups.set(item.groupId, { groupId: item.groupId, groupName: item.groupName || '群 ' + item.groupId, items: [] }); groups.get(item.groupId).items.push(item); }
    return { items, groups: [...groups.values()], digestItems: sources.filter(item => item.origin === 'digest').map(item => ({ ...item, inTodo: added.has(item.id) })), counts: { notifications: items.length, groups: groups.size } };
  }
  addTodo(id) {
    if (typeof id !== 'string' || id.length > 256) throw new Error('通知身份无效。');
    return serializeFile(this.file(), async () => {
      const existing = await this.storedTodos(), old = existing.find(item => item.id === id);
      if (old) return { ...old, alreadyAdded: true };
      const item = (await this.sourceItems()).find(item => item.id === id);
      if (!item) throw new Error('通知已不存在，请刷新。');
      if (existing.length >= 1000) throw new Error('待办已达 1000 条，请先清理本地数据。');
      const next = { ...item, status: 'pending', addedAt: new Date(this.now()).toISOString() };
      await saveJSON(this.file(), { version: 1, items: [next, ...existing] }); return next;
    });
  }
  setStatus(id, status) {
    if (typeof id !== 'string' || id.length > 256 || !statuses.includes(status)) throw new Error('事项身份或状态无效。');
    return serializeFile(this.file(), async () => {
      const items = await this.storedTodos(), item = items.find(item => item.id === id);
      if (!item) throw new Error('待办已不存在，请先从通知加入。');
      item.status = status; item.updatedAt = new Date(this.now()).toISOString();
      await saveJSON(this.file(), { version: 1, items }); return structuredClone(item);
    });
  }
  async calendarPreview(id, options) {
    const item = (await this.storedTodos()).find(item => item.id === id);
    if (!item) throw new Error('请先将通知加入待办。');
    return calendarExport(item, options, this.now());
  }
}
