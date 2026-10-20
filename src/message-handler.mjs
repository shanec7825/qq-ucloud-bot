import { incomingText } from './persona.mjs';
import { replyTarget } from './access.mjs';
import { routeNatural } from './natural-chat.mjs';

export function createMessageHandler({ bot, groups, memory, getDependencies, ...deps }) {
  const queues = new Map(), seen = new Set();
  const handler = async event => {
    const current = () => getDependencies ? getDependencies() : { ...deps, groups };
    const text = incomingText(event, current().groups);
    // No mention: no memory update, downloads, history lookup or AI invocation.
    if (!text) return;
    const key = `${event.message_type}:${event.message_id}`;
    if (seen.has(key)) return;
    seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value);
    const target = replyTarget(event), conversation = memory.key(event);
    const previous = queues.get(conversation);
    if ((previous?.count || 0) >= 8) { await bot.send(target, '我还在处理前面的消息，稍等一下再 @ 我。'); return; }
    const work = (previous?.promise || Promise.resolve()).catch(() => {}).then(async () => {
      const active = current();
      if (!incomingText(event, active.groups)) return;
      const memoryVersion = memory.version;
      memory.add(event, text);
      let response;
      try { response = await routeNatural(text, event, { ...active, memory }); }
      catch (error) {
        response = event.message_type !== 'private' || String(event.user_id) !== active.owner ? '我这次没连上，稍后再问我一下。' :
          error instanceof TypeError || error.name === 'TimeoutError' ? '网络请求失败或超时，请检查服务连接。' : error.message;
      }
      if (!incomingText(event, current().groups) || active.owner !== current().owner || active.transportVersion !== current().transportVersion) return;
      await bot.send(target, response);
      if (memory.version === memoryVersion) memory.add(event, response, true);
    });
    const entry = { promise: work, count: (previous?.count || 0) + 1 };
    queues.set(conversation, entry);
    try { await work; }
    finally { const current = queues.get(conversation); if (current === entry) queues.delete(conversation); else if (current) current.count--; }
  };
  handler.isBusy = () => queues.size > 0;
  return handler;
}
