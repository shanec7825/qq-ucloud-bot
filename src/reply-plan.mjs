import { MAX_REPLY_MESSAGES, MAX_REPLY_TEXT, MAX_REPLY_TOTAL_TEXT, MAX_REPLY_TOTAL_SPEECH } from './reply-delivery.mjs';
import { validateReplyText, REPLY_FORMAT_NOTICE } from './reply-protocol.mjs';

const keys = (row, expected) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === expected.length && expected.every(key => Object.hasOwn(row, key));
function invalid() { throw Object.assign(new Error(REPLY_FORMAT_NOTICE), { code: 'REPLY_PLAN_INVALID' }); }
const prose = (text, limit) => typeof text === 'string' && text.trim() && text.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text);

// Compile declarative content into the existing delivery queue. The model never
// chooses an account, peer, file path, endpoint, voice ID or callable function.
export function compileReplyPlan(plan, { available = [], speech, wantsVoice, allowSinging = false } = {}) {
  if (!keys(plan, ['version','messages']) || plan.version !== 2 || !Array.isArray(plan.messages) || !plan.messages.length || plan.messages.length > MAX_REPLY_MESSAGES) invalid();
  const rows = [], images = new Set(); let textTotal = 0, speechTotal = 0;
  for (const item of plan.messages) {
    if (item?.type === 'text') {
      if (!keys(item, ['type','text']) || !prose(item.text, MAX_REPLY_TEXT)) invalid();
      validateReplyText(item.text); textTotal += item.text.length;
      rows.push({ text: item.text, speech: { text: '' } });
    } else if (item?.type === 'image') {
      if (!keys(item, ['type','mediaId']) || !available.some(row => row.id === item.mediaId) || images.has(item.mediaId)) invalid();
      images.add(item.mediaId); rows.push({ text: '', mediaIds: [item.mediaId] });
    } else if (item?.type === 'speech') {
      if (!keys(item, ['type','mode','text','style']) || !speech || !wantsVoice || !['speak','sing'].includes(item.mode) || !prose(item.text, speech.maxChars ?? 500) || typeof item.style !== 'string' || item.style.length > 300 || /[\x00-\x1f]/u.test(item.style) || item.mode === 'sing' && !allowSinging) invalid();
      validateReplyText(item.text); speechTotal += item.text.length;
      rows.push({ text: '', speech: { text: item.text, style: item.style, mode: item.mode } });
    } else invalid();
  }
  if (images.size > 2 || textTotal > MAX_REPLY_TOTAL_TEXT || speechTotal > MAX_REPLY_TOTAL_SPEECH) invalid();
  return { messages: rows };
}
