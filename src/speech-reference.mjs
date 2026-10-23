import { mkdir, readFile, writeFile, unlink, stat, rename } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { saveJSON } from './core.mjs';
import { decodeBase64 } from './outgoing-media.mjs';
import { validateWav } from './xiaomi-speech.mjs';

// MiMo caps the encoded reference, so the decoded upload limit is about 7.5 MiB.
export const SPEECH_REFERENCE_BASE64_LIMIT = 10 * 1024 * 1024;
export const SPEECH_REFERENCE_BYTES_LIMIT = SPEECH_REFERENCE_BASE64_LIMIT / 4 * 3;
export const SPEECH_REFERENCE_CHUNK_SIZE = 64 * 1024;
export const SPEECH_REFERENCE_UPLOAD_TTL = 5 * 60 * 1000;
const validUploadId = id => typeof id === 'string' && /^upload_[a-f0-9]{48}$/.test(id);
const validId = id => typeof id === 'string' && /^ref_[a-f0-9]{64}$/.test(id);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invalidAudio = () => new Error('请上传有效的 WAV 或 MP3 参考音频，Base64 编码不得超过 10MB（原文件约 7.5MB）。');
function referenceName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('参考音频名称须为 1–120 字。');
  return name.trim();
}

function mp3FrameSize(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return 0;
  const version = (bytes[offset + 1] >> 3) & 3, layer = (bytes[offset + 1] >> 1) & 3;
  const rateIndex = bytes[offset + 2] >> 4, frequencyIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || rateIndex < 1 || rateIndex > 14 || frequencyIndex === 3) return 0;
  const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[rateIndex] * 1000;
  const frequency = [44100,48000,32000][frequencyIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  return Math.floor((version === 3 ? 144 : 72) * bitrate / frequency) + ((bytes[offset + 2] >> 1) & 1);
}

export function speechReferenceType(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > SPEECH_REFERENCE_BYTES_LIMIT) throw invalidAudio();
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    try { validateWav(bytes); } catch { throw invalidAudio(); }
    return 'audio/wav';
  }
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    if (bytes.length < 10 || ![2,3,4].includes(bytes[3]) || bytes.subarray(6, 10).some(value => value & 0x80)) throw invalidAudio();
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes[3] === 4 && (bytes[5] & 0x10)) offset += 10;
  }
  const frameSize = mp3FrameSize(bytes, offset);
  if (!frameSize || offset + frameSize > bytes.length) throw invalidAudio();
  return 'audio/mpeg';
}

