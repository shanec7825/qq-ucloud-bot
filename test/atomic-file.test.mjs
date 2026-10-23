import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceFile } from '../src/atomic-file.mjs';

test('a briefly locked index retries its atomic replacement with bounded waits', async () => {
  const waits = [], calls = []; let attempts = 0;
  await replaceFile('index.tmp', 'index.json', { renameFile: async (...args) => {
    calls.push(args);
    if (++attempts < 3) throw Object.assign(Error('locked'), { code: 'EPERM' });
  }, wait: async ms => waits.push(ms) });
  assert.deepEqual(waits, [20, 40]);
  assert.equal(calls.length, 3); assert.ok(calls.every(args => args.join() === 'index.tmp,index.json'));
});

test('persistent file locks and unrelated filesystem errors are surfaced', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC']) {
    const failure = Object.assign(Error(code), { code }); let attempts = 0, waited = 0;
    await assert.rejects(() => replaceFile('tmp', 'dest', { renameFile: async () => { attempts++; throw failure; }, wait: async ms => { waited += ms; } }), error => error === failure);
    assert.equal(attempts, ['ENOENT', 'ENOSPC'].includes(code) ? 1 : 6);
    assert.equal(waited, ['ENOENT', 'ENOSPC'].includes(code) ? 0 : 620);
  }
});
