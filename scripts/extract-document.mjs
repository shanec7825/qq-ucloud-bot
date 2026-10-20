import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PDFParse } from 'pdf-parse';
import { unzipSync, strFromU8 } from 'fflate';
import CFB from 'cfb';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const path = process.argv[2]; const data = await readFile(path); const ext = extname(path).toLowerCase();
let pages = [];
if (process.argv[3] === '--render') {
  const page = Number(process.argv[4]); const output = process.argv[5];
  if (!Number.isInteger(page) || page < 1 || page > 3000 || ext !== '.pdf') throw new Error('无效的 PDF 页码。');
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getScreenshot({ partial: [page], scale: 1.4 });
    if (!result.pages.length) throw new Error('页码超出范围。');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, result.pages[0].data);
    console.log('BUPT_DOCUMENT_JSON:' + JSON.stringify({ rendered: page }));
  } finally { await parser.destroy(); }
  process.exit(0);
}
if (ext === '.pdf') {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try { const result = await parser.getText(); pages = result.pages.map(page => ({ num: page.num, text: page.text })); }
  finally { await parser.destroy(); }
} else if (ext === '.pptx' || (ext === '.ppt' && data[0] === 0x50 && data[1] === 0x4b)) {
  const entries = unzipSync(data, { filter: file => /^ppt\/slides\/slide\d+\.xml$/.test(file.name) });
  pages = Object.keys(entries).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1])).map((name, index) => ({ num: index + 1, text: [...strFromU8(entries[name]).matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join('\n') }));
} else if (ext === '.ppt') {
  const document = CFB.read(data, { type: 'buffer' });
  const stream = CFB.find(document, 'PowerPoint Document');
  const bytes = Buffer.from(stream?.content || []); const texts = [];
  function walk(start, end, depth = 0) {
    if (depth > 30) return;
    for (let offset = start; offset + 8 <= end;) {
      const version = bytes.readUInt16LE(offset) & 15, kind = bytes.readUInt16LE(offset + 2), length = bytes.readUInt32LE(offset + 4), next = offset + 8 + length;
      if (next > end || next <= offset) break;
      if (version === 15) walk(offset + 8, next, depth + 1);
      else if ([4000, 4008, 4026].includes(kind)) texts.push(bytes.subarray(offset + 8, next).toString(kind === 4008 ? 'latin1' : 'utf16le'));
      offset = next;
    }
  }
  walk(0, bytes.length);
  pages = texts.filter(text => text.trim()).map((text, index) => ({ num: index + 1, text }));
} else pages = [{ num: 1, text: data.toString('utf8') }];
console.log('BUPT_DOCUMENT_JSON:' + JSON.stringify({ pages }));
