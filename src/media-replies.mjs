import { messageText } from './persona.mjs';
import { speechStyle } from './speech-direction.mjs';
import { MAX_REPLY_MESSAGES, MAX_REPLY_TEXT } from './reply-delivery.mjs';

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
    const part = saved.includes(selected) ? await deps.outgoingMedia.outgoing(event, selected.id) : deps.stickers.outgoing(event, selected.id);
    return { text: '', segments: [part], summary: `[发送${send[1]}：${selected.name}]` };
  }
  const voice = /^\/(?:语音|朗读)(?:\s+([\s\S]+))?$/u.exec(command.trim());
  if (voice && deps.speech) {
    if (!voice[1]) return '发送 /语音 要朗读的文字，或说“用语音回答：你的问题”。';
    const explicit = /^\[([^\]\r\n]{1,300})\]\s+([\s\S]+)$/u.exec(voice[1]);
    const original = explicit ? explicit[2] : voice[1];
    let style = explicit ? speechStyle(explicit[1]) : '', warning = '';
    if (!explicit && deps.speech.autoStyle && deps.speech.plan) {
      try { style = speechStyle(await deps.speech.plan(original, event)); }
      catch { warning = '本次自动语气分析未完成，使用固定声音设置朗读。'; }
    }
    const part = await deps.speech.synthesize(original, event, { style });
    return { text: warning, segments: [part], summary: '[语音] ' + original };
  }
  return null;
}

export async function mediaReply(raw, event, deps, available, wantsVoice, { planStyle = false } = {}) {
  let decoded;
  try { decoded = JSON.parse(raw); } catch { /* Plain text is still supported. */ }
  if (decoded && Object.hasOwn(decoded, 'messages')) return multiReply(decoded, event, deps, available, wantsVoice);
  let text = raw.slice(0, 6000), ids = [], style = '';
  try {
    const plan = JSON.parse(raw);
    if (plan && typeof plan.text === 'string' && (wantsVoice || Object.hasOwn(plan, 'mediaIds') || Object.hasOwn(plan, 'speech'))) {
      text = plan.text.slice(0, 6000);
      if (Object.keys(plan).every(key => ['text','mediaIds','speech'].includes(key)) && (plan.mediaIds === undefined || Array.isArray(plan.mediaIds))) {
        ids = [...new Set(plan.mediaIds || [])].slice(0, 2);
        if (ids.some(id => typeof id !== 'string' || !available.some(item => item.id === id))) { ids = []; if (!text) text = '没有找到当前会话可用的图片或表情包。'; }
        if (deps.speech?.autoStyle && plan.speech && Object.keys(plan.speech).join() === 'style') {
          try { style = speechStyle(plan.speech.style); } catch { /* Invalid guidance falls back to fixed voice settings. */ }
        }
      }
    }
  } catch { /* Plain text remains the normal reply format. */ }
  const parts = [];
  for (const id of ids) parts.push(await deps.outgoingMedia.outgoing(event, id));
  let warning = '';
  if (wantsVoice && text) {
    if (planStyle && deps.speech.autoStyle && deps.speech.plan) {
      try { style = speechStyle(await deps.speech.plan(text, event)); }
      catch { warning = '\n（本次自动语气分析未完成，使用固定声音设置朗读。）'; }
    }
    try { parts.push(await deps.speech.synthesize(text, event, { style })); }
    catch (error) { warning = '\n（语音未生成：' + error.message + '）'; }
  }
  if (!parts.length) return text + warning;
  return { text: text + warning, segments: parts, summary: text + ids.map(id => `[图片：${available.find(item => item.id === id).name}]`).join('') };
}

async function multiReply(plan, event, deps, available, wantsVoice) {
  if (Object.keys(plan).join() !== 'messages' || !Array.isArray(plan.messages) || !plan.messages.length || plan.messages.length > MAX_REPLY_MESSAGES) throw new Error('模型分条回复格式无效，未发送；每次最多 4 条。');
  const selected = new Set();
  for (const row of plan.messages) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['text','mediaIds','speech'].includes(key)) || typeof row.text !== 'string' || row.text.length > MAX_REPLY_TEXT || row.mediaIds !== undefined && !Array.isArray(row.mediaIds)) throw new Error('模型分条回复内容无效，未发送。');
    for (const id of row.mediaIds || []) {
      if (typeof id !== 'string' || !available.some(item => item.id === id) || selected.has(id)) throw new Error('模型选择了不可用或重复的素材，未发送。');
      selected.add(id);
    }
    if (!row.text.trim() && !(row.mediaIds || []).length) throw new Error('模型返回了空消息，未发送。');
  }
  if (selected.size > 2) throw new Error('单次回复最多使用两张图片或表情包，未发送。');
  const messages = [];
  for (const row of plan.messages) {
    const result = await mediaReply(JSON.stringify({ ...row, text: row.text.trim() ? row.text : '', mediaIds: row.mediaIds || [] }), event, deps, available, false);
    messages.push(typeof result === 'string' ? { text: result, segments: [], summary: result } : result);
  }
  if (wantsVoice && deps.speech) {
    const indices = messages.map((row, index) => row.text.trim() ? index : -1).filter(index => index >= 0);
    const requests = indices.map(index => {
      let style = '';
      if (deps.speech.autoStyle && plan.messages[index].speech && Object.keys(plan.messages[index].speech).join() === 'style') {
        try { style = speechStyle(plan.messages[index].speech.style); } catch { /* Keep the fixed voice on invalid optional guidance. */ }
      }
      return { text: messages[index].text, style };
    });
    if (requests.length) {
      let results;
      try {
        if (deps.speech.synthesizeBatch) results = await deps.speech.synthesizeBatch(requests, event);
        else { results = []; for (const request of requests) { try { results.push({ part: await deps.speech.synthesize(request.text, event, { style: request.style }) }); } catch (error) { results.push({ error: error.message }); } } }
      } catch (error) { results = requests.map(() => ({ error: error.message })); }
      for (const [position, index] of indices.entries()) {
        const result = results[position];
        if (result?.part) messages[index].segments.push(result.part);
        else { const note = '\n（语音未生成：' + (result?.error || '服务未返回音频') + '）'; messages[index].text += note; messages[index].summary += note; }
      }
    }
  }
  return { messages };
}
