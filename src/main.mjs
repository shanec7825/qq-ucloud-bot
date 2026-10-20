import { setTimeout as delay } from 'node:timers/promises';
import { SchoolClient, readJSON, saveJSON, formatTasks, notificationPlan, askAI } from './core.mjs';
import { OneBot } from './onebot.mjs';
import { PublicCatalog, upcoming } from './access.mjs';
import { PrivateResources } from './resources.mjs';
import { askCodex } from './codex-ai.mjs';
import { ConversationMemory, loadPersona } from './persona.mjs';
import { createMessageHandler } from './message-handler.mjs';
import { SharedLibrary } from './shared-library.mjs';
import { MessageMedia } from './message-media.mjs';
import { HistoryDigest } from './history-digest.mjs';

const sessionFile = new URL('../data/session.json', import.meta.url);
const stateFile = new URL('../data/state.json', import.meta.url);
const school = new SchoolClient(sessionFile);
const catalog = new PublicCatalog(new URL('../data/public-assignments.json', import.meta.url), new URL('../public/books.json', import.meta.url));
const resources = new PrivateResources();
const library = new SharedLibrary(process.env.SHARED_PDFS_ROOT);
const memory = new ConversationMemory();

async function main() {
  if (process.argv.includes('--demo')) {
    console.log(formatTasks([{ id: '1234567890123456789', title: '示例作业（模拟数据）', course: '计算机网络', type: 3, deadline: '2026-10-20 23:59:00' }]));
    return;
  }
  if (process.argv.includes('--check')) { await catalog.refresh(school); console.log(await catalog.list()); return; }
  if (process.argv.includes('--ai-check')) { console.log(await askCodex('请仅回复：连接成功', {})); return; }
  const owner = process.env.OWNER_QQ?.trim();
  if (!/^\d{5,15}$/.test(owner || '')) throw new Error('请在 .env 中填写 OWNER_QQ。');
  if (!process.env.ONEBOT_ACCESS_TOKEN) throw new Error('请设置 ONEBOT_ACCESS_TOKEN，并在 NapCat 中配置相同 token。');
  const groups = (process.env.ALLOWED_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean);
  const seconds = Number(process.env.POLL_SECONDS || 900);
  if (!Number.isFinite(seconds) || seconds < 60) throw new Error('POLL_SECONDS 应为不小于 60 的数字。');
  let state = await readJSON(stateFile, { initialized: false, known: [], sent: {} });
  if (!Array.isArray(state.known) || !state.sent || typeof state.sent !== 'object') throw new Error('data/state.json 格式错误。');
  const ai = (question, context) => process.env.AI_BACKEND === 'api' ? askAI(question, context, process.env) : askCodex(question, context);
  const history = new HistoryDigest({ ai: (question, context) => askCodex(question, context) });
  const historyGroups = (process.env.GROUP_HISTORY_MODEL_GROUPS || '').split(',').filter(id => groups.includes(id));
  const bot = new OneBot(process.env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001', process.env.ONEBOT_ACCESS_TOKEN, () => {});
  const handler = createMessageHandler({ bot, groups, owner, school, catalog, resources, ai, library, history, media: new MessageMedia(bot), memory, persona: loadPersona, shareDocumentsWithModel: process.env.SHARED_DOCUMENTS_TO_MODEL === 'true' });
  bot.onEvent = handler;
  let stopped = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; bot.close(); });
  bot.connect();
  console.log(`${process.env.BOT_NAME || 'slyra'} 已启动；群里必须 @，模型：${process.env.CODEX_MODEL || 'gpt-6-luna'}。`);
  while (!stopped) {
    try {
      const tasks = upcoming(await catalog.refresh(school));
      const notices = notificationPlan(tasks, state).filter(notice => notice.key.startsWith('due:'));
      for (const notice of notices) {
        // 等协议端确认发送成功后才落盘；失败保留下一轮重试机会。
        await bot.send({ user_id: owner }, notice.text);
        state.sent[notice.key] = true;
        await saveJSON(stateFile, state);
      }
      state.initialized = true;
      state.known = [...new Set([...state.known, ...tasks.map(t => t.id)])];
      await saveJSON(stateFile, state);
    } catch { console.error('定时检查未完成，将在下次轮询重试；检查学校登录态、QQ 连接和 data 目录权限。'); }
    if (process.env.HISTORY_DIGEST_ENABLED === 'true' && !handler.isBusy()) {
      try { for (const result of await history.tick(historyGroups)) if (result.status !== 'not_due') console.log(`历史归纳：${result.status}；本轮模型调用 ${result.modelCalls} 次。`); }
      catch { console.error('历史导出归纳暂未完成，群聊和作业查询继续运行。'); }
    }
    // 短等待确保 Ctrl+C 可及时退出。
    for (let i = 0; i < seconds && !stopped; i++) await delay(1000);
  }
}

main().catch(error => { console.error(error instanceof TypeError ? '网络请求失败，请检查连接。' : error.message); process.exitCode = 1; });