export class SpeechReferenceStore {
  constructor(root = new URL('../data/', import.meta.url), { now = Date.now } = {}) {
    this.root = new URL('speech-references/', root);
    this.index = new URL('index.json', this.root);
    this.queue = Promise.resolve();
    this.uploads = new Map(); this.now = now;
  }
  pruneUploads() {
    const now = this.now();
    for (const [id, upload] of this.uploads) if (!upload.finishing && upload.expires <= now) this.removeUpload(id);
  }
  removeUpload(uploadId) {
    clearTimeout(this.uploads.get(uploadId)?.expiryTimer);
    this.uploads.delete(uploadId);
  }
  upload(uploadId) {
    this.pruneUploads();
    if (!validUploadId(uploadId) || !this.uploads.has(uploadId)) throw new Error('参考音频上传不存在或已超过 5 分钟，请重新选择文件。');
    const upload = this.uploads.get(uploadId);
    if (upload.finishing) throw new Error('参考音频正在保存，请稍后再试。');
    return upload;
  }
  startUpload({ name, size } = {}) {
    name = referenceName(name);
    if (!Number.isInteger(size) || size < 1 || size > SPEECH_REFERENCE_BYTES_LIMIT) throw invalidAudio();
    this.pruneUploads();
    if (this.uploads.size >= 4) throw new Error('同时最多上传 4 个参考音频，请完成或取消其他上传后重试。');
    const uploadId = 'upload_' + randomBytes(24).toString('hex');
    const expires = this.now() + SPEECH_REFERENCE_UPLOAD_TTL;
    const expiryTimer = setTimeout(() => this.pruneUploads(), SPEECH_REFERENCE_UPLOAD_TTL); expiryTimer.unref();
    this.uploads.set(uploadId, { name, size, encodedSize: Math.ceil(size / 3) * 4, chunks: [], receivedBytes: 0, expires, finishing: false, expiryTimer });
    return { uploadId };
  }
  chunkUpload({ uploadId, index, base64 } = {}) {
    const upload = this.upload(uploadId);
    if (!Number.isInteger(index) || index < 0 || index !== upload.chunks.length) throw new Error('参考音频分块顺序无效，请重新选择文件。');
    const remaining = upload.encodedSize - index * SPEECH_REFERENCE_CHUNK_SIZE;
    const expected = Math.min(SPEECH_REFERENCE_CHUNK_SIZE, remaining);
    if (remaining <= 0 || expected > SPEECH_REFERENCE_BASE64_LIMIT || typeof base64 !== 'string' || base64.length !== expected || expected % 4 || remaining > expected && base64.includes('=')) throw new Error('参考音频分块大小无效，请重新选择文件。');
    let bytes;
    try { bytes = decodeBase64(base64, SPEECH_REFERENCE_CHUNK_SIZE / 4 * 3); }
    catch { throw new Error('参考音频分块编码无效，请重新选择文件。'); }
    const expectedBytes = Math.min(SPEECH_REFERENCE_CHUNK_SIZE / 4 * 3, upload.size - upload.receivedBytes);
    if (bytes.length !== expectedBytes || upload.receivedBytes + bytes.length > upload.size) throw new Error('参考音频大小与声明不一致，请重新选择文件。');
    upload.chunks.push(base64); upload.receivedBytes += bytes.length;
    return { nextIndex: upload.chunks.length };
  }
  async finishUpload({ uploadId } = {}) {
    const upload = this.upload(uploadId);
    if (upload.receivedBytes !== upload.size || upload.chunks.length !== Math.ceil(upload.encodedSize / SPEECH_REFERENCE_CHUNK_SIZE)) throw new Error('参考音频尚未上传完整，请重新选择文件。');
    const base64 = upload.chunks.join('');
    if (base64.length !== upload.encodedSize || base64.length > SPEECH_REFERENCE_BASE64_LIMIT) throw invalidAudio();
    upload.finishing = true; upload.chunks = [];
    try { return await this.put({ name: upload.name, base64 }); }
    finally { this.removeUpload(uploadId); }
  }
  cancelUpload({ uploadId } = {}) {
    if (!validUploadId(uploadId)) throw new Error('参考音频上传身份无效。');
    this.pruneUploads();
    if (!this.uploads.get(uploadId)?.finishing) this.removeUpload(uploadId);
    return { ok: true };
  }
  async list() {
    let rows;
    try { rows = JSON.parse(await readFile(this.index, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('参考音频索引无法读取，请重新检查本机音频库。'); }
    if (!Array.isArray(rows) || rows.some(row => !row || !validId(row.id) || typeof row.name !== 'string' || !['audio/wav','audio/mpeg'].includes(row.mime) || !Number.isInteger(row.size) || row.size < 1 || row.size > SPEECH_REFERENCE_BYTES_LIMIT)) throw new Error('参考音频索引无效，请重新检查本机音频库。');
    return rows.map(({ id, name, mime, size }) => ({ id, name, mime, size }));
  }
  async replaceBytes(id, bytes) {
    // Only a content-derived identity reaches this path; uploaded names are metadata.
    if (!validId(id) || digest(bytes) !== id.slice(4)) throw new Error('参考音频身份校验失败。');
    await mkdir(this.root, { recursive: true });
    const temporary = new URL(id + '.' + randomBytes(12).toString('hex') + '.tmp', this.root);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, new URL(id, this.root));
    } catch {
      await unlink(temporary).catch(() => {});
      throw new Error('参考音频无法恢复，请检查本机数据目录。');
    }
  }
  put({ name, base64 } = {}) {
    const pending = this.queue.catch(() => {}).then(async () => {
      name = referenceName(name);
      if (typeof base64 !== 'string' || base64.length > SPEECH_REFERENCE_BASE64_LIMIT) throw invalidAudio();
      let bytes;
      try { bytes = decodeBase64(base64, SPEECH_REFERENCE_BYTES_LIMIT); } catch { throw invalidAudio(); }
      const mime = speechReferenceType(bytes), id = 'ref_' + digest(bytes), rows = await this.list();
      const existing = rows.find(row => row.id === id);
      if (existing) {
        try { await this.bytes(id); }
        catch {
          await this.replaceBytes(id, bytes);
          if (existing.mime !== mime || existing.size !== bytes.length) {
            existing.mime = mime; existing.size = bytes.length;
            try { await saveJSON(this.index, rows); }
            catch { throw new Error('参考音频索引无法保存，请检查本机数据目录。'); }
          }
        }
        return existing;
      }
      if (rows.length >= 100 || rows.reduce((total, row) => total + row.size, 0) + bytes.length > 200 * 1024 * 1024) throw new Error('参考音频库已达到 100 个或 200MB 上限。');
      const reference = { id, name: name.trim(), mime, size: bytes.length };
      await mkdir(this.root, { recursive: true });
      const file = new URL(id, this.root); let created = false;
      try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); created = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw new Error('参考音频无法保存，请检查本机数据目录。');
        const info = await stat(file);
        if (!info.isFile() || info.size !== bytes.length || digest(await readFile(file)) !== id.slice(4)) await this.replaceBytes(id, bytes);
      }
      try { await saveJSON(this.index, [...rows, reference]); }
      catch { if (created) await unlink(file).catch(() => {}); throw new Error('参考音频索引无法保存，请检查本机数据目录。'); }
      return reference;
    });
    this.queue = pending;
    return pending;
  }
  async bytes(id) {
    if (!validId(id)) throw new Error('请选择已上传的参考音频。');
    const reference = (await this.list()).find(row => row.id === id);
    if (!reference) throw new Error('参考音频不存在，请重新上传后保存。');
    let bytes;
    try {
      const file = new URL(id, this.root), info = await stat(file);
      if (!info.isFile() || info.size !== reference.size) throw new Error();
      bytes = await readFile(file);
    } catch { throw new Error('参考音频文件已丢失或损坏，请重新上传后保存。'); }
    if (digest(bytes) !== id.slice(4) || speechReferenceType(bytes) !== reference.mime) throw new Error('参考音频文件校验失败，请重新上传后保存。');
    return { reference, bytes };
  }
  async preview(id) {
    const { reference, bytes } = await this.bytes(id);
    return { reference, dataURL: `data:${reference.mime};base64,${bytes.toString('base64')}` };
  }
  async dataURL(id) { return (await this.preview(id)).dataURL; }
}
