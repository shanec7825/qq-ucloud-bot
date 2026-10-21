import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentSchool } from '../src/agent-school.mjs';

function fixture() {
  const calls = [];
  const detail = { assignmentTitle: '练习', assignmentType: 0 };
  const view = { assignmentContent: '', attachmentIds: [], commitId: '', status: 2, assignmentStatus: 99, isOvertimeCommit: 0 };
  const client = { request: async (path, payload, allowRenew) => {
    calls.push({ path, payload, allowRenew });
    if (path === '/ykt-site/work/submit') { Object.assign(view, { assignmentContent: payload.assignmentContent, assignmentStatus: 0 }); return { code: 200 }; }
    return { data: path.includes('/detail?') ? structuredClone(detail) : structuredClone(view) };
  } };
  return { calls, detail, view, client, adapter: new AgentSchool(client, { getUserId: async () => '123' }) };
}
test('prepare is read only, submit uses verified payload once and reads back', async () => {
  const f = fixture();
  const plan = await f.adapter.prepare({ assignmentId: '42', content: '答案 \n' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.some(c => c.payload), false);
  assert.deepEqual(plan.payload, { attachmentIds: [], assignmentContent: '答案', assignmentId: '42', assignmentType: 0, userId: '123', groupId: '', commitId: '' });
  assert.equal((await f.adapter.submit(plan)).status, 'verified');
  assert.equal(f.calls.find(c => c.payload).allowRenew, false);
  await assert.rejects(f.adapter.submit(plan));
  await assert.rejects(f.adapter.submit(structuredClone(plan)));
});
test('changed submission or assignment prevents write', async () => {
  for (const change of [f => { f.view.assignmentContent = '他处修改'; }, f => { f.detail.assignmentTitle = '新题'; }]) {
    const f = fixture(); const plan = await f.adapter.prepare({ assignmentId: '42', content: '答案' }); change(f);
    await assert.rejects(f.adapter.submit(plan)); assert.equal(f.calls.some(c => c.payload), false);
  }
});
test('unsupported groups attachments invalid text and closed states fail before write', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.prepare({ assignmentId: '../', content: 'a' }));
  await assert.rejects(f.adapter.prepare({ assignmentId: '42', content: 'a', attachments: ['x'] }));
  await assert.rejects(f.adapter.prepare({ assignmentId: '42', content: 'a'.repeat(2001) }));
  f.detail.assignmentType = 1; await assert.rejects(f.adapter.prepare({ assignmentId: '42', content: 'a' }));
  f.detail.assignmentType = 0; f.view.attachmentIds = ['9']; await assert.rejects(f.adapter.prepare({ assignmentId: '42', content: 'a' }));
  f.view.attachmentIds = []; f.view.status = 3; f.view.isOvertimeCommit = 1; await assert.rejects(f.adapter.prepare({ assignmentId: '42', content: 'a' }));
  assert.equal(f.calls.some(c => c.payload), false);
});
test('uncertain writes are consumed without retries or false success', async () => {
  const f = fixture(); const original = f.client.request;
  f.client.request = async (...args) => { if (args[1]) { f.calls.push({ payload: args[1] }); throw new Error('network'); } return original(...args); };
  const plan = await f.adapter.prepare({ assignmentId: '42', content: 'a' });
  assert.equal((await f.adapter.submit(plan)).status, 'unknown');
  await assert.rejects(f.adapter.submit(plan)); assert.equal(f.calls.filter(c => c.payload).length, 1);
});
