import { imageType, IMAGE_LIMIT } from './outgoing-media.mjs';
import animeCatalog from './anime-media-catalog.json' with { type: 'json' };
import { mediaTags } from './media-selection.mjs';

// Curated public templates. Chat text, user queries and credentials never enter these URLs.
const examples = [
  ['success', '成功了', 'success', ['DID THE THING', 'IT WORKED']],
  ['fine', '问题不大', 'fine', ['THIS IS FINE']],
  ['drake', '选这个', 'drake', ['OVERTHINKING', 'TRYING IT']],
  ['both', '我全都要', 'both', ['TEXT OR VOICE', 'WHY NOT BOTH']],
  ['aag', '神秘原因', 'aag', ['I HAVE A THEORY', 'ALIENS']],
  ['ds', '纠结中', 'ds', ['SLEEP EARLY', 'ONE MORE EPISODE', 'ME']],
  ['blb', '运气不佳', 'blb', ['FINALLY REMEMBERS', 'FORGETS WHY']],
  ['wonka', '展开说说', 'wonka', ['OH REALLY', 'TELL ME MORE']],
  ['fry', '有点疑惑', 'fry', ['NOT SURE IF GENIUS', 'OR JUST LUCKY']],
  ['buzz', '到处都是', 'buzz', ['DEADLINES', 'DEADLINES EVERYWHERE']],
  ['disaster', '淡定围观', 'disastergirl', ['JUST ONE SMALL CHANGE']],
  ['doge', '好耶', 'doge', ['SUCH PROGRESS', 'VERY WOW']],
];
export const ONLINE_MEDIA = Object.freeze([...examples.map(([id, name, template, lines]) => Object.freeze({
  id, name, type: 'sticker', category: '其他风格', pack: '通用梗图', tags: mediaTags(name), source: 'Memegen.link', sourceURL: 'https://memegen.link/',
  imageURL: 'https://api.memegen.link/images/' + template + '/' + lines.map(line => encodeURIComponent(line.replaceAll(' ', '_'))).join('/') + '.png?width=480',
})), ...animeCatalog.packs.flatMap(pack => pack.items.map(item => Object.freeze({
  ...item, type: 'sticker', category: '日系动漫', pack: pack.name, aliases: pack.aliases,
  tags: mediaTags(item.name.split('·').slice(1).join('·')), source: animeCatalog.source, sourceURL: pack.sourceURL,
})))]);

export class OnlineMedia {
  constructor(media, fetcher = fetch) { this.media = media; this.fetcher = fetcher; this.pending = new Map(); }
  async catalog() {
    const saved = await this.media.list();
    return ONLINE_MEDIA.map(row => ({ ...row, saved: saved.some(item => item.source?.id === row.id && item.scope === '*:account:') }));
  }
  add(id) {
    const row = ONLINE_MEDIA.find(item => item.id === id);
    if (!row) throw new Error('请选择图库中的素材。');
    if (this.pending.has(id)) return this.pending.get(id);
    const work = this.import(row).finally(() => this.pending.delete(id));
    this.pending.set(id, work); return work;
  }
  async import(row) {
    const previous = (await this.media.list()).find(item => item.source?.id === row.id && item.scope === '*:account:');
    if (previous) return previous;
    const response = await this.fetcher(row.imageURL, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'image/png,image/gif,image/webp' } });
    if (!response.ok || Number(response.headers.get('content-length')) > IMAGE_LIMIT) { await response.body?.cancel(); throw new Error('在线素材暂不可用，请稍后重试。'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('在线素材未返回图片。');
    const parts = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > IMAGE_LIMIT) throw new Error('在线素材超过大小限制。'); parts.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(parts); imageType(bytes);
    return this.media.put({ accountId: '*', kind: 'account', targetId: '', name: row.name, type: row.type, base64: bytes.toString('base64'), source: { id: row.id, name: row.source, url: row.sourceURL, imageURL: row.imageURL, pack: row.pack, tags: row.tags, ...(row.aliases ? { aliases: row.aliases } : {}) } });
  }
}
