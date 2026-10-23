import { randomUUID, createHash } from 'node:crypto';
import { parseJSON } from './core.mjs';
import { qqPlainText } from './qq-output.mjs';
import { mediaURL } from './message-media.mjs';
import { decodeBase64, imageType } from './outgoing-media.mjs';
import { validateWav } from './xiaomi-speech.mjs';
import { reportDeliveryIssue } from './delivery-issues.mjs';

export class OneBot {
  constructor(address, token, onEvent, { onConnect = () => {} } = {}) {
    const url = new URL(address);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('ONEBOT_WS_URL 必须为 ws/wss 地址。');
    if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('远程 OneBot 连接请使用 wss。');
    if (token) url.searchParams.set('access_token', token);
    this.url = url; this.onEvent = onEvent; this.onConnect = onConnect; this.pending = new Map(); this.stopped = false;
  }
  connect() {
    if (this.stopped) return;
    const socket = this.socket = new WebSocket(this.url);
    const timeout = setTimeout(() => socket.close(), 15000);
    socket.addEventListener('open', () => { clearTimeout(timeout); if (this.stopped || this.socket !== socket) return; this.onConnect(); console.log('QQ 协议端已连接。'); });
    socket.addEventListener('error', () => { if (!this.stopped && this.socket === socket) console.error('QQ 连接错误，请检查 NapCat 和 token。'); });
    socket.addEventListener('message', async event => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const data = parseJSON(String(event.data));
        if (data.echo && this.pending.has(data.echo)) {
          const pending = this.pending.get(data.echo);
          this.pending.delete(data.echo); clearTimeout(pending.timer);
          if (data.status === 'ok' && Number(data.retcode) === 0) pending.resolve(data.data);
          else pending.reject(Object.assign(new Error(`QQ API 请求未完成，retcode=${Number(data.retcode)}`), { code: 'QQ_API_FAILED', retcode: Number(data.retcode), deliveryUnknown: /timeout|超时|timed.?out|onMsgInfoListUpdate/iu.test(String(data.message || '') + ' ' + String(data.wording || '')) }));
        } else if (data.post_type) await this.onEvent(data);
      } catch { console.error('QQ 事件处理失败。'); }
    });
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      if (this.socket !== socket) return;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('QQ 连接断开。')); }
      this.pending.clear();
      if (!this.stopped) { console.error('QQ 连接断开，5 秒后重连。'); this.retry = setTimeout(() => this.connect(), 5000); }
    });
  }
  call(action, params, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error('QQ 尚未连接。'));
      const echo = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(echo); reject(Object.assign(new Error('QQ API 响应超时。'), { code: 'QQ_API_TIMEOUT', deliveryUnknown: true })); }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ action, params, echo }));
    });
  }
  async send(target, text, { replyTo, mention } = {}) {
    // 使用 text 消息段，避免将课程文字解析成 CQ 指令。
    const chunks = qqPlainText(text).match(/[\s\S]{1,1800}/gu) || [''];
    const sent = [];
    for (const [index, chunk] of chunks.entries()) {
      const prefix = [];
      if (target.group_id && index === 0) {
        if (/^-?\d{1,30}$/.test(String(replyTo))) prefix.push({ type: 'reply', data: { id: String(replyTo) } });
        if (/^\d{5,15}$/.test(String(mention))) prefix.push({ type: 'at', data: { qq: String(mention) } });
      }
      sent.push(await this.call(target.group_id ? 'send_group_msg' : 'send_private_msg', {
        ...target, message: [...prefix, { type: 'text', data: { text: (prefix.some(part => part.type === 'at') ? ' ' : '') + chunk } }],
      }));
    }
    return sent;
  }
  async sendSegments(target, parts, { replyTo, mention } = {}) {
    if (!Array.isArray(parts) || !parts.length || parts.length > 8) throw new Error('消息段数量无效。');
    const message = parts.map(part => {
      if (part.type === 'text') return { type: 'text', data: { text: qqPlainText(part.data?.text).slice(0, 1800) } };
      if (part.type === 'face' && /^\d{1,4}$/.test(String(part.data?.id))) return { type: 'face', data: { id: String(part.data.id) } };
      if (part.type === 'image') {
        const file = String(part.data?.file || '');
        if (file.startsWith('base64://')) imageType(decodeBase64(file.slice(9)));
        else mediaURL(file);
        return { type: 'image', data: { file, sub_type: part.data?.sub_type === 1 ? 1 : 0, summary: String(part.data?.summary || '').slice(0, 60) } };
      }
      if (part.type === 'record') {
        const file = String(part.data?.file || '');
        if (!file.startsWith('base64://')) throw new Error('语音只允许发送已生成的 WAV 数据。');
        validateWav(decodeBase64(file.slice(9), 16 * 1024 * 1024));
        return { type: 'record', data: { file } };
      }
      throw new Error('不支持或不安全的消息段。');
    });
    if (message.some(part => part.type === 'record') && message.length !== 1) throw new Error('QQ 语音须作为单独消息发送。');
    if (target.group_id && message[0].type !== 'record') {
      if (/^\d{5,15}$/.test(String(mention))) message.unshift({ type: 'at', data: { qq: String(mention) } });
      if (/^-?\d{1,30}$/.test(String(replyTo))) message.unshift({ type: 'reply', data: { id: String(replyTo) } });
    }
    const image = message.filter(part => part.type === 'image');
    const localImage = image.length === 1 && message.every(part => ['image','reply','at'].includes(part.type)) && image[0].data.file.startsWith('base64://');
    const historyAction = target.group_id ? 'get_group_msg_history' : 'get_friend_msg_history';
    const historyParams = { ...(target.group_id ? { group_id: target.group_id } : { user_id: target.user_id }), count: 12 };
    let snapshot, self;
    if (localImage) {
      try {
        const result = await Promise.all([this.call(historyAction, historyParams), this.call('get_login_info', {})]);
        snapshot = new Set((result[0]?.messages || []).map(row => String(row.message_id)));
        self = String(result[1]?.user_id || '');
      } catch { /* History is optional; inability to verify never triggers a retry. */ }
    }
    const started = Math.floor(Date.now() / 1000);
    try { return await this.call(target.group_id ? 'send_group_msg' : 'send_private_msg', { ...target, message }, { timeoutMs: 60000 }); }
    catch (error) {
      // QQ can store an image while its kernel callback times out. Recover only
      // a new, own-sender receipt with matching bytes; never resend on timeout.
      if (error.deliveryUnknown && localImage && snapshot && /^\d{5,15}$/.test(self)) {
        const digest = createHash('md5').update(decodeBase64(image[0].data.file.slice(9))).digest('hex');
        try {
          const history = await this.call(historyAction, historyParams);
          const matches = (history.messages || []).filter(row => row.message_id != null && !snapshot.has(String(row.message_id)) && String(row.user_id ?? row.sender?.user_id) === self && Number(row.time) >= started && Array.isArray(row.message) && row.message.some(part => part.type === 'image' && [part.data?.md5, part.data?.file].some(value => typeof value === 'string' && value.toLowerCase().match(/[a-f0-9]{32}/u)?.[0] === digest)));
          if (matches.length === 1) { reportDeliveryIssue('image_receipt_recovered'); return { message_id: matches[0].message_id }; }
        } catch { /* Preserve the original uncertain-delivery failure. */ }
      }
      throw error;
    }
  }
  close() { this.stopped = true; clearTimeout(this.retry); this.socket?.close(); }
}
