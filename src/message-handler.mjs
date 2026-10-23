import { incomingText } from './persona.mjs';
import { replyTarget } from './access.mjs';
import { routeNatural } from './natural-chat.mjs';
import { deliverReply } from './reply-delivery.mjs';
import { reportDeliveryIssue } from './delivery-issues.mjs';

export const MESSAGE_BATCH_WINDOW_MS = 300;
export const MESSAGE_BATCH_MAX_WAIT_MS = 1200;
const MAX_BATCH_MESSAGES = 8, MAX_BATCH_TEXT = 6000, MAX_PENDING_TURNS = 8;
const interruption = () => Object.assign(new Error('本轮已被新消息接续。'), { code: 'CHAT_SUPERSEDED' });
const batchable = text => !text.trimStart().startsWith('/');
const sameSender = (a, b) => String(a.event.user_id) === String(b.event.user_id) && String(a.event.self_id) === String(b.event.self_id);
const canMerge = (job, input) => job.inputs.every(row => batchable(row.text) && row.signature === input.signature) && batchable(input.text) && sameSender(job.inputs.at(-1), input) &&
  job.inputs.length < MAX_BATCH_MESSAGES && job.inputs.reduce((total, row) => total + row.text.length + 1, 0) + input.text.length <= MAX_BATCH_TEXT;

