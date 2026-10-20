import { mkdir, mkdtemp, rm, writeFile, readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, isAbsolute, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { segments, contentText } from './message-content.mjs';
const execute = promisify(execFile);

function attachmentId(data) {
  const id = String(data.file_id || data.file || '');
  if (!id || id.length > 8000 || /[:\\]/.test(id) || id.startsWith('/') || id.includes('..')) throw new Error('无可用附件 ID');
  return id;
}
async function protocolFile(info, event) {
  const limit = 40 * 1024 * 1024;
  if (Number(info.file_size) > limit || String(info.base64 || '').length > Math.ceil(limit * 4 / 3) + 4) throw new Error('附件超过 40MB');
  if (info.base64) return Buffer.from(info.base64, 'base64');
  const path = await realpath(info.file);
  const roots = [fileURLToPath(new URL('../tools/napcat/', import.meta.url)), join(process.env.APPDATA || '', 'Tencent', 'QQ', 'nt_qq'), join(process.env.USERPROFILE || '', 'Documents', 'Tencent Files', String(event.self_id))];
  let allowed = false;
  for (const root of roots) {
    try { const rel = relative(await realpath(root), path); if (rel && !rel.startsWith('..') && !isAbsolute(rel)) allowed = true; } catch {}
  }
  if (!allowed || (await stat(path)).size > limit) throw new Error('附件不在 QQ 缓存内或超过限额');
  return readFile(path);
}

export function mediaURL(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(['qpic.cn', 'qlogo.cn', 'multimedia.nt.qq.com'].some(domain => host === domain || host.endsWith('.' + domain)) ||
      ['multimedia.nt.qq.com.cn', 'gxh.vip.qq.com'].includes(host))) throw new Error('图片地址不在 QQ 媒体范围。');
  return url;
}

export function stickerURL(data) {
  if (data.url) return data.url;
  // Same marketplace image layout used by NapCat's marketFaceElement adapter.
  const id = String(data.emoji_id || '');
  return /^[a-f\d]{32}$/i.test(id) ? `https://gxh.vip.qq.com/club/item/parcel/item/${id.slice(0, 2)}/${id}/raw300.gif` : null;
}
export function imageDimensions(bytes) {
  let width, height;
  if (bytes.length >= 24 && bytes[0] === 137 && bytes.toString('ascii', 1, 4) === 'PNG') { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
  else if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF') { width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); }
  else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (type === 'VP8 ') { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    else if (type === 'VP8L' && bytes[20] === 47) { const value = bytes.readUInt32LE(21); width = (value & 16383) + 1; height = (value >>> 14 & 16383) + 1; }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 255) { offset++; continue; }
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset + 2); if (length < 2) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += 2 + length;
    }
  }
  if (!width || !height || width * height > 40000000) throw new Error('图片尺寸无效或超过 4000 万像素。');
  return { width, height };
}
export async function fetchImage(value, fetcher = fetch) {
  let url = mediaURL(value);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = mediaURL(new URL(response.headers.get('location'), url)); continue; }
    if (!response.ok || Number(response.headers.get('content-length')) > 12 * 1024 * 1024) { await response.body?.cancel(); throw new Error('图片无法下载或超过 12MB。'); }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 12 * 1024 * 1024) throw new Error('图片超过 12MB。'); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216;
    const gif = /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6));
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !gif && !webp) throw new Error('不是支持的图片格式。');
    return bytes;
  }
  throw new Error('图片重定向过多。');
}

