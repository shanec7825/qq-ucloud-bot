import { writeFile } from 'node:fs/promises';
import { OutgoingMedia } from '../src/outgoing-media.mjs';
import { OnlineMedia, ONLINE_MEDIA } from '../src/online-media.mjs';

if (!process.argv.includes('--enable') && !process.argv.includes('--verify')) {
  console.log('使用 --enable 下载并启用动漫素材；使用 --verify 仅核验已下载文件。');
} else {
  const library = new OutgoingMedia(), online = new OnlineMedia(library);
  const rows = ONLINE_MEDIA.filter(row => row.category === '日系动漫'), saved = await library.list();
  const results = []; let position = 0;
  async function worker() {
    while (position < rows.length) {
      const row = rows[position++];
      try {
        const previous = saved.find(item => item.source?.id === row.id && item.scope === '*:account:');
        const item = previous || (process.argv.includes('--enable') ? await online.add(row.id) : null);
        if (!item) throw Error('尚未下载');
        await library.bytes(item.id);
        results.push({ id: row.id, name: row.name, pack: row.pack, size: item.size, mime: item.mime, sha256: item.sha256, ok: true });
      } catch (error) { results.push({ id: row.id, name: row.name, pack: row.pack, ok: false, error: error.message }); }
      if (results.length % 40 === 0 || results.length === rows.length) console.log(JSON.stringify({ completed: results.length, total: rows.length, failed: results.filter(row => !row.ok).length }));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const report = { checkedAt: new Date().toISOString(), total: rows.length, verified: results.filter(row => row.ok).length,
    bytes: results.reduce((total, row) => total + (row.size || 0), 0), packs: [...new Set(rows.map(row => row.pack))], results };
  await writeFile(new URL('../data/anime-media-import.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ total: report.total, verified: report.verified, packs: report.packs.length, bytes: report.bytes, failed: results.filter(row => !row.ok).map(({ id, error }) => ({ id, error })) }));
  if (report.verified !== report.total) process.exitCode = 1;
}
