export const MAX_REPLY_MESSAGES = 4;
export const MAX_REPLY_TEXT = 1500;

// A logical reply owns the conversation queue until every bubble has a receipt.
export async function deliverReply(response, { bot, target, options, isCurrent = () => true }) {
  const rich = response && typeof response === 'object';
  const messages = rich && Array.isArray(response.messages) ? response.messages : [rich ? response : { text: response }];
  if (!messages.length || messages.length > MAX_REPLY_MESSAGES) throw new Error('回复消息数量无效。');
  const sent = [], remembered = []; let hasSent = false, stopped = false;
  const notice = async text => {
    if (!isCurrent()) return;
    try { await bot.send(target, text, hasSent ? undefined : options); }
    catch { console.error('QQ 回复投递失败，后续消息已停止。'); }
  };
  for (const message of messages) {
    if (!isCurrent()) { stopped = true; break; }
    let textSent = false;
    if (message.text) {
      try {
        const receipts = await bot.send(target, message.text, hasSent ? undefined : options);
        if (Array.isArray(receipts)) sent.push(...receipts);
        else if (receipts?.message_id !== undefined) sent.push(receipts);
        textSent = true; hasSent = true;
      }
      catch { await notice('本次消息发送未成功，后续消息已停止；请核对已收到的内容后再重试。'); stopped = true; break; }
    }
    let complete = true;
    for (const part of message.segments || []) {
      if (!isCurrent()) { complete = false; stopped = true; break; }
      try { sent.push(await bot.sendSegments(target, [part], hasSent ? undefined : options)); hasSent = true; }
      catch {
        await notice(part.type === 'record' ? '语音发送未成功，后续消息已停止；请检查 NapCat 的语音转换能力。' : '图片或表情包发送未成功，后续消息已停止；请稍后重试。');
        complete = false; stopped = true; break;
      }
    }
    if (complete) remembered.push(message.summary || message.text || '');
    else if (textSent) remembered.push(message.text + '\n[媒体发送未完成]');
    else remembered.push('[媒体发送未完成]');
    if (stopped) break;
  }
  if (stopped) remembered.push('[后续消息未发送]');
  return { sent, summary: remembered.filter(Boolean).join('\n') };
}
