export const DIRECTION_LIMIT = 300;
export function speechStyle(value) {
  if (typeof value !== 'string' || value.length > DIRECTION_LIMIT || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('本条语音指导须为 300 字以内的文字。');
  return value.trim();
}

export function speechDirection(config) {
  return { autoStyle: !!config.enabled && !!config.autoStyle, voice: config.model === 'mimo-v2.5-tts-voicedesign' ? config.voiceDescription : config.voice, baseStyle: config.style, maxChars: config.maxChars };
}

export async function planSpeechStyle(text, { ai, direction, conversation = [] }) {
  if (typeof text !== 'string' || !text.trim() || text.length > direction.maxChars) throw new Error(`语音文字须为 1–${direction.maxChars} 字。`);
  const raw = await ai('为 MiMo TTS 生成这段原文的表达指导，不改写原文或改变固定音色。', { mode: 'speech-direction', text, voice: direction.voice, baseStyle: direction.baseStyle, conversation });
  let plan;
  try { plan = JSON.parse(raw); } catch { throw new Error('模型未返回有效语音指导。'); }
  if (!plan || Array.isArray(plan) || Object.keys(plan).join() !== 'style') throw new Error('模型语音指导格式无效。');
  return speechStyle(plan.style);
}

export function speechContext(config, style = '') {
  style = speechStyle(style);
  const design = config.model === 'mimo-v2.5-tts-voicedesign';
  if (design && !config.voiceDescription?.trim()) throw new Error('请先填写音色描述，再使用文字设计音色。');
  return [
    design ? '固定音色描述（声音身份，保持不变）：' + config.voiceDescription.trim() : config.voice ? '固定预置音色（保持不变）：' + config.voice : '',
    config.style.trim() ? '管理员固定表达要求（优先遵守）：' + config.style.trim() : '',
    style ? '本条 MiMo TTS 指导（按语义调整语调、情绪、语速、停顿、重音、气息和音色质感；只能微调表现，不能更换固定音色身份）：' + style : '',
    ...(design || config.voice || config.style.trim() || style ? ['保持声音身份一致；只朗读 assistant 消息正文，不朗读本段指导。'] : []),
  ].filter(Boolean).join('\n');
}
