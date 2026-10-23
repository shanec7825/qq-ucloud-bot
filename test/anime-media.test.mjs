import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineMedia, ONLINE_MEDIA } from '../src/online-media.mjs';

test('the anime catalog has hundreds of distinct, attributable assets from fixed public image hosts', () => {
  const rows = ONLINE_MEDIA.filter(row => row.category === '日系动漫');
  assert.ok(rows.length >= 300); assert.ok(new Set(rows.map(row => row.pack)).size >= 15);
  assert.equal(new Set(ONLINE_MEDIA.map(row => row.id)).size, ONLINE_MEDIA.length);
  for (const row of rows) {
    const image = new URL(row.imageURL), source = new URL(row.sourceURL);
    assert.equal(image.protocol, 'https:'); assert.match(image.hostname, /^i[0-2]\.hdslb\.com$/);
    assert.equal(source.hostname, 'github.com'); assert.ok(row.name.length <= 60);
    assert.ok(Array.isArray(row.tags));
  }
});

test('anime import deduplicates requests and preserves the mood/pack metadata for chat selection', async () => {
  const row = ONLINE_MEDIA.find(row => row.category === '日系动漫' && row.tags.includes('安慰'));
  const saved = []; let requests = 0;
  const online = new OnlineMedia({ list: async () => saved, put: async input => { const item = { ...input, id: 'local-id', scope: '*:account:' }; saved.push(item); return item; } }, async (url, options) => {
    requests++; assert.equal(url, row.imageURL); assert.equal(options.redirect, 'error');
    return new Response(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  });
  const [first, second] = await Promise.all([online.add(row.id), online.add(row.id)]);
  assert.equal(first, second); assert.equal(requests, 1); assert.equal(first.source.pack, row.pack);
  assert.deepEqual(first.source.tags, row.tags); assert.deepEqual(first.source.aliases, row.aliases);
  assert.equal((await online.catalog()).find(item => item.id === row.id).saved, true);
  await online.add(row.id); assert.equal(requests, 1);
  assert.throws(() => online.add('https://127.0.0.1/private')); assert.equal(requests, 1);
});

test('failed or invalid image responses never enter the persistent anime library', async () => {
  const row = ONLINE_MEDIA.find(row => row.category === '日系动漫'); let writes = 0;
  for (const response of [new Response('bad', { status: 503 }), new Response('<svg/>'), new Response('bad', { headers: { 'content-length': String(9 * 1024 * 1024) } })]) {
    const online = new OnlineMedia({ list: async () => [], put: async () => { writes++; } }, async () => response);
    await assert.rejects(() => online.add(row.id));
  }
  assert.equal(writes, 0);
});
