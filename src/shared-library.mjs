import { realpath, readdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readJSON, saveJSON } from './core.mjs';
const execute = promisify(execFile);
const supported = new Set(['.pdf', '.pptx', '.ppt', '.txt', '.md']);

export function inside(root, target) {
  const rel = relative(root, target);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}
export function searchTerms(text) {
  const terms = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(String(text).toLowerCase())].filter(part => part.isWordLike && part.segment.length >= 2).map(part => part.segment);
  for (const [word, aliases] of Object.entries({ 偏序: ['partial', 'ordering', 'poset'], 等价: ['equivalence', 'relation'], 关系: ['relation'], 图论: ['graph'], 树: ['tree'], 竞赛: ['竞赛'], 第九章: ['9.'], 第十一章: ['chap11'] })) if (text.includes(word)) terms.push(...aliases);
  return [...new Set(terms)].filter(term => !['什么', '怎么', '一下', '帮我', '这个', '那个', '教材', '书上', '里面', 'pdf', 'pdfs', '解释'].includes(term));
}
export function rankPages(documents, question) {
  const terms = searchTerms(question);
  const matches = [];
  for (const document of documents) for (const page of document.pages || []) {
    const text = String(page.text || ''); const lower = text.toLowerCase(); const name = document.name.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 2 : 0) + (name.includes(term) ? 3 : 0), 0);
    if (score > 0 && text.trim()) {
      const position = Math.max(0, lower.indexOf(terms.find(term => lower.includes(term)) || ''));
      matches.push({ source: document.name, page: page.num, score, excerpt: text.slice(Math.max(0, position - 300), position + 1800) });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 6);
}

export class SharedLibrary {
  constructor(root, cache = new URL('../data/shared-library/', import.meta.url)) { this.root = root; this.cache = cache; this.indexFile = new URL('index.json', cache); }
  async scan() {
    if (!this.root) return [];
    const root = await realpath(this.root); const files = [];
    const visit = async (directory, depth) => {
      if (depth > 6) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path, depth + 1);
        else if (entry.isFile() && supported.has(extname(entry.name).toLowerCase())) {
          const actual = await realpath(path);
          if (!inside(root, actual)) continue;
          const info = await stat(actual);
          files.push({ id: createHash('sha256').update(relative(root, actual)).digest('hex').slice(0, 20), name: relative(root, actual), size: info.size, modified: info.mtimeMs });
        }
      }
    };
    await visit(root, 0);
    await saveJSON(this.indexFile, { root, files, updatedAt: new Date().toISOString() });
    return files;
  }
  async files() {
    const index = await readJSON(this.indexFile, null);
    if (!index) return this.scan();
    const root = await realpath(this.root);
    return index.root === root ? index.files : this.scan();
  }
  async document(id) {
    const files = await this.files();
    const file = files.find(entry => entry.id === id);
    if (!file) throw new Error('该文件不在公开的 pdfs 范围。');
    const root = await realpath(this.root); const path = await realpath(resolve(root, file.name));
    if (!inside(root, path)) throw new Error('文件超出公开目录。');
    const info = await stat(path);
    if (info.size > 150 * 1024 * 1024) throw new Error('文件过大，暂不自动解析。');
    const cacheFile = new URL(file.id + '.json', this.cache);
    const cached = await readJSON(cacheFile, null);
    if (cached?.modified === info.mtimeMs && cached?.size === info.size && cached.pages?.length) return cached;
    const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('../scripts/extract-document.mjs', import.meta.url)), path], { windowsHide: true, shell: false, timeout: 180000, maxBuffer: 48 * 1024 * 1024 });
    const marker = 'BUPT_DOCUMENT_JSON:';
    const start = stdout.lastIndexOf(marker);
    if (start < 0) throw new Error('文件解析没有返回有效结果。');
    const data = JSON.parse(stdout.slice(start + marker.length));
    const document = { id: file.id, name: file.name, size: info.size, modified: info.mtimeMs, pages: data.pages };
    await saveJSON(cacheFile, document);
    return document;
  }
  async search(question) {
    const files = await this.scan();
    const documents = [];
    for (const file of files) {
      const cached = await readJSON(new URL(file.id + '.json', this.cache), null);
      if (cached?.modified === file.modified && cached.size === file.size) documents.push(cached);
    }
    const requestedPage = question.match(/第\s*(\d{1,4})\s*页|[pP]\.?\s*(\d{1,4})\b/u);
    const images = [];
    if (requestedPage) {
      const terms = searchTerms(question);
      const ranked = files.filter(file => extname(file.name).toLowerCase() === '.pdf').map(file => ({ file, score: terms.filter(term => file.name.toLowerCase().includes(term)).length })).sort((a, b) => b.score - a.score);
      if (ranked[0]?.score > 0 && (!ranked[1] || ranked[0].score > ranked[1].score)) {
        const file = ranked[0].file, page = Number(requestedPage[1] || requestedPage[2]);
        const actualRoot = await realpath(this.root), path = await realpath(resolve(actualRoot, file.name));
        if (!inside(actualRoot, path)) throw new Error('文件超出公开目录。');
        const imageFile = new URL(`${file.id}-${file.modified}-${page}.png`, this.cache);
        try { await stat(imageFile); }
        catch { await execute(process.execPath, [fileURLToPath(new URL('../scripts/extract-document.mjs', import.meta.url)), path, '--render', String(page), fileURLToPath(imageFile)], { windowsHide: true, shell: false, timeout: 90000, maxBuffer: 1024 * 1024 }); }
        images.push({ path: fileURLToPath(imageFile), source: file.name, page });
      }
    }
    const passages = images.length ? [] : rankPages(documents, question);
    return { available: files.map(file => ({ id: file.id, name: file.name, textAvailable: (documents.find(document => document.id === file.id)?.pages || []).some(page => page.text.trim()) })), indexed: documents.length, passages, images };
  }
}
