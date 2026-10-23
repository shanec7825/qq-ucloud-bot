import { messageText } from './persona.mjs';
import { speechStyle } from './speech-direction.mjs';
import { decodeReply, validateReplyText, REPLY_FORMAT_NOTICE } from './reply-protocol.mjs';
import { independentSpeech } from './speech-content.mjs';
import { compileReplyPlan } from './reply-plan.mjs';
import { MAX_REPLY_MESSAGES, MAX_REPLY_TEXT, MAX_REPLY_TOTAL_TEXT, MAX_REPLY_TOTAL_SPEECH, MAX_REPLY_SEGMENTS } from './reply-delivery.mjs';

async function prepareMedia(work) {
  try { return await work(); }
  catch (cause) { throw Object.assign(new Error('媒体准备未完成。'), { code: 'REPLY_MEDIA_PREPARE', cause }); }
}

export async function mediaCommand(text, event, deps) {
  const command = messageText(event) || text;
  const collect = /^\/收藏(图片|表情包)\s+(.{1,60})$/u.exec(command.trim());
  if (collect && deps.outgoingMedia) {
    const item = await deps.outgoingMedia.collect(event, { name: collect[2], type: collect[1] === '图片' ? 'image' : 'sticker' });
    return `已收藏${collect[1]}「${item.name}」，仅在当前会话使用。发送 /${collect[1]} ${item.name} 即可发送。`;
  }
  const send = /^\/(图片|表情包|表情)(?:\s+(.+))?$/u.exec(command.trim());
  if (send && deps.outgoingMedia) {
    const type = send[1] === '图片' ? 'image' : 'sticker';
    const saved = (await deps.outgoingMedia.list(event)).filter(item => item.type === type);
    const recent = type === 'sticker' ? (deps.stickers?.list(event) || []).filter(item => !saved.some(row => row.id === item.id)) : [];
    const available = [...saved, ...recent];
    if (!send[2]) return available.length ? `本会话可用${send[1]}：\n` + available.map((item, i) => `${i + 1}. ${item.name}（${item.id}）`).join('\n') + `\n发送 /${send[1]} 编号、名称或 ID。` : `暂无${send[1]}。在设置页上传，或附图发送 /收藏${type === 'image' ? '图片' : '表情包'} 名称。`;
    const query = send[2].trim(), matches = available.filter(item => item.id === query || item.name === query);
    const selected = /^\d+$/.test(query) ? available[Number(query) - 1] : matches.length === 1 ? matches[0] : null;
    if (!selected) return '未找到唯一素材，请先查看列表，再使用编号或 ID。';
    const part = await prepareMedia(() => saved.includes(selected) ? deps.outgoingMedia.outgoing(event, selected.id) : deps.stickers.outgoing(event, selected.id));
    return { text: '', segments: [part], summary: `[发送${send[1]}：${selected.name}]` };
  }
  const voice = /^\/(?:语音|朗读)(?:\s+([\s\S]+))?$/u.exec(command.trim());
  if (voice && !deps.speech) return '请先在语音扩展中启用语音。';
  if (voice && deps.speech) {
    if (!voice[1]) return '发送 /语音 要朗读的文字，或说“用语音回答：你的问题”。';
    const explicit = /^\[([^\]\r\n]{1,300})\]\s+([\s\S]+)$/u.exec(voice[1]);
    const original = explicit ? explicit[2] : voice[1];
    if (!original.trim() || original.length > (deps.speech.maxChars ?? 500)) throw new Error(`语音内容须为 ${deps.speech.maxChars ?? 500} 字以内的文字。`);
    const message = { text: '', segments: [], summary: '' };
    attachSpeech([message], [{ text: original, style: explicit ? speechStyle(explicit[1]) : '' }], event, deps.speech, { planStyle: !explicit });
    return message;
  }
  return null;
}