export class MessageMedia {
  constructor(bot, download = fetchImage) { this.bot = bot; this.download = download; }
  async prepare(event) {
    const images = [], notes = []; let folder;
    const ensureFolder = async () => { if (!folder) { const root = new URL('../data/message-media/', import.meta.url); await mkdir(root, { recursive: true }); folder = await mkdtemp(fileURLToPath(new URL('request-', root))); } return folder; };
    const queue = [...segments(event)].map(part => ({ part, depth: 0 }));
    try {
      for (let index = 0; index < queue.length && index < 60; index++) {
        const { part, depth } = queue[index]; const data = part.data || {};
        if (['image', 'mface'].includes(part.type)) {
          if (images.length >= 3) { notes.push('本条只查看前三张图片。'); continue; }
          try {
            let url = stickerURL(data);
            if (!url && (data.file || data.file_id)) url = (await this.bot.call('get_image', { file: data.file_id || data.file })).url;
            if (!url) throw new Error('无图片地址');
            const bytes = await this.download(url);
            imageDimensions(bytes);
            const image = await loadImage(bytes);
            if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('图片尺寸过大');
            const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
            const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            await ensureFolder();
            const path = join(folder, `image-${images.length + 1}.png`);
            await writeFile(path, await canvas.encode('png'));
            images.push({ path, source: '用户发送的图片或表情包', page: images.length + 1 });
            notes.push('附图为用户图片；动态表情目前查看首帧。');
          } catch { notes.push('这张图片暂未取得，不能编造图片内容。'); }
        } else if (part.type === 'reply' && depth < 1) {
          try {
            const message = await this.bot.call('get_msg', { message_id: data.id });
            const same = event.message_type === 'group' ? message.message_type === 'group' && String(message.group_id) === String(event.group_id) :
              message.message_type === 'private' && (String(message.user_id ?? message.sender?.user_id) === String(event.user_id) || String(message.target_id) === String(event.user_id) && String(message.user_id ?? message.sender?.user_id) === String(event.self_id));
            if (!same) { notes.push('引用不属于当前会话，未读取。'); continue; }
            notes.push('被引用内容：' + contentText(message));
            queue.push(...segments(message).map(part => ({ part, depth: depth + 1 })));
          } catch { notes.push('引用消息已失效或不可见。'); }
        } else if (['forward', 'node'].includes(part.type) && depth < 1) {
          try {
            const rows = Array.isArray(data.content) ? data.content : (await this.bot.call('get_forward_msg', { id: data.id })).messages;
            for (const row of (rows || []).slice(0, 12)) {
              const message = { message: row.message || row.content || [] };
              notes.push('转发内容：' + contentText(message));
              queue.push(...segments(message).map(part => ({ part, depth: depth + 1 })));
            }
          } catch { notes.push('合并转发暂时不可读取。'); }
        } else if (part.type === 'record' || part.type === 'video') {
          try {
            if (Number(data.file_size) > 40 * 1024 * 1024) throw new Error('附件过大');
            if (part.type === 'record' && depth === 0 && event.message_id) {
              try { const result = await this.bot.call('fetch_ptt_text', { message_id: event.message_id }); if (result.text?.trim()) { notes.push('QQ 语音转文字（可能有识别错误）：' + result.text.slice(0, 10000)); continue; } } catch {}
            }
            if (!process.env.MEDIA_PYTHON) throw new Error('本地解码尚未配置');
            const info = await this.bot.call(part.type === 'record' ? 'get_record' : 'get_file', { file_id: attachmentId(data), ...(part.type === 'record' ? { out_format: 'mp3' } : {}) });
            const attachmentFolder = join(await ensureFolder(), `media-${index}`);
            await mkdir(attachmentFolder, { recursive: true });
            const path = join(attachmentFolder, `attachment.${part.type === 'video' ? 'mp4' : 'mp3'}`);
            await writeFile(path, await protocolFile(info, event));
            const { stdout } = await execute(process.env.MEDIA_PYTHON, [fileURLToPath(new URL('../scripts/media-worker.py', import.meta.url)), path, part.type], { windowsHide: true, shell: false, timeout: 180000, maxBuffer: 1024 * 1024 });
            const result = JSON.parse(stdout.slice(stdout.lastIndexOf('BUPT_MEDIA_JSON:') + 16));
            notes.push('本地识别（可能有错误）：' + (result.text || '未检测到语音。') + '\n' + result.note);
            for (const path of result.frames || []) if (images.length < 3) images.push({ path, source: '用户视频抽帧', page: images.length + 1 });
          } catch { notes.push(part.type === 'record' ? '语音转文字未成功，不能假装听过。' : '视频解码或识别未成功，不能假装看过。'); }
        } else if (part.type === 'file') {
          try {
            const extension = extname(String(data.name || '')).toLowerCase();
            if (Number(data.file_size) > 40 * 1024 * 1024) throw new Error('附件过大');
            const supported = ['.txt', '.md', '.csv', '.json', '.log', '.py', '.js', '.ts', '.html', '.xml', '.yaml', '.yml', '.pdf', '.ppt', '.pptx'];
            if (!supported.includes(extension)) throw new Error('文件格式不支持');
            const info = await this.bot.call('get_file', { file_id: attachmentId(data) });
            const bytes = await protocolFile(info, event);
            if (!['.pdf', '.ppt', '.pptx'].includes(extension)) { notes.push('用户发送的文件 ' + String(data.name).slice(0, 150) + '：\n' + bytes.toString('utf8', 0, 24000)); continue; }
            const path = join(await ensureFolder(), `document-${index}${extension}`);
            await writeFile(path, bytes);
            const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('../scripts/extract-document.mjs', import.meta.url)), path], { windowsHide: true, shell: false, timeout: 120000, maxBuffer: 48 * 1024 * 1024 });
            const result = JSON.parse(stdout.slice(stdout.lastIndexOf('BUPT_DOCUMENT_JSON:') + 19));
            notes.push('用户文件 ' + String(data.name).slice(0, 150) + ' 的文字（最多取前12000字）：\n' + result.pages.map(page => `位置${page.num}：${page.text}`).join('\n').slice(0, 12000));
          } catch { notes.push('文件正文暂不可读取（格式、大小或下载受限），不能假装读过。'); }
        }
      }
      return { images, notes: notes.join('\n').slice(0, 14000), cleanup: async () => { if (folder) await rm(folder, { recursive: true, force: true }); } };
    } catch (error) { if (folder) await rm(folder, { recursive: true, force: true }); throw error; }
  }
}
