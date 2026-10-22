import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readJSON, saveJSON } from './core.mjs';
import { imageDimensions, fetchImage, stickerURL } from './message-media.mjs';
import { segments } from './message-content.mjs';

export const IMAGE_LIMIT = 8 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export function decodeBase64(value, limit = IMAGE_LIMIT) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('文件编码无效或文件过大。');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== value) throw new Error('文件编码无效或文件过大。');
  return bytes;
}
export function imageType(bytes) {
  let type;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'jpeg';
  else if (/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) type = 'gif';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') type = 'webp';
  if (!type || !bytes.length || bytes.length > IMAGE_LIMIT) throw new Error('仅支持 8MB 以内的 PNG、JPEG、GIF 和 WebP。');
  imageDimensions(bytes);
  return type;
}
export function mediaScope(input) {
  if (!input || typeof input.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(input.accountId) || !['account','group','private'].includes(input.kind) || (input.kind === 'account' ? input.targetId !== '' : !/^\d{5,15}$/.test(input.targetId))) throw new Error('请选择有效的 QQ 账号和素材使用范围。');
  return `${input.accountId}:${input.kind}:${input.targetId}`;
}
const eventScope = event => ({ accountId: event.accountId || 'default', kind: event.message_type, targetId: String(event.message_type === 'group' ? event.group_id : event.user_id) });

export class OutgoingMedia {
  constructor(root = new URL('../data/', import.meta.url), download = fetchImage) {
    this.root = new URL('outgoing-media/', root); this.index = new URL('index.json', this.root); this.download = download; this.queue = Promise.resolve();
  }
  async list() { return readJSON(this.index, []); }
  async available(event) {
    const scope = mediaScope(eventScope(event)), shared = `${event.accountId || 'default'}:account:`;
    return (await this.list()).filter(item => item.scope === scope || item.scope === shared);
  }
  mutate(work) { const pending = this.queue.catch(() => {}).then(work); this.queue = pending; return pending; }
  put(input) {
    return this.mutate(async () => {
      const scope = mediaScope(input);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || /[\x00-\x1f]/.test(input.name) || !['image','sticker'].includes(input.type)) throw new Error('请填写 1–60 字名称，并选择图片或表情包。');
      const bytes = decodeBase64(input.base64), mime = imageType(bytes), rows = await this.list();
      if (rows.length >= 200 || rows.reduce((sum, row) => sum + row.size, 0) + bytes.length > 200 * 1024 * 1024) throw new Error('素材库已达到 200 个或 200MB 上限，请先移除不需要的素材。');
      const item = { id: randomUUID().replaceAll('-', ''), scope, accountId: input.accountId, kind: input.kind, targetId: input.targetId, name: input.name.trim(), type: input.type, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() };
      await mkdir(this.root, { recursive: true });
      const file = new URL(item.id, this.root);
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      try { await saveJSON(this.index, [...rows, item]); } catch (error) { await unlink(file); throw error; }
      return item;
    });
  }
  remove(id) {
    if (!validId(id)) throw new Error('素材编号无效。');
    return this.mutate(async () => {
      const rows = await this.list();
      if (!rows.some(item => item.id === id)) throw new Error('素材已不存在，请刷新。');
      const file = new URL(id, this.root), backup = await readFile(file);
      await unlink(file);
      try { await saveJSON(this.index, rows.filter(item => item.id !== id)); }
      catch (error) { await writeFile(file, backup, { flag: 'wx', mode: 0o600 }); throw error; }
    });
  }
  async bytes(id) {
    if (!validId(id)) throw new Error('素材编号无效。');
    const item = (await this.list()).find(item => item.id === id);
    if (!item) throw new Error('素材已不存在，请刷新。');
    const file = new URL(id, this.root);
    if ((await stat(file)).size > IMAGE_LIMIT) throw new Error('素材文件超过 8MB，请重新上传。');
    const bytes = await readFile(file);
    imageType(bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('素材文件已改变，请重新上传。');
    return { item, bytes };
  }
  async outgoing(event, id) {
    if (!(await this.available(event)).some(item => item.id === id)) throw new Error('此素材不属于当前账号或会话。');
    const { item, bytes } = await this.bytes(id);
    return { type: 'image', data: { file: 'base64://' + bytes.toString('base64'), summary: item.name, sub_type: item.type === 'sticker' ? 1 : 0 } };
  }
  async collect(event, { name, type }, bot) {
    let parts = segments(event);
    if (!parts.some(part => ['image','mface'].includes(part.type))) {
      const reply = parts.find(part => part.type === 'reply');
      if (reply) {
        const quoted = await bot.call('get_msg', { message_id: reply.data.id });
        const same = event.message_type === 'group' ? quoted.message_type === 'group' && String(quoted.group_id) === String(event.group_id) : quoted.message_type === 'private' && (String(quoted.user_id ?? quoted.sender?.user_id) === String(event.user_id) || String(quoted.target_id) === String(event.user_id) && String(quoted.user_id ?? quoted.sender?.user_id) === String(event.self_id));
        if (!same) throw new Error('只能收藏当前会话中的图片。');
        parts = segments(quoted);
      }
    }
    const part = parts.find(part => ['image','mface'].includes(part.type));
    if (!part) throw new Error('请附上图片，或引用一张图片后发送 /收藏图片 名称 或 /收藏表情包 名称。');
    let url = stickerURL(part.data || {});
    if (!url && (part.data?.file_id || part.data?.file)) url = (await bot.call('get_image', { file: part.data.file_id || part.data.file })).url;
    const bytes = await this.download(url);
    return this.put({ ...eventScope(event), name, type, base64: bytes.toString('base64') });
  }
}
