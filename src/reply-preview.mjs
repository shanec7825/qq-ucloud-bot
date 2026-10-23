import { compileReplyPlan } from './reply-plan.mjs';

// Only an entire first text object in the canonical v2 envelope can leave the
// model before the final plan. Media and legacy formats await full validation.
export function firstReplyText(raw) {
  if (typeof raw !== 'string' || raw.length > 64000) return null;
  const prefix = /^\s*\{\s*"version"\s*:\s*2\s*,\s*"messages"\s*:\s*\[\s*(?=\{)/u.exec(raw);
  if (!prefix) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = prefix[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      if (--depth !== 0) continue;
      if (!/^\s*[,\]]/u.test(raw.slice(i + 1))) return null;
      try {
        const row = JSON.parse(raw.slice(prefix[0].length, i + 1));
        if (row.type !== 'text' || /\[(?:图片|表情包)[：:]/u.test(row.text)) return null;
        compileReplyPlan({ version: 2, messages: [row] });
        return row.text;
      } catch { return null; }
    }
  }
  return null;
}
