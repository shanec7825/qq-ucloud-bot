import { readJSON, saveJSON, deadlineMs, taskLine } from './core.mjs';

export const PRIVATE_ONLY = '这是私人功能，仅主人账号私聊可用。可使用 /作业、/详情 作业ID 或 /教材 查询公开资料。';
export const help = '我是 ' + (process.env.BOT_NAME || 'slyra') + '。群里 @ 我直接问就行，比如“最近什么作业快截止了”“教材怎么解释偏序关系”；也能发图片或表情包。私聊无需 @。个人笔记和私人项目只在主人私聊里查。';

export function upcoming(tasks, now = Date.now()) {
  return tasks.filter(task => deadlineMs(task.deadline) > now).sort((a, b) => deadlineMs(a.deadline) - deadlineMs(b.deadline)).slice(0, 20);
}

export function ownerPrivate(event, owner) {
  return event.message_type === 'private' && String(event.user_id) === owner;
}

export function replyTarget(event) {
  return event.message_type === 'group' ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) };
}

export class PublicCatalog {
  constructor(file, booksFile) { this.file = file; this.booksFile = booksFile; }
  async refresh(school) {
    const tasks = await school.publicAssignments();
    const details = {};
    // 所有详情成功后再替换，失败时保留上次完整快照，不混合半次结果。
    for (const task of tasks) details[task.id] = await school.publicDetail(task.id);
    await saveJSON(this.file, { updatedAt: new Date().toISOString(), tasks, details });
    return tasks;
  }
  async upcomingTasks() {
    const snapshot = await readJSON(this.file, null);
    return snapshot ? upcoming(snapshot.tasks) : [];
  }
  async list() {
    const snapshot = await readJSON(this.file, null);
    if (!snapshot) return '公开作业尚未同步，请等待主人登录教学云。';
    const tasks = upcoming(snapshot.tasks);
    return `最近截止作业（北京时间，最多 20 项）\n同步时间：${snapshot.updatedAt}\n\n` +
      (tasks.length ? tasks.map(taskLine).join('\n\n') : '目前没有已同步且尚未截止的作业。');
  }
  async detail(id) {
    if (!/^\d{1,30}$/.test(id)) return '请提供 /作业 列表中的作业 ID。';
    const snapshot = await readJSON(this.file, null);
    if (!snapshot || !snapshot.tasks.some(task => task.id === id)) return '该作业未列入公开作业。';
    const detail = snapshot.details[id];
    return `${detail.title}\n截止：${detail.deadline || '未提供'}\n\n${detail.content || '无文字说明'}\n\n快照时间：${snapshot.updatedAt}`;
  }
  async books() {
    const books = await readJSON(this.booksFile, []);
    if (!Array.isArray(books)) throw new Error('教材配置格式错误。');
    return books.length ? books.map(book => `${book.title}\n${book.url}`).join('\n\n') : '尚未添加公开教材。只有主人明确配置的教材链接才会出现在这里。';
  }
}

export async function routeCommand(command, event, deps) {
  // 公开分支只依赖独立快照；未授权消息无法到达学校、AI 或私人连接器。
  if (command === '/帮助') return help;
  if (command === '/作业') return deps.catalog.list();
  if (command.startsWith('/详情 ')) return deps.catalog.detail(command.slice(4).trim());
  if (command === '/教材') return deps.catalog.books();
  if (!ownerPrivate(event, deps.owner)) return PRIVATE_ONLY;
  if (command.startsWith('/AI ')) return deps.ai(command.slice(4).slice(0, 4000), { tasks: await deps.catalog.upcomingTasks() });
  if (command.startsWith('/网盘 ')) {
    const match = /^\/网盘 (列表|读取)(?:\s+([\s\S]+))?$/.exec(command);
    if (!match) return '用法：/网盘 列表 [目录] 或 /网盘 读取 文件路径';
    return deps.resources.drive(match[1], match[2] || '');
  }
  if (command === '/项目') return deps.resources.github();
  if (command.startsWith('/项目 ')) return deps.resources.github(command.slice(4));
  if (command.startsWith('/AI网盘 ') || command.startsWith('/AI项目 ')) {
    const [reference, ...questionParts] = command.slice(6).split('|');
    const question = questionParts.join('|').trim();
    if (!reference.trim() || !question) return '用法：/AI网盘 文件路径 | 问题 或 /AI项目 owner/repo 文件路径 | 问题';
    const content = command.startsWith('/AI网盘 ') ? await deps.resources.drive('读取', reference.trim()) : await deps.resources.github(reference.trim());
    return deps.ai(question.slice(0, 4000), { source: reference.trim(), content });
  }
  return help;
}