export async function mediaReply(raw, event, deps, available, wantsVoice, { planStyle = false, independent = false, allowSinging = false, expectStructured = false } = {}) {
  const decoded = decodeReply(raw);
  if (!decoded && expectStructured && /^\s*(?:```(?:json)?\s*)?[\[{]/iu.test(raw)) throw Object.assign(new Error(REPLY_FORMAT_NOTICE), { code: 'REPLY_PLAN_INVALID' });
  if (decoded && Object.hasOwn(decoded, 'version')) return multiReply(compileReplyPlan(decoded, { available, speech: deps.speech, wantsVoice, allowSinging }), event, deps, available, wantsVoice, independent, true);
  if (decoded && Object.hasOwn(decoded, 'messages')) return multiReply(decoded, event, deps, available, wantsVoice, independent);
  let text = raw.slice(0, 6000), ids = [], accepted;
  {
    const plan = decoded;
    if (plan && typeof plan.text === 'string') {
      text = plan.text.slice(0, 6000);
      if (Object.keys(plan).every(key => ['text','mediaIds','speech'].includes(key)) && (plan.mediaIds === undefined || Array.isArray(plan.mediaIds))) {
        ids = [...new Set(plan.mediaIds || [])].slice(0, 2);
        if (ids.some(id => typeof id !== 'string' || !available.some(item => item.id === id))) { ids = []; if (!text) text = '没有找到当前会话可用的图片或表情包。'; }
        accepted = plan;
      }
    }
  }
  // Preserve a usable text field if extra model metadata invalidates optional
  // media/speech. Internal fields never become visible fallback text.
  if (decoded && typeof decoded.text !== 'string') throw new Error(REPLY_FORMAT_NOTICE);
  validateReplyText(text);
  validateReplyText(accepted?.speech?.text);
  if (accepted?.speech?.mode !== undefined) throw Object.assign(new Error(REPLY_FORMAT_NOTICE), { code: 'REPLY_PLAN_INVALID' });
  text = withoutMediaReceipts(text, available.filter(item => ids.includes(item.id)));
  let voice = plannedSpeech(accepted?.speech, text, deps.speech, wantsVoice);
  let repeatedVoice = false;
  if (independent) {
    const rows = [{ text }], voices = [voice]; independentSpeech(rows, voices, wantsVoice === true);
    repeatedVoice = !!voice.text && !voices[0].text;
    text = rows[0].text; voice = voices[0];
  }
  if (wantsVoice === 'auto' && !voice.text && !repeatedVoice) text = preserveSpeechText(text, accepted?.speech, MAX_REPLY_TOTAL_TEXT);
  const parts = [];
  for (const id of ids) parts.push(await prepareMedia(() => deps.outgoingMedia.outgoing(event, id)));
  if (!parts.length && !voice.text) return text;
  const message = { text, segments: parts, summary: text + ids.map(id => `[图片：${available.find(item => item.id === id).name}]`).join('') };
  if (voice.text) attachSpeech([message], [voice], event, deps.speech, { planStyle });
  return message;
}

// History receipts describe already-sent media. A model can copy them into text
// as well as selecting the real image; remove only trailing annotations for
// media selected in this reply, preserving quoted examples and fenced code.
function withoutMediaReceipts(text, media) {
  if (!media.length) return text;
  const names = new Set(media.map(item => item.name)), lines = [];
  let fence = '';
  for (const line of text.split('\n')) {
    const delimiter = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = '';
      lines.push(line); continue;
    }
    const suffix = !fence && /[ \t]*(?:\[(?:图片|表情包)[：:][^\]\r\n]+\][ \t]*)+$/u.exec(line);
    if (!suffix) { lines.push(line); continue; }
    const cleaned = suffix[0].replace(/\[(?:图片|表情包)[：:]([^\]\r\n]+)\]/gu, (marker, name) => names.has(name.trim()) ? '' : marker);
    if (cleaned === suffix[0]) { lines.push(line); continue; }
    const content = (line.slice(0, suffix.index) + cleaned).trimEnd();
    if (content.trim()) lines.push(content);
  }
  return lines.join('\n');
}

function plannedSpeech(speech, fallback, config, enabled) {
  let text = enabled === true ? fallback : '', style = '';
  if (!enabled || !speech || typeof speech !== 'object' || Array.isArray(speech) || Object.keys(speech).some(key => !['text', 'style', 'mode'].includes(key))) {
    if (text.length > (config?.maxChars ?? 500)) throw new Error(`语音内容须为 ${config?.maxChars ?? 500} 字以内的文字。`);
    return { text, style };
  }
  if (Object.hasOwn(speech, 'text')) {
    const limit = config?.maxChars ?? 500;
    if (typeof speech.text !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(speech.text)) throw new Error(`语音内容须为 ${limit} 字以内的文字，留空表示仅发文字。`);
    if (speech.text.length > limit && enabled === 'auto') return { text: '', style: '' };
    if (speech.text.length > limit) throw new Error(`语音内容须为 ${limit} 字以内的文字，留空表示仅发文字。`);
    text = speech.text.trim();
  }
  if (text.length > (config?.maxChars ?? 500)) throw new Error(`语音内容须为 ${config?.maxChars ?? 500} 字以内的文字。`);
  // Automatic voice is an intentional, short spoken addition. It never reads
  // arbitrary plain output, links or code simply because TTS is enabled.
  if (enabled === 'auto' && (text.length > Math.min(config?.maxChars ?? 500, 180) || /https?:\/\/|```|`|\$\$|\b(?:const|function|SELECT)\b|[\x00-\x1f]/u.test(text))) return { text: '', style: '' };
  if (config?.autoStyle && Object.hasOwn(speech, 'style')) {
    try { style = speechStyle(speech.style); } catch { /* Invalid optional guidance keeps the fixed voice settings. */ }
  }
  return { text, style, ...(speech.mode ? { mode: speech.mode } : {}) };
}

function speechAsText(speech, limit) {
  return speech && typeof speech.text === 'string' && speech.text.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(speech.text) ? speech.text : '';
}

function preserveSpeechText(text, speech, limit) {
  const spoken = speechAsText(speech, limit);
  const combined = text + (text.trim() ? '\n' : '') + spoken;
  return spoken.trim() && spoken.trim() !== text.trim() && combined.length <= limit ? combined : text;
}

function speechSummary(spoken, text) { return spoken.trim() !== text.trim() ? (text ? '\n' : '') + '[语音] ' + spoken : ''; }

// A reply carries only lazy work. Delivery starts the shared batch after its first text/image receipt.
// Per-index results let the first voice send while later voices are still being generated.
function attachSpeech(messages, voices, event, speech, { planStyle = false } = {}) {
  const indices = voices.map((voice, index) => voice.text ? index : -1).filter(index => index >= 0);
  if (!indices.length) return;
  const waiting = indices.map(() => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve, settled: false }; });
  let started = false;
  const settle = (result, index) => {
    const item = waiting[index];
    if (item && !item.settled) { item.settled = true; item.resolve(result || { error: '服务未返回音频' }); }
  };
  async function run(isCurrent) {
    const requests = indices.map(index => ({ text: voices[index].text, style: voices[index].style, ...(voices[index].mode ? { mode: voices[index].mode } : {}) }));
    let warning = '';
    try {
      if (planStyle && speech.autoStyle && speech.plan) {
        for (const request of requests) {
          if (!isCurrent()) break;
          try { request.style = speechStyle(await speech.plan(request.text, event)); }
          catch { warning = '本次自动语气分析未完成，使用已保存的声音指令。'; }
        }
      }
      if (!isCurrent()) { waiting.forEach((_item, index) => settle({ cancelled: true }, index)); return; }
      if (speech.synthesizeBatch) {
        const results = await speech.synthesizeBatch(requests, event, { isCurrent, onResult: (result, index) => settle(warning ? { ...result, warning } : result, index) });
        waiting.forEach((_item, index) => settle(warning ? { ...results?.[index], warning } : results?.[index], index));
      } else {
        let failure;
        for (const [index, request] of requests.entries()) {
          if (!isCurrent()) { settle({ cancelled: true }, index); continue; }
          if (failure) { settle({ error: failure }, index); continue; }
          try { settle({ part: await speech.synthesize(request.text, event, { style: request.style, ...(request.mode ? { mode: request.mode } : {}) }), warning }, index); }
          catch (error) { failure = error.message || '语音服务未完成'; settle({ error: failure }, index); }
        }
      }
    } catch (error) {
      waiting.forEach((_item, index) => settle({ error: error.message || '语音服务未完成' }, index));
    }
  }
  for (const [position, index] of indices.entries()) {
    messages[index].speechText = voices[index].text;
    messages[index].speechSummary = speechSummary(voices[index].text, messages[index].text);
    messages[index].prepareSpeech = ({ isCurrent = () => true } = {}) => {
      if (!started) { started = true; void run(isCurrent); }
      return waiting[position].promise;
    };
  }
}

async function multiReply(plan, event, deps, available, wantsVoice, independent, versioned = false) {
  if (Object.keys(plan).join() !== 'messages' || !Array.isArray(plan.messages) || !plan.messages.length || plan.messages.length > MAX_REPLY_MESSAGES) throw new Error(`模型分条回复格式无效，未发送；每次最多 ${MAX_REPLY_MESSAGES} 条。`);
  const selected = new Set(), voices = [], rows = []; let automaticVoices = 0;
  for (const row of plan.messages) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['text','mediaIds','speech'].includes(key)) || typeof row.text !== 'string' || row.text.length > MAX_REPLY_TEXT || row.mediaIds !== undefined && !Array.isArray(row.mediaIds)) throw new Error('模型分条回复内容无效，未发送。');
    validateReplyText(row.text);
    validateReplyText(row.speech?.text);
    if (!versioned && row.speech?.mode !== undefined) throw Object.assign(new Error(REPLY_FORMAT_NOTICE), { code: 'REPLY_PLAN_INVALID' });
    for (const id of row.mediaIds || []) {
      if (typeof id !== 'string' || !available.some(item => item.id === id) || selected.has(id)) throw new Error('模型选择了不可用或重复的素材，未发送。');
      selected.add(id);
    }
  }
  if (selected.size > 2) throw new Error('单次回复最多使用两张图片或表情包，未发送。');
  const media = available.filter(item => selected.has(item.id));
  for (const row of plan.messages) {
    const originalText = row.text;
    row.text = withoutMediaReceipts(row.text, media);
    let voice = plannedSpeech(row.speech, row.text, deps.speech, wantsVoice);
    if (wantsVoice === 'auto' && voice.text && automaticVoices++ >= 1) voice = { text: '', style: '' };
    if (wantsVoice === 'auto' && !voice.text) {
      const remaining = MAX_REPLY_TOTAL_TEXT - plan.messages.reduce((total, item) => total + (typeof item?.text === 'string' ? item.text.length : 0), 0);
      row.text = preserveSpeechText(row.text, row.speech, Math.min(MAX_REPLY_TEXT, row.text.length + Math.max(0, remaining)));
    }
    if (row.text.length > MAX_REPLY_TEXT) throw new Error('自动语音转为文字后单条内容过长，未发送。');
    if (!row.text.trim() && !(row.mediaIds || []).length && !voice.text) {
      if (row.text !== originalText) continue;
      throw new Error('模型返回了空消息，未发送。');
    }
    rows.push(row); voices.push(voice);
  }
  if (rows.reduce((total, row) => total + row.text.length, 0) > MAX_REPLY_TOTAL_TEXT || voices.reduce((total, voice) => total + voice.text.length, 0) > MAX_REPLY_TOTAL_SPEECH ||
    rows.reduce((total, row, index) => total + (row.text ? 1 : 0) + (row.mediaIds?.length || 0) + (voices[index].text ? 1 : 0), 0) > MAX_REPLY_SEGMENTS) throw new Error('整轮回复的总字数或消息段数超出限制，未发送。');
  if (independent) independentSpeech(rows, voices, wantsVoice === true);
  // De-duplication can turn a redundant text-only bubble into an empty row.
  for (let index = rows.length - 1; index >= 0; index--) if (!rows[index].text.trim() && !rows[index].mediaIds?.length && !voices[index].text) { rows.splice(index, 1); voices.splice(index, 1); }
  const messages = [];
  for (const row of rows) {
    const result = await mediaReply(JSON.stringify({ text: row.text.trim() ? row.text : '', mediaIds: row.mediaIds || [] }), event, deps, available, false);
    messages.push(typeof result === 'string' ? { text: result, segments: [], summary: result } : result);
  }
  if (wantsVoice && deps.speech) attachSpeech(messages, voices, event, deps.speech);
  return { messages };
}
