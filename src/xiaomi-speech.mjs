import { decodeBase64 } from './outgoing-media.mjs';
import { SPEECH_DEFAULTS, SPEECH_VOICES, SPEECH_ENDPOINTS } from '../napcat-plugin/speech-config.mjs';
import { speechContext } from './speech-direction.mjs';
export { SPEECH_DEFAULTS, SPEECH_VOICES, SPEECH_ENDPOINTS };

export function validateMimoKey(key) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('请先在语音设置中保存 MiMo API Key。');
  if (/\s/.test(key)) throw new Error('MiMo API Key 不能包含空白。');
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
  constructor({ settings, key, fetcher = fetch, now = Date.now }) { Object.assign(this, { settings, key, fetcher, now }); this.last = new Map(); this.active = 0; }
  async synthesize(text, scope = 'preview', { style = '' } = {}) {
    const [result] = await this.synthesizeBatch([{ text, style }], scope);
    if (result.error) throw new Error(result.error);
    return result.part;
  }
  async synthesizeBatch(requests, scope = 'preview') {
    if (!Array.isArray(requests) || !requests.length || requests.length > 4) throw new Error('单轮语音须为 1–4 条。');
    const config = this.settings();
    if (!config.enabled) throw new Error('语音发送未启用，请先在语音设置中开启。');
    const key = this.key(); validateMimoKey(key);
    if (!SPEECH_ENDPOINTS.includes(config.baseURL)) throw new Error('请选择小米官方语音服务地址。');
    if (/^t{1,2}p-/i.test(key) && config.baseURL === SPEECH_ENDPOINTS[0]) throw new Error('Token Plan Key 请搭配 Token Plan 专用地址。');
    const prepared = requests.map(request => {
      if (!request || typeof request.text !== 'string' || !request.text.trim() || request.text.length > config.maxChars) throw new Error(`语音文字须为 1–${config.maxChars} 字。`);
      return { text: request.text, context: speechContext(config, request.style === undefined ? '' : request.style) };
    });
    if (this.active >= 2 || this.now() - (this.last.get(scope) ?? -Infinity) < 5000) throw new Error('语音生成较频繁，请 5 秒后重试。');
    this.last.set(scope, this.now()); while (this.last.size > 500) this.last.delete(this.last.keys().next().value); this.active++;
    try {
      const signature = JSON.stringify(config), results = [];
      let failure;
      for (const request of prepared) {
        if (!failure && (JSON.stringify(this.settings()) !== signature || this.key() !== key)) failure = '语音设置或授权已改变，后续语音未生成。';
        if (failure) { results.push({ error: failure }); continue; }
        try { results.push({ part: await this.request(request.text, request.context, config, key) }); }
        catch (error) { failure = error.message; results.push({ error: failure }); }
      }
      return results;
    } finally { this.active--; }
  }
  async request(text, context, config, key) {
    try {
      const response = await this.fetcher(config.baseURL + '/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: config.model, messages: [...(context ? [{ role: 'user', content: context }] : []), { role: 'assistant', content: text.trim() }], audio: { format: 'wav', ...(config.model === 'mimo-v2.5-tts-voicedesign' ? {} : { voice: config.voice }) }, stream: false }),
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
