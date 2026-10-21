import { randomUUID } from 'node:crypto';
import { parseJSON } from './core.mjs';
import { qqPlainText } from './qq-output.mjs';
import { mediaURL } from './message-media.mjs';

export class OneBot {
  constructor(address, token, onEvent) {
    const url = new URL(address);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('ONEBOT_WS_URL 必须为 ws/wss 地址。');
    if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('远程 OneBot 连接请使用 wss。');
    if (token) url.searchParams.set('access_token', token);
    this.url = url; this.onEvent = onEvent; this.pending = new Map(); this.stopped = false;
  }
  connect() {
    if (this.stopped) return;
    const socket = this.socket = new WebSocket(this.url);
    const timeout = setTimeout(() => socket.close(), 15000);
    socket.addEventListener('open', () => { clearTimeout(timeout); console.log('QQ 协议端已连接。'); });
    socket.addEventListener('error', () => console.error('QQ 连接错误，请检查 NapCat 和 token。'));
    socket.addEventListener('message', async event => {
      try {
        const data = parseJSON(String(event.data));
        if (data.echo && this.pending.has(data.echo)) {
          const pending = this.pending.get(data.echo);
          this.pending.delete(data.echo); clearTimeout(pending.timer);
          if (data.status === 'ok' && Number(data.retcode) === 0) pending.resolve(data.data);
          else pending.reject(new Error(`QQ API 失败，retcode=${data.retcode}`));
        } else if (data.post_type) await this.onEvent(data);
      } catch { console.error('QQ 事件处理失败。'); }
    });
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('QQ 连接断开。')); }
      this.pending.clear();
      if (!this.stopped) { console.error('QQ 连接断开，5 秒后重连。'); this.retry = setTimeout(() => this.connect(), 5000); }
    });
  }
  call(action, params) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error('QQ 尚未连接。'));
      const echo = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error('QQ API 响应超时；下次轮询可能重试。')); }, 15000);
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
  async sendSegments(target, parts) {
    if (!Array.isArray(parts) || !parts.length || parts.length > 8) throw new Error('消息段数量无效。');
    const message = parts.map(part => {
      if (part.type === 'text') return { type: 'text', data: { text: qqPlainText(part.data?.text).slice(0, 1800) } };
      if (part.type === 'face' && /^\d{1,4}$/.test(String(part.data?.id))) return { type: 'face', data: { id: String(part.data.id) } };
      if (part.type === 'image') return { type: 'image', data: { file: mediaURL(part.data?.file).href } };
      throw new Error('不支持或不安全的消息段。');
    });
    return this.call(target.group_id ? 'send_group_msg' : 'send_private_msg', { ...target, message });
  }
  close() { this.stopped = true; clearTimeout(this.retry); this.socket?.close(); }
}
