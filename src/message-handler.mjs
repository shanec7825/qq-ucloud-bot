import { incomingText } from './persona.mjs';
import { replyTarget } from './access.mjs';
import { routeNatural } from './natural-chat.mjs';
import { deliverReply } from './reply-delivery.mjs';

export function createMessageHandler({ bot, groups, memory, getDependencies, ...deps }) {
  const queues = new Map(), seen = new Set();
  const handler = async event => {
    const current = () => getDependencies ? getDependencies(event) : { ...deps, groups };
    if (event.post_type !== 'message' || !['group', 'private'].includes(event.message_type) || String(event.user_id) === String(event.self_id)) return;
    // The observer owns its bounded queue; slow alert processing never delays chat.
    try { if (current().observeEnabled !== false) Promise.resolve(current().observe?.(event)).catch(() => {}); } catch {}
    if (current().enabled === false) return;
    if (event.message_type === 'group' && !current().groups.includes(String(event.group_id))) return;
    const text = incomingText(event, current().groups);
    const key = `${memory.key(event)}:${event.message_id}`;
    if (event.message_id != null) {
      if (seen.has(key)) return;
      seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value);
    }
    // Passive messages stay in a bounded RAM buffer. No media, tools or model calls.
    current().members?.observe(event);
    memory.observe(event);
    if (!text) return;
    const groupBackground = memory.background(event), capturedVersion = memory.version;
    const target = replyTarget(event), conversation = memory.key(event);
    const previous = queues.get(conversation);
    if ((previous?.count || 0) >= 8) { await bot.send(target, '我还在处理前面的消息，稍等一下再 @ 我。'); return; }
    const work = (previous?.promise || Promise.resolve()).catch(() => {}).then(async () => {
      const active = current();
      if (active.enabled === false || !incomingText(event, active.groups)) return;
      const memoryVersion = memory.version;
      memory.add(event, text);
      let response;
      try {
        await active.members?.prepare(event);
        if (current().enabled === false || !incomingText(event, current().groups) || active.transportVersion !== current().transportVersion || active.capabilities !== current().capabilities) return;
        response = await routeNatural(text, event, { ...active, memory, groupBackground: memory.version === capturedVersion ? groupBackground : [] });
      }
      catch (error) {
        response = event.message_type !== 'private' || String(event.user_id) !== active.owner ? '我这次没连上，稍后再问我一下。' :
          error instanceof TypeError || error.name === 'TimeoutError' ? '网络请求失败或超时，请检查服务连接。' : error.message;
      }
      if (current().enabled === false || !incomingText(event, current().groups) || active.owner !== current().owner || active.transportVersion !== current().transportVersion || active.capabilities !== current().capabilities) return;
      const options = event.message_type === 'group' ? { replyTo: event.message_id, mention: event.user_id } : undefined;
      const delivery = await deliverReply(response, { bot, target, options, isCurrent: () => current().enabled !== false && !!incomingText(event, current().groups) && active.owner === current().owner && active.capabilities === current().capabilities && active.transportVersion === current().transportVersion });
      if (memory.version === memoryVersion) memory.add({ ...event, message_id: delivery.sent[0]?.message_id ?? '', inReplyTo: event.message_id, message: [], time: Date.now() / 1000 }, delivery.summary, true);
    });
    const entry = { promise: work, count: (previous?.count || 0) + 1 };
    queues.set(conversation, entry);
    try { await work; }
    finally { const current = queues.get(conversation); if (current === entry) queues.delete(conversation); else if (current) current.count--; }
  };
  handler.isBusy = () => queues.size > 0;
  return handler;
}
