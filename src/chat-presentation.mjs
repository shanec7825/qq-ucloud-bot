import { segments } from './message-content.mjs';

// An explicit request overrides the automatic policy for this turn only.
export function speechMode(text, event, speech) {
  if (!speech) return false;
  if (/(?:不要|不用|别|停止|不方便听|不想听|不能听).{0,6}语音|(?:只|仅)(?:用|要|发|发送)?(?:文字|文本)|用文字(?:回|说)|静音回复/u.test(text)) return false;
  if (/(?:用|发|来|给|想听|听听).{0,8}语音|语音(?:回答|回复|说|讲)|(?:读|念)(?:给我听|出来)|朗读/u.test(text)) return true;
  if (/唱(?:一首|一段|首|段|个|歌|给我|两句)|哼(?:一首|一段|首|段|两句)/u.test(text)) return true;
  return speech.autoReply ? 'auto' : false;
}

export function incomingVoice(event) { return segments(event).some(part => part.type === 'record'); }

const structured = /```|~~~|`|https?:\/\/|\$|\\\(|\\\[|^\s*(?:#{1,6}\s|[-*+]\s|\d+[.、)]\s|[>|])|\n\s*\|/mu;
const opening = new Map([['（','）'], ['(',')'], ['[',']'], ['【','】'], ['「','」'], ['『','』'], ['“','”'], ['{','}']]);

// Only short conversational prose gets a fallback split. The model owns semantic
// grouping; URLs, lists, code and formulas retain their original presentation.
export function splitChatText(text) {
  if (typeof text !== 'string' || text.length < 20 || text.length > 500 || structured.test(text)) return [text];
  const stack = [], chunks = []; let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (opening.has(char)) stack.push(opening.get(char));
    else if (stack.at(-1) === char) stack.pop();
    else if (char === '"') { if (stack.at(-1) === '"') stack.pop(); else stack.push('"'); }
    if (stack.length || !/[。！？!?]/u.test(char) || /[。！？!?]/u.test(text[index + 1] || '')) continue;
    // Keep trailing emoji with the sentence they express.
    const tail = /^[ \t]*[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]+/u.exec(text.slice(index + 1));
    if (tail) index += tail[0].length;
    chunks.push(text.slice(start, index + 1)); start = index + 1;
  }
  if (start < text.length) chunks.push(text.slice(start));
  const result = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) { if (result.length) result[result.length - 1] += chunk; continue; }
    if (result.length && (result.at(-1).trim().length < 6 || !/[\p{L}\p{N}]/u.test(chunk))) result[result.length - 1] += chunk;
    else result.push(chunk);
  }
  if (result.length > 1 && result.at(-1).trim().length < 5) result.splice(-2, 2, result.at(-2) + result.at(-1));
  // Four fallback bubbles are enough; preserve every character when combining.
  if (result.length > 4) result.splice(3, result.length - 3, result.slice(3).join(''));
  return result.length > 1 ? result : [text];
}

export function conversationalReply(reply) {
  if (reply && typeof reply === 'object' && Array.isArray(reply.messages)) return { ...reply, pacing: true };
  const text = typeof reply === 'string' ? reply : reply?.text;
  const chunks = splitChatText(text);
  if (chunks.length < 2) return reply;
  const last = typeof reply === 'object' ? reply : {};
  return { pacing: true, messages: chunks.map((chunk, index) => index === chunks.length - 1
    ? { ...last, text: chunk, speechAlreadyVisible: !!last.speechText && last.speechText.trim() === text.trim(), summary: last.summary ? chunk + last.summary.slice(text.length) : chunk }
    : { text: chunk, summary: chunk }) };
}
