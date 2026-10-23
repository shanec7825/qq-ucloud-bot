// Model transport syntax must be decoded before chat splitting or TTS. This is
// a data decoder, never a dispatcher for model-authored function names.
export const REPLY_FORMAT_NOTICE = '这次回复格式出了点问题，请再发一次，我重新回答。';
const toolMarkup = /<\/?(?:tool_call|function|parameter)(?:\s|=|>)/iu;
const envelope = /^\s*(?:\{\s*"(?:version|messages|text|mediaIds|speech)"\s*:|"(?:\\n|\\r|\s)*\{\s*\\"(?:version|messages|text|mediaIds|speech)\\")/u;

export function isReplyProtocol(text) {
  if (typeof text !== 'string') return false;
  return toolMarkup.test(text) || envelope.test(text) || /^\s*```(?:json)?\s*\n\s*\{\s*"(?:version|messages|text|mediaIds|speech)"\s*:/iu.test(text);
}

function invalid() { throw Object.assign(new Error(REPLY_FORMAT_NOTICE), { code: 'REPLY_PLAN_INVALID' }); }

// Only close containers when every quoted string is already complete. Never
// invent a value, finish a cut-off string, or remove trailing model output.
function closeContainers(raw) {
  const stack = []; let quoted = false, escaped = false;
  for (const char of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') { if (stack.pop() !== char) return raw; }
  }
  return !quoted && stack.length <= 3 ? raw + stack.reverse().join('') : raw;
}

export function decodeReply(raw) {
  if (typeof raw !== 'string' || raw.length > 64000) invalid();
  let source = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/iu.exec(source);
  if (fenced) source = fenced[1].trim();
  let decoded;
  for (let layer = 0; layer < 2; layer++) {
    try { decoded = JSON.parse(source); }
    catch {
      if (envelope.test(source)) {
        try { decoded = JSON.parse(closeContainers(source)); } catch { invalid(); }
      }
      break;
    }
    if (typeof decoded !== 'string') break;
    source = decoded.trim(); decoded = undefined;
  }
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded) &&
    ['messages', 'text', 'mediaIds', 'speech'].some(key => Object.hasOwn(decoded, key))) return decoded;

  if (toolMarkup.test(source)) {
    // Compatibility with a complete legacy generateSpeech envelope. Parameters
    // only describe speech; voice identity, destinations and permissions still
    // come from host configuration. Partial or unknown tools are rejected.
    const call = /^<tool_call>\s*<function=generateSpeech>\s*([\s\S]*?)\s*<\/function>\s*<\/tool_call>$/u.exec(source);
    if (!call) invalid();
    const params = {}; let remaining = call[1];
    while (remaining.trim()) {
      const part = /^\s*<parameter=(text|speechStyle)>([\s\S]*?)<\/parameter>/u.exec(remaining);
      if (!part || Object.hasOwn(params, part[1]) || toolMarkup.test(part[2])) invalid();
      params[part[1]] = part[2]; remaining = remaining.slice(part[0].length);
    }
    if (!params.text?.trim()) invalid();
    return { text: params.text, mediaIds: [], speech: { text: params.text, ...(params.speechStyle ? { style: params.speechStyle } : {}) } };
  }
  if (isReplyProtocol(source) || isReplyProtocol(raw)) invalid();
  return null;
}

export function validateReplyText(text) {
  if (isReplyProtocol(text)) invalid();
}
