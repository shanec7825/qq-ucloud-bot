import { decodeBase64 } from './outgoing-media.mjs';
import { SPEECH_DEFAULTS, SPEECH_VOICES, SPEECH_ENDPOINTS } from '../napcat-plugin/speech-config.mjs';
import { speechContext } from './speech-direction.mjs';
import { MAX_REPLY_MESSAGES, MAX_REPLY_TOTAL_SPEECH } from './reply-delivery.mjs';
export { SPEECH_DEFAULTS, SPEECH_VOICES, SPEECH_ENDPOINTS };

export function validateMimoKey(key) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('请先在语音设置中保存 MiMo API Key。');
  if (/\s/.test(key)) throw new Error('MiMo API Key 不能包含空白。');
  if (/^sk-/i.test(key)) return 'api';
  if (/^t{1,2}p-/i.test(key)) return 'token-plan';
  throw new Error('MiMo Key 应以 sk-（按量 API）、tp- 或 ttp-（Token Plan）开头。');
}
export function validateWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('语音服务未返回有效 WAV 音频。');
  let fmt = false, data = false;
  if (bytes.readUInt32LE(4) + 8 > bytes.length) throw new Error('语音 WAV 数据不完整。');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error('语音 WAV 数据不完整。');
    if (type === 'fmt ' && size >= 16) fmt = true;
    if (type === 'data' && size > 0) data = true;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('语音 WAV 缺少格式或声音数据。');
  return bytes;
}
export class XiaomiSpeech {
  constructor({ settings, key, referenceAudio, fetcher = fetch, now = Date.now }) { Object.assign(this, { settings, key, referenceAudio, fetcher, now }); this.last = new Map(); this.active = 0; this.requests = 0; this.requestQueue = []; }
  async synthesize(text, scope = 'preview', { style = '', mode = 'speak' } = {}) {
    const [result] = await this.synthesizeBatch([{ text, style, mode }], scope);
    if (result.error) throw new Error(result.error);
    return result.part;
  }
  async synthesizeBatch(requests, scope = 'preview', { onResult, isCurrent = () => true } = {}) {
    if (!Array.isArray(requests) || !requests.length || requests.length > MAX_REPLY_MESSAGES) throw new Error(`单轮语音须为 1–${MAX_REPLY_MESSAGES} 条。`);
    const config = this.settings();
    if (!config.enabled) throw new Error('语音发送未启用，请先在语音设置中开启。');
    const key = this.key(), keyType = validateMimoKey(key);
    if (!SPEECH_ENDPOINTS.includes(config.baseURL)) throw new Error('请选择小米官方语音服务地址。');
    const planEndpoint = config.baseURL.startsWith('https://token-plan-');
    if (planEndpoint !== (keyType === 'token-plan')) throw new Error('MiMo Key 类型与服务地址不匹配：sk- 使用按量 API 地址，tp-/ttp- 使用对应 Token Plan 集群地址。');
    const prepared = requests.map(request => {
      if (!request || typeof request.text !== 'string' || !request.text.trim() || request.text.length > config.maxChars) throw new Error(`语音文字须为 1–${config.maxChars} 字。`);
      if (request.mode !== undefined && !['speak','sing'].includes(request.mode)) throw new Error('不支持的语音模式。');
      const singing = request.mode === 'sing';
      const voiceConfig = singing ? { ...config, model: 'mimo-v2.5-tts', voice: SPEECH_VOICES.includes(config.voice) ? config.voice : '冰糖', style: '', voiceDescription: '', referenceAudio: '' } : config;
      return { text: singing ? '(唱歌)' + request.text.replace(/^\s*[（(\[](?:唱歌|sing|singing)[）)\]]\s*/iu, '') : request.text, context: speechContext(voiceConfig, request.style === undefined ? '' : request.style), config: voiceConfig };
    });
    if (prepared.reduce((sum, request) => sum + request.text.length, 0) > MAX_REPLY_TOTAL_SPEECH) throw new Error(`整轮语音总字数不能超过 ${MAX_REPLY_TOTAL_SPEECH} 字。`);
    if (!isCurrent()) return prepared.map(() => ({ cancelled: true }));
    let audioVoice = config.voice;
    if (prepared.some(request => request.config.model === 'mimo-v2.5-tts-voiceclone')) {
      if (!config.referenceAudio || typeof this.referenceAudio !== 'function') throw new Error('请先上传参考音频并保存，再使用声音复刻。');
      audioVoice = await this.referenceAudio(config.referenceAudio);
      if (typeof audioVoice !== 'string' || !/^data:audio\/(?:wav|mpeg);base64,[A-Za-z0-9+/]+=*$/.test(audioVoice)) throw new Error('参考音频格式无效，请重新上传后保存。');
    }
    if (this.active >= 2 || this.now() - (this.last.get(scope) ?? -Infinity) < 5000) throw new Error('语音生成较频繁，请 5 秒后重试。');
    this.last.set(scope, this.now()); while (this.last.size > 500) this.last.delete(this.last.keys().next().value); this.active++;
    try {
      const signature = JSON.stringify(config), results = new Array(prepared.length);
      let failure, next = 0;
      const authorized = () => JSON.stringify(this.settings()) === signature && this.key() === key;
      const finish = (index, result) => { results[index] = result; onResult?.(result, index); };
      const worker = async () => {
        while (next < prepared.length) {
          const index = next++, request = prepared[index];
          if (!isCurrent()) { finish(index, { cancelled: true }); continue; }
          if (!authorized()) failure = '语音设置或授权已改变，后续语音未生成。';
          if (failure) { finish(index, { error: failure }); continue; }
          // The shared native fetch dispatcher keeps connections alive; at most two requests run
          // across every active batch. Each item is attempted once, including on HTTP errors.
          const release = await this.acquireRequest();
          let result;
          try {
            if (!isCurrent()) result = { cancelled: true };
            else if (!authorized()) { failure = '语音设置或授权已改变，后续语音未生成。'; result = { error: failure }; }
            else if (failure) result = { error: failure };
            else {
              const part = await this.request(request.text, request.context, request.config, key, request.config.model === 'mimo-v2.5-tts-voiceclone' ? audioVoice : request.config.voice);
              if (!isCurrent()) result = { cancelled: true };
              else if (!authorized()) { failure = '语音设置或授权已改变，后续语音未生成。'; result = { error: failure }; }
              else result = { part };
            }
          } catch (error) { failure = error.message; result = { error: failure }; }
          finally { release(); }
          finish(index, result);
        }
      };
      const workers = await Promise.allSettled(Array.from({ length: Math.min(2, prepared.length) }, worker));
      const rejected = workers.find(worker => worker.status === 'rejected');
      if (rejected) throw rejected.reason;
      return results;
    } finally { this.active--; }
  }
  async acquireRequest() {
    if (this.requests >= 2) await new Promise(resolve => this.requestQueue.push(resolve));
    else this.requests++;
    return () => {
      const next = this.requestQueue.shift();
      if (next) next(); else this.requests--;
    };
  }
  async request(text, context, config, key, audioVoice = config.voice) {
    try {
      const response = await this.fetcher(config.baseURL + '/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: config.model, messages: [...(context ? [{ role: 'user', content: context }] : []), { role: 'assistant', content: text.trim() }], audio: { format: 'wav', ...(config.model === 'mimo-v2.5-tts-voicedesign' ? {} : { voice: audioVoice }) }, stream: false }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`小米语音请求失败（HTTP ${response.status}），请检查 Key 与服务地址是否匹配、额度及 TTS 模型权限。`); }
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try { while (true) { const row = await reader.read(); if (row.done) break; size += row.value.length; if (size > 24 * 1024 * 1024) throw new Error('语音返回超过 24MB。'); chunks.push(row.value); } }
      finally { await reader.cancel().catch(() => {}); }
      let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('小米语音返回格式无效。'); }
      const bytes = validateWav(decodeBase64(result.choices?.[0]?.message?.audio?.data, 16 * 1024 * 1024));
      return { type: 'record', data: { file: 'base64://' + bytes.toString('base64') } };
    } catch (error) {
      if (error instanceof TypeError || error.name === 'TimeoutError') throw new Error('小米语音连接失败或超时，请稍后重试。');
      throw error;
    }
  }
}