export function createMessageHandler({ bot, groups, memory, getDependencies, batchWindowMs = MESSAGE_BATCH_WINDOW_MS, maxBatchWaitMs = MESSAGE_BATCH_MAX_WAIT_MS, memberWaitMs = 150, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), ...deps }) {
  const queues = new Map(), seen = new Set();
  const metrics = { mergedMessages: 0, interruptedTurns: 0, lastReply: null };
  const current = event => getDependencies ? getDependencies(event) : { ...deps, groups };
  const permitted = (event, active) => {
    const live = current(event);
    return live.enabled !== false && !!incomingText(event, live.groups) && active.owner === live.owner && active.transportVersion === live.transportVersion && active.capabilities === live.capabilities;
  };
  const run = async job => {
    const last = job.inputs.at(-1), active = current(last.event);
    if (active.enabled === false || job.inputs.some(row => current(row.event).enabled === false || !incomingText(row.event, current(row.event).groups))) return;
    const event = { ...last.event, message: job.inputs.flatMap(row => Array.isArray(row.event.message) ? row.event.message : [{ type: 'text', data: { text: row.text } }]) };
    const text = job.inputs.map(row => row.text).join('\n'), target = replyTarget(event), memoryVersion = memory.version;
    const options = event.message_type === 'group' ? { replyTo: event.message_id, mention: event.user_id } : undefined;
    const isCurrent = () => !job.controller.signal.aborted && permitted(event, active);
    for (const input of job.inputs) if (!input.remembered && active.memoryMode !== 'normal') { memory.add(input.event, input.text); input.remembered = true; }
    const deliveries = [];
    const deliver = async response => {
      if (!isCurrent()) return;
      job.dispatched = true;
      const result = await deliverReply(response, { bot, target, options: deliveries.length ? undefined : options, isCurrent, signal: job.controller.signal, now });
      deliveries.push(result);
      if (result.stopped && !job.controller.signal.aborted) throw Object.assign(new Error('QQ 回复未完成。'), { code: 'REPLY_SEND_FAILED' });
    };
    try {
      if (active.members?.prepare) {
        let timer;
        try {
          await Promise.race([
            Promise.resolve().then(() => active.members.prepare(event)).catch(error => reportDeliveryIssue('member_directory_unavailable', error)),
            new Promise(resolve => { timer = setTimeout(resolve, memberWaitMs); }),
          ]);
        } finally { clearTimeout(timer); }
      }
      if (!isCurrent()) return;
      let response;
      try {
        response = await routeNatural(text, event, { ...active, memory: active.memoryMode === 'normal' ? null : memory,
          groupBackground: memory.version === last.capturedVersion ? last.groupBackground : [], signal: job.controller.signal,
          onPhase: phase => { job.phase = phase; }, onReplyText: async first => { if (!isCurrent()) return false; await deliver(first); return true; } });
      } catch (error) {
        if (job.dispatched) job.incomplete = true;
        if (!isCurrent() || error.code === 'REPLY_SEND_FAILED') return;
        if (['REPLY_MEDIA_PREPARE', 'REPLY_PLAN_INVALID'].includes(error.code)) { reportDeliveryIssue(error.code === 'REPLY_PLAN_INVALID' ? 'reply_plan_invalid' : 'media_prepare_failed', error); return; }
        if (job.dispatched) { reportDeliveryIssue('reply_incomplete', error); return; }
        response = event.message_type !== 'private' || String(event.user_id) !== active.owner ? '我这次没连上，稍后再问我一下。' :
          error instanceof TypeError || error.name === 'TimeoutError' ? '网络请求失败或超时，请检查服务连接。' : error.message;
      }
      if (!isCurrent()) return;
      job.phase = 'delivering';
      if (!Array.isArray(response?.messages) || response.messages.length) await deliver(response);
    } finally {
      const firstReceipt = deliveries.find(row => row.firstSentAt != null)?.firstSentAt;
      metrics.lastReply = { inputMessages: job.inputs.length, sentMessages: deliveries.reduce((total, row) => total + row.sent.length, 0),
        firstReceiptMs: firstReceipt == null ? null : Math.max(0, firstReceipt - job.inputs[0].receivedAt),
        elapsedMs: Math.max(0, now() - job.inputs[0].receivedAt), interrupted: job.controller.signal.aborted };
      let summary = deliveries.map(row => row.summary).filter(Boolean).join('\n');
      if (summary && (job.controller.signal.aborted || job.incomplete) && !summary.includes('[后续消息未发送]')) summary += '\n[后续消息未发送]';
      if (summary && current(event).memoryMode !== 'normal' && memory.version === memoryVersion && permitted(event, active)) {
        const receipt = deliveries.flatMap(row => row.sent)[0]?.message_id ?? '';
        memory.add({ ...event, message_id: receipt, inReplyTo: event.message_id, message: [], time: now() / 1000 }, summary, true);
      }
    }
  };
  const drain = async (conversation, queue) => {
    try {
      while (queue.pending.length) {
        const next = queue.pending[0];
        // Only follow-ups wait briefly. An idle conversation starts immediately.
        while (now() < next.readyAt) await wait(Math.min(100, next.readyAt - now()));
        queue.pending.shift(); queue.active = next;
        try { await run(next); }
        catch (error) { if (error.code !== 'REPLY_SEND_FAILED') reportDeliveryIssue('reply_incomplete', error); }
        finally { for (const resolve of next.waiters) resolve(); queue.active = null; }
        if (next.overflow && permitted(next.overflow.event, next.overflow.active)) {
          try { await bot.send(replyTarget(next.overflow.event), '消息较多，已保留前面的请求；请等回复后再继续。'); }
          catch (error) { reportDeliveryIssue('text_send_failed', error); }
        }
      }
    } finally { if (queues.get(conversation) === queue) queues.delete(conversation); }
  };
  const handler = async event => {
    if (event.post_type !== 'message' || !['group', 'private'].includes(event.message_type) || String(event.user_id) === String(event.self_id)) return;
    const active = current(event);
    // The observer owns its bounded queue; slow alert processing never delays chat.
    try { if (active.observeEnabled !== false) Promise.resolve(active.observe?.(event)).catch(() => {}); } catch {}
    if (active.enabled === false || event.message_type === 'group' && !active.groups.includes(String(event.group_id))) return;
    const text = incomingText(event, active.groups), key = `${event.self_id}:${memory.key(event)}:${event.message_id}`;
    if (event.message_id != null) {
      if (seen.has(key)) return;
      seen.add(key); if (seen.size > 1000) seen.delete(seen.values().next().value);
    }
    active.members?.observe(event);
    if (active.memoryMode !== 'normal') memory.observe(event);
    active.learn?.(event);
    if (!text) return;
    const input = { event, text, receivedAt: now(), capturedVersion: memory.version, signature: JSON.stringify([active.owner, active.transportVersion, active.capabilities, memory.version]), groupBackground: active.memoryMode === 'normal' ? [] : memory.background(event) };
    const conversation = memory.key(event);
    let queue = queues.get(conversation);
    const fresh = !queue;
    if (!queue) { queue = { active: null, pending: [] }; queues.set(conversation, queue); }
    const done = new Promise(resolve => {
      const tail = queue.pending.at(-1), running = queue.active;
      if (tail && canMerge(tail, input)) {
        metrics.mergedMessages++;
        tail.inputs.push(input); tail.waiters.push(resolve); tail.readyAt = Math.min(now() + batchWindowMs, tail.createdAt + maxBatchWaitMs); return;
      }
      const job = { inputs: [input], waiters: [resolve], controller: new AbortController(), phase: 'preparing', dispatched: false, createdAt: now(), readyAt: fresh || !batchable(text) ? now() : now() + batchWindowMs };
      if (!queue.pending.length && running && ['preparing', 'generating', 'delivering'].includes(running.phase) && canMerge(running, input)) {
        if (!running.dispatched) { job.inputs.unshift(...running.inputs); job.waiters.unshift(...running.waiters); running.waiters = []; metrics.mergedMessages++; }
        metrics.interruptedTurns++;
        running.controller.abort(interruption());
      }
      if (queue.pending.length >= MAX_PENDING_TURNS) {
        // One bounded feedback turn, in queue order. Never interleave a busy
        // notice with an in-flight answer or send a notice for every keypress.
        if (!tail.overflow) tail.overflow = { event, active };
        resolve(); return;
      }
      queue.pending.push(job);
    });
    if (fresh) void drain(conversation, queue);
    await done;
  };
  handler.isBusy = () => queues.size > 0;
  handler.status = () => ({ activeConversations: queues.size, queuedTurns: [...queues.values()].reduce((total, row) => total + row.pending.length, 0), ...structuredClone(metrics) });
  return handler;
}
