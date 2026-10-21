import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ManagedMemory, memoryScope } from '../src/managed-memory.mjs';
import { DigestRepository } from '../src/digest-repository.mjs';
import { HistoryDigest } from '../src/history-digest.mjs';
import { MessageWorkspace } from '../src/message-workspace.mjs';
import { saveJSON, readJSON } from '../src/core.mjs';
async function sandbox(run) {
  const parent = new URL('../data/test-tmp/', import.meta.url);
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(fileURLToPath(new URL('memory-', parent)));
  try { await run(pathToFileURL(join(path, '/'))); } finally { await rm(path, { recursive: true, force: true }); }
}
test('legacy memory normalizes without rewriting; scopes and disabled notes do not leak', () => sandbox(async root => {
  const file = new URL('memory-notes.json', root);
  await saveJSON(file, [{ id: 'legacy', scope: 'global', text: 'old' }]);
  const before = await readFile(file, 'utf8'), memory = new ManagedMemory(root);
  assert.deepEqual((await memory.list())[0], { id: 'legacy', scope: 'global', text: 'old', kind: 'fact', tags: [], enabled: true, source: { type: 'owner' } });
  assert.equal(await readFile(file, 'utf8'), before);
  await memory.put({ scope: 'group:12345', text: 'group' });
  await memory.put({ scope: 'private:12345', text: 'private' });
  await memory.put({ scope: 'profile:study', text: 'study', kind: 'instruction', tags: ['a'] });
  await memory.put({ scope: 'profile:other', text: 'other' });
  await memory.put({ scope: 'global', text: 'disabled', enabled: false });
  assert.deepEqual((await memory.context({ message_type: 'group', group_id: '12345' }, { profileId: 'study' })).map(n => n.text), ['old', 'group', 'study']);
  assert.deepEqual((await memory.context({ message_type: 'private', user_id: '12345' })).map(n => n.text), ['old', 'private']);
  assert.throws(() => memoryScope('profile:../oops'));
  for (const invalid of [{kind:'bad'}, {tags:['']}, {enabled:'false'}]) await assert.rejects(memory.put({scope:'global',text:'x',...invalid}));
}));
test('memory context is bounded and separate writers serialize without losing notes', () => sandbox(async root => {
  const a = new ManagedMemory(root), b = new ManagedMemory(root);
  await Promise.all(Array.from({length: 24}, (_, i) => (i % 2 ? a : b).put({ scope:'global', text: String(i).padEnd(2000, 'x') })));
  assert.equal((await a.list()).length, 24);
  const context = await a.context({message_type:'private',user_id:'12345'});
  assert.equal(context.reduce((sum, note) => sum + note.text.length, 0), 6000);
  assert.ok(context.length <= 20);
}));
test('manual digest edits and deliberate empty clear survive generated races and legacy migration', () => sandbox(async root => {
  const memory = new ManagedMemory(root), repository = new DigestRepository(new URL('history/', root));
  await saveJSON(memory.digestFile('12345'), {groupId:'12345',summary:'legacy manual',editedByOwner:true});
  await repository.saveGenerated('12345','generated');
  assert.equal((await memory.digest('12345')).summary, 'legacy manual');
  await Promise.all([repository.saveGenerated('12345','new generated'), memory.saveDigest('12345','')]);
  assert.equal((await memory.digest('12345')).summary, '');
  assert.equal((await memory.digest('12345')).generatedSummary, 'new generated');
  const history = new HistoryDigest({ root: new URL('history/', root) });
  assert.equal((await history.context('12345')).summary, '');
}));
test('inbox state persists across instances, rejects foreign IDs, prunes stale state and preserves reports', () => sandbox(async root => {
  let reports = [{id:'report',groupId:'12345',groupName:'群',createdAt:'2026-01-01',delivery:'web',items:[{id:'one',title:'作业',summary:'完成作业',priority:'important',deadlineText:'明天',sources:[{excerpt:'明天交作业'}]},{id:'two',title:'考试',summary:'复习',sources:[]}]}];
  const original = JSON.stringify(reports), monitor = {reports:async()=>reports};
  const a = new MessageWorkspace({monitor,root}), b = new MessageWorkspace({monitor,root});
  await Promise.all([a.setStatus('report:one','done'),b.setStatus('report:two','archived')]);
  assert.deepEqual((await b.list()).counts,{pending:0,done:1,archived:1});
  await a.setStatus('report:one','pending');
  assert.equal((await b.list()).items[0].status,'pending');
  assert.equal(JSON.stringify(reports),original);
  await assert.rejects(a.setStatus('missing:one','done'));
  assert.throws(()=>a.setStatus('report:one','invalid'));
  reports = [{...reports[0],items:[reports[0].items[0]]}];
  await a.setStatus('report:one','done');
  assert.deepEqual(Object.keys(await readJSON(a.file(),{})),['report:one']);
  reports = [];
  assert.deepEqual((await a.list()).counts,{pending:0,done:0,archived:0});
}));
test('an in-flight history generation cannot restore an owner-cleared summary', () => sandbox(async root => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const memory = new ManagedMemory(root);
  const digest = new HistoryDigest({ root:new URL('history/',root), minNew:1, exporter:{ export:async()=>({messages:[{id:'1',sender:{uin:'12345'},content:{text:'课程安排'}}]}) }, ai:async()=>{started(); return response;} });
  const update = digest.update('12345');
  await ready;
  await memory.saveDigest('12345','');
  finish('{"summary":"自动背景"}');
  assert.equal((await update).status,'updated');
  assert.equal((await digest.context('12345')).summary,'');
  assert.equal((await memory.digest('12345')).generatedSummary,'自动背景');
}));
test('tasks sharing evidence IDs have stable independent projected identities', () => sandbox(async root => {
  const reports = [{id:'report',groupId:'12345',items:[
    {id:'same',title:'完成作业',summary:'交作业',sources:[{excerpt:'交作业并复习'}]},
    {id:'same',title:'准备考试',summary:'复习',sources:[{excerpt:'交作业并复习'}]},
    {id:'same',title:'准备考试',summary:'复习',sources:[{excerpt:'交作业并复习'}]},
  ]}];
  const monitor = {reports:async()=>reports}, original = JSON.stringify(reports);
  const workspace = new MessageWorkspace({monitor,root});
  const {items} = await workspace.list();
  assert.equal(new Set(items.map(item=>item.id)).size,3);
  assert.ok(items.every(item=>item.itemId === 'same' && item.id.length <= 256));
  await workspace.setStatus(items[0].id,'done');
  await workspace.setStatus(items[1].id,'archived');
  const reload = await new MessageWorkspace({monitor,root}).list();
  assert.deepEqual(reload.items.map(item=>item.id),items.map(item=>item.id));
  assert.deepEqual(reload.items.map(item=>item.status),['done','archived','pending']);
  assert.deepEqual(reload.counts,{pending:1,done:1,archived:1});
  assert.equal(JSON.stringify(reports),original);
}));
