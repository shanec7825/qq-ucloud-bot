export const DIRECTION_LIMIT = 300;
export function speechStyle(value) {
  if (typeof value !== 'string' || value.length > DIRECTION_LIMIT || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('本条语音指导须为 300 字以内的文字。');
  return value.trim();
}

export function speechDirection(config) {
  return { model: config.model, supportsSinging: true, singingVoice: config.voice || '冰糖', singingChangesVoice: config.model !== 'mimo-v2.5-tts', autoStyle: !!config.enabled && !!config.autoStyle, voice: config.model === 'mimo-v2.5-tts-voiceclone' ? '固定参考音频的声音身份，保持不变' : config.model === 'mimo-v2.5-tts-voicedesign' ? config.style || config.voiceDescription : config.voice, baseStyle: config.style || '', directive: config.style || '', maxChars: config.maxChars };
}

export async function planSpeechStyle(text, { ai, direction, conversation = [] }) {
  if (typeof text !== 'string' || !text.trim() || text.length > direction.maxChars) throw new Error(`语音文字须为 1–${direction.maxChars} 字。`);
  const raw = await ai('根据统一声音指令，为 MiMo TTS 微调这段原文的表达，不改写原文或改变声音身份。', { mode: 'speech-direction', text, voice: direction.voice, baseStyle: direction.directive || direction.baseStyle, conversation });
  let plan;
  try { plan = JSON.parse(raw); } catch { throw new Error('模型未返回有效语音指导。'); }
  if (!plan || Array.isArray(plan) || Object.keys(plan).join() !== 'style') throw new Error('模型语音指导格式无效。');
  return speechStyle(plan.style);
}

export function speechContext(config, style = '') {
  style = speechStyle(style);
  const design = config.model === 'mimo-v2.5-tts-voicedesign';
  const clone = config.model === 'mimo-v2.5-tts-voiceclone';
  const directive = (config.style || '').trim();
  const description = directive || (config.voiceDescription || '').trim();
  if (design && !description) throw new Error('请先填写声音指令或原有音色描述，再使用文字设计音色。');
  return [
    clone ? '固定声音身份：使用 audio.voice 中的参考音频，保持说话人音色不变。' : design ? '固定音色描述（声音身份，保持不变）：' + description : config.voice ? '固定预置音色（保持不变）：' + config.voice : '',
    directive ? '统一声音指令（音色、语速、语气） / 管理员固定表达要求（优先遵守）：' + directive : '',
    style ? '本条 MiMo TTS 指导（按语义调整语调、情绪、语速、停顿、重音、气息和音色质感；只能微调表现，不能更换固定音色身份）：' + style : '',
    ...(clone || design || config.voice || directive || style ? ['保持声音身份一致；只朗读 assistant 消息正文，不朗读本段指导。'] : []),
  ].filter(Boolean).join('\n');
}
