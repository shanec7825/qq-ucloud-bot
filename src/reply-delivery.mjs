import { isReplyProtocol, REPLY_FORMAT_NOTICE } from './reply-protocol.mjs';
import { reportDeliveryIssue } from './delivery-issues.mjs';
import { abortable } from './chat-abort.mjs';

export const MAX_REPLY_MESSAGES = 8;
export const MAX_REPLY_TEXT = 1500;
export const MAX_REPLY_TOTAL_TEXT = 6000;
export const MAX_REPLY_TOTAL_SPEECH = 4000;
export const MAX_REPLY_SEGMENTS = 18;

// A logical reply owns the conversation queue until every bubble has a receipt.
export async function deliverReply(response, { bot, target, options, isCurrent = () => true, signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, onIssue = reportDeliveryIssue }) {
  // Cover alternate agent/command routes as well, before any part of a batch
  // has been sent. Never synthesize or send a raw model transport envelope.
  const candidates = response && typeof response === 'object' && Array.isArray(response.messages) ? response.messages : [response];
  if (candidates.some(message => isReplyProtocol(typeof message === 'string' ? message : message?.text) || isReplyProtocol(message?.speechText))) response = REPLY_FORMAT_NOTICE;
  const rich = response && typeof response === 'object';
  const messages = rich && Array.isArray(response.messages) ? response.messages : [rich ? response : { text: response }];
  if (!messages.length || messages.length > MAX_REPLY_MESSAGES) throw new Error('回复消息数量无效。');
  if (messages.some(message => !message || typeof message !== 'object' || message.text != null && typeof message.text !== 'string' || message.segments != null && !Array.isArray(message.segments)) ||
    messages.reduce((total, message) => total + (message.text?.length || 0), 0) > MAX_REPLY_TOTAL_TEXT ||
    messages.reduce((total, message) => total + (message.text ? 1 : 0) + (message.segments?.length || 0) + (message.prepareSpeech ? 1 : 0), 0) > MAX_REPLY_SEGMENTS) throw new Error('回复总字数或消息段数超出限制，未发送。');
  const sent = [], remembered = []; let hasSent = false, stopped = false, lastSentAt = 0, firstSentAt = null;
  const current = () => !stopped && isCurrent();
  const receipts = value => {
    lastSentAt = now();
    firstSentAt ??= lastSentAt;
    if (Array.isArray(value)) sent.push(...value);
    else if (value?.message_id !== undefined) sent.push(value);
  };
  const notice = async text => {
    if (!current()) return false;
    try { receipts(await bot.send(target, text, hasSent ? undefined : options)); hasSent = true; return true; }
    catch { console.error('QQ 回复投递失败，后续消息已停止。'); return false; }
  };
  for (const message of messages) {
    if (hasSent && response.pacing === true) {
      let remaining = Math.max(0, Math.min(1200, 400 + (message.text?.length || 0) * 12) - (now() - lastSentAt));
      while (remaining > 0 && current()) {
        const step = Math.min(remaining, 100); await wait(step); remaining -= step;
      }
    }
    if (!current()) { stopped = true; break; }
    let textSent = false;
    if (message.text) {
      try {
        receipts(await bot.send(target, message.text, hasSent ? undefined : options));
        textSent = true; hasSent = true;
      }
      catch (error) { onIssue('text_send_failed', error); stopped = true; break; }
    }
    let complete = true;
    for (const part of message.segments || []) {
      if (!current()) { complete = false; stopped = true; break; }
      try { receipts(await bot.sendSegments(target, [part], hasSent ? undefined : options)); hasSent = true; }
      catch (error) {
        onIssue(part.type === 'record' ? 'voice_send_failed' : 'image_send_failed', error);
        complete = false; stopped = true; break;
      }
    }
    let speechSent = false, speechFallback = '';
    if (complete && typeof message.prepareSpeech === 'function') {
      if (!current()) { complete = false; stopped = true; }
      else {
        let result;
        try { result = await abortable(message.prepareSpeech({ isCurrent: current }), signal); }
        catch (error) { result = { error: error.message || '语音服务未完成' }; }
        if (!current() || result?.cancelled) { complete = false; stopped = true; }
        else if (result?.part) {
          if (result.warning) onIssue('speech_style_fallback');
          if (complete && current()) {
            try { receipts(await bot.sendSegments(target, [result.part], hasSent ? undefined : options)); hasSent = true; speechSent = true; }
            catch (error) {
              onIssue('voice_send_failed', error);
              complete = false; stopped = true;
            }
          }
        } else {
          onIssue('speech_synthesis_failed');
          speechFallback = !message.speechAlreadyVisible && message.speechText && message.speechText.trim() !== (message.text || '').trim() ? message.speechText.replace(/^\s*[（(\[](?:唱歌|sing|singing)[）)\]]\s*/iu, '') : '';
          if (speechFallback && !await notice(speechFallback)) { speechFallback = ''; complete = false; stopped = true; }
        }
      }
    }
    if (complete) {
      const summary = (message.summary || message.text || '') + (speechSent ? message.speechSummary || '' : '');
      remembered.push(summary + (speechFallback ? (summary ? '\n' : '') + speechFallback : ''));
    }
    else if (textSent) remembered.push(message.text + '\n[媒体发送未完成]');
    else remembered.push('[媒体发送未完成]');
    if (stopped) break;
  }
  if (stopped) remembered.push('[后续消息未发送]');
  return { sent, summary: remembered.filter(Boolean).join('\n'), stopped, firstSentAt };
}
