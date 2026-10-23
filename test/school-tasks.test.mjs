import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SchoolClient, normalizeTasks, parseJSON, saveSchoolSession, readJSON } from '../src/core.mjs';

const assignmentId = '1234567890123456789';
const siteId = '9876543210987654321';
const undone = (extra = {}) => ({ activityId: assignmentId, activityName: '当前待办标题', type: 3, siteId: -1, siteName: '', endTime: '2026-10-30 23:59:00', ...extra });
const course = (id = siteId, name = '计算机网络') => ({ id, siteName: name });
const work = (id = assignmentId) => ({ id, assignmentTitle: '教师作业标题', assignmentEndTime: '2000-01-01 00:00:00' });

function clientFor(handler) {
  const calls = [];
  let session = { userId: '10001', headers: { 'blade-auth': 'test-token', identity: 'student' } };
  const client = new SchoolClient(null, async (url, options) => {
    const call = { url, options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const result = await handler(call);
    return result instanceof Response ? result : Response.json({ success: true, data: result });
  });
  client.session = async () => structuredClone(session);
  return {
    client, calls,
    setUser(userId) { session = { ...session, userId }; },
    setIdentity(identity) { session = { ...session, headers: { ...session.headers, identity } }; },
  };
}

const deferred = () => Promise.withResolvers();

test('待办保留精确字符串课程 ID，学校无效 siteId 不生成课程关联', () => {
  const parsed = parseJSON('{"data":{"undoneList":[{"activityId":1234567890123456789,"siteId":9876543210987654321,"siteName":"<b>网络</b>","type":3}]}}');
  const task = normalizeTasks(parsed)[0];
  assert.equal(task.id, assignmentId);
  assert.equal(task.siteId, siteId);
  assert.equal(task.courseId, siteId);
  assert.equal(task.course, '网络');
  for (const invalid of [-1, 0, null, undefined, '']) {
    const normalized = normalizeTasks({ data: { undoneList: [undone({ siteId: invalid })] } })[0];
    assert.equal(normalized.siteId, null);
    assert.equal(normalized.courseId, null);
  }
  const metadata = normalizeTasks({ data: { undoneList: [undone({ assignmentType: 0, evaluationStatus: '1', isOpenEvaluation: 2, studentGroupId: siteId })] } })[0];
  assert.equal(metadata.assignmentType, 0);
  assert.equal(metadata.evaluationStatus, 1);
  assert.equal(metadata.isOpenEvaluation, 2);
  assert.equal(metadata.studentGroupId, siteId);
  const invalid = normalizeTasks({ data: { undoneList: [undone({ assignmentType: -1, evaluationStatus: 'unknown', isOpenEvaluation: '', studentGroupId: -1 })] } })[0];
  assert.ok(['assignmentType', 'evaluationStatus', 'isOpenEvaluation', 'studentGroupId'].every(field => !(field in invalid)));
});

test('缺课程名的真实 undone 形状按作业 ID 补全；刷新仍读取即时待办', async () => {
  let reads = 0;
  const { client, calls } = clientFor(({ url, options, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone({ activityName: `刷新 ${++reads}` })] };
    if (url.pathname.endsWith('/current')) return { records: [course()], total: 1 };
    assert.equal(url.pathname, '/ykt-site/work/student/list');
    assert.equal(options.method, 'POST');
    assert.equal(body.siteId, siteId);
    assert.equal(body.current, 1);
    return { records: [work()], total: 1 };
  });
  const first = (await client.tasks())[0];
  assert.equal(first.course, '计算机网络');
  assert.equal(first.courseId, siteId);
  assert.equal(first.siteId, siteId);
  assert.equal(first.title, '刷新 1');
  assert.equal(first.deadline, '2026-10-30 23:59:00');
  const second = (await client.tasks())[0];
  assert.equal(second.title, '刷新 2');
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, 1);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/list')).length, 1);
  const publicTask = (await client.publicAssignments())[0];
  assert.equal(publicTask.title, '教师作业标题');
  assert.equal(publicTask.courseId, siteId);
  assert.equal(calls.length, 4);
});

test('有课程名的待办和非作业任务不触发课程扫描', async () => {
  const { client, calls } = clientFor(() => ({ undoneList: [undone({ siteName: '原始课程', siteId }), undone({ activityId: '2', type: 4 }), undone({ activityId: '3', type: 2 })] }));
  const tasks = await client.tasks();
  assert.equal(tasks[0].course, '原始课程');
  assert.equal(tasks[1].course, '课程未提供');
  assert.equal(calls.length, 1);
});

test('分组作业也按作业 ID 补全，保留用于官方提交页的任务元数据', async () => {
  const { client } = clientFor(({ url }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone({ type: 5, assignmentType: 1, evaluationStatus: 0, isOpenEvaluation: 0, studentGroupId: '2222222222222222222' })] };
    if (url.pathname.endsWith('/current')) return { records: [course()], total: 1 };
    return { records: [work()], total: 1 };
  });
  const task = (await client.tasks())[0];
  assert.equal(task.course, '计算机网络');
  assert.equal(task.type, 5);
  assert.equal(task.assignmentType, 1);
  assert.equal(task.studentGroupId, '2222222222222222222');
});

test('并发刷新共用课程扫描，扫描并发上限为三且身份变化不复用缓存', async () => {
  let active = 0;
  let maximum = 0;
  const { client, calls, setUser } = clientFor(async ({ url, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    if (url.pathname.endsWith('/current')) return { records: Array.from({ length: 7 }, (_, index) => course(String(index + 1))), total: 7 };
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { records: body.siteId === '1' ? [work()] : [], total: body.siteId === '1' ? 1 : 0 };
  });
  const results = await Promise.all([client.tasks(), client.tasks(), client.tasks()]);
  assert.ok(results.every(tasks => tasks[0].courseId === '1'));
  assert.equal(maximum, 3);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, 1);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/list')).length, 7);
  setUser('10002');
  await client.tasks();
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, 2);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/list')).length, 14);
});

test('课程接口失败保留即时待办，短暂退避；部分课程失败仍补全成功课程', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let failure = true;
  const { client, calls } = clientFor(({ url, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    if (url.pathname.endsWith('/current')) return { records: [course(), course('2', '另一课程')], total: 2 };
    if (failure || body.siteId === '2') return new Response('', { status: 503 });
    return { records: [work()], total: 1 };
  });
  const first = await client.tasks();
  assert.equal(first[0].title, '当前待办标题');
  assert.equal(first[0].course, '课程未提供');
  await client.tasks();
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, 1);
  await assert.rejects(() => client.publicAssignments(), /503/);
  failure = false;
  now += 30001;
  const partial = await client.tasks();
  assert.equal(partial[0].course, '计算机网络');
  assert.equal(partial[0].courseId, siteId);
  await assert.rejects(() => client.publicAssignments(), /503/);
});

test('课程目录整体失败也保留列表，分页作业第二页可用于课程补全', async () => {
  const failed = clientFor(({ url }) => url.pathname.endsWith('/undone') ? { undoneList: [undone()] } : new Response('', { status: 502 }));
  assert.equal((await failed.client.tasks())[0].course, '课程未提供');
  const { client, calls } = clientFor(({ url, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    if (url.pathname.endsWith('/current')) return { records: [course()], total: 1 };
    return body.current === 1 ? { records: Array.from({ length: 100 }, (_, index) => work(String(index + 1))), total: 101 } : { records: [work()], total: 101 };
  });
  assert.equal((await client.tasks())[0].courseId, siteId);
  assert.deepEqual(calls.filter(call => call.body).map(call => call.body.current), [1, 2]);
});

test('课程目录等待期间换账号，旧批次明确取消且不能污染新账号缓存', async () => {
  const started = deferred();
  const release = deferred();
  let paused = false;
  const { client, calls, setUser } = clientFor(async ({ url, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    if (url.pathname.endsWith('/current')) {
      const user = url.searchParams.get('userId');
      if (user === '10001' && !paused) { paused = true; started.resolve(); await release.promise; }
      return { records: [course(user, `课程 ${user}`)], total: 1 };
    }
    assert.equal(body.siteId, '10002');
    return { records: [work()], total: 1 };
  });
  const old = client.tasks();
  const oldRejected = assert.rejects(old, { code: 'SCHOOL_IDENTITY_CHANGED' });
  await started.promise;
  setUser('10002');
  assert.equal((await client.tasks())[0].course, '课程 10002');
  release.resolve();
  await oldRejected;
  const catalogReads = calls.filter(call => call.url.pathname.endsWith('/current')).length;
  assert.equal((await client.tasks())[0].course, '课程 10002');
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, catalogReads);
  assert.equal(calls.filter(call => call.body?.siteId === '10001').length, 0);
});

test('作业清单等待期间切换同账号身份，旧批次拒绝并废弃部分结果', async () => {
  const started = deferred();
  const release = deferred();
  const { client, calls, setIdentity } = clientFor(async ({ url, options, body }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    if (url.pathname.endsWith('/current')) return { records: [course(options.headers.identity === 'student' ? '1' : '2', options.headers.identity)], total: 1 };
    if (body.siteId === '1') { started.resolve(); await release.promise; }
    return { records: [work()], total: 1 };
  });
  const oldRejected = assert.rejects(client.tasks(), { code: 'SCHOOL_IDENTITY_CHANGED' });
  await started.promise;
  setIdentity('another-student-role');
  assert.equal((await client.tasks())[0].course, 'another-student-role');
  release.resolve();
  await oldRejected;
  assert.equal((await client.tasks())[0].courseId, '2');
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/current')).length, 2);
});

test('undone 已完成后换账号，不把旧待办与新课程拼接，也不降级返回旧列表', async () => {
  const started = deferred();
  const release = deferred();
  const { client, calls, setUser } = clientFor(({ url }) => {
    if (url.pathname.endsWith('/undone')) return { undoneList: [undone()] };
    throw new Error('身份变化后不得继续请求课程');
  });
  const request = client.request.bind(client);
  client.request = async (...args) => {
    const result = await request(...args);
    if (args[0].endsWith('/undone')) { started.resolve(); await release.promise; }
    return result;
  };
  const rejected = assert.rejects(client.tasks(), { code: 'SCHOOL_IDENTITY_CHANGED' });
  await started.promise;
  setUser('10002');
  release.resolve();
  await rejected;
  assert.equal(calls.length, 1);
});

test('旧账号等待续期时换账号，不保存旧续期凭据覆盖新身份', async () => {
  const started = deferred();
  const release = deferred();
  const { client, setUser } = clientFor(() => { throw new Error('续期测试不读取课程'); });
  client.file = new URL('../data/unused-school-session.json', import.meta.url);
  const previous = await client.session();
  client.renewer = async () => { started.resolve(); await release.promise; return { ...previous, headers: { ...previous.headers, 'blade-auth': 'new-old-account-token' } }; };
  const rejected = assert.rejects(client.renew(previous), { code: 'SCHOOL_IDENTITY_CHANGED' });
  await started.promise;
  setUser('10002');
  release.resolve();
  await rejected;
  assert.equal((await client.session()).userId, '10002');
});

test('新登录先持有学校会话写锁，排队的旧续期获得锁后重新核对并拒绝', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'school-session-login-first-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = pathToFileURL(join(directory, 'session.json'));
  const old = { userId: '10001', headers: { 'blade-auth': 'old-token', identity: 'student' } };
  const login = { userId: '10002', headers: { 'blade-auth': 'new-account-token', identity: 'student' } };
  await saveSchoolSession(file, old);
  const locked = deferred();
  const release = deferred();
  const renewalReady = deferred();
  const client = new SchoolClient(file, () => { throw new Error('测试不调用远程接口'); }, async () => {
    renewalReady.resolve();
    return { ...old, headers: { ...old.headers, 'blade-auth': 'renewed-old-token' } };
  });
  const savingLogin = saveSchoolSession(file, login, { beforeWrite: async () => { locked.resolve(); await release.promise; } });
  await locked.promise;
  const rejected = assert.rejects(client.renew(old), { code: 'SCHOOL_IDENTITY_CHANGED' });
  await renewalReady.promise;
  release.resolve();
  await savingLogin;
  await rejected;
  assert.deepEqual(await readJSON(file), login);
  assert.deepEqual(await readdir(directory), ['session.json']);
});

test('旧续期先持有学校会话写锁，随后登录按顺序落盘且最终保留新账号', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'school-session-renew-first-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = pathToFileURL(join(directory, 'session.json'));
  const old = { userId: '10001', headers: { 'blade-auth': 'old-token', identity: 'student' } };
  const login = { userId: '10002', headers: { 'blade-auth': 'new-account-token', identity: 'student' } };
  await saveSchoolSession(file, old);
  const locked = deferred();
  const release = deferred();
  const client = new SchoolClient(file, () => { throw new Error('测试不调用远程接口'); }, async () => ({ ...old, headers: { ...old.headers, 'blade-auth': 'renewed-old-token' } }));
  const identitySession = client.identitySession.bind(client);
  let checks = 0;
  client.identitySession = async expected => {
    const session = await identitySession(expected);
    if (++checks === 2) { locked.resolve(); await release.promise; }
    return session;
  };
  const renewing = client.renew(old);
  await locked.promise;
  const savingLogin = saveSchoolSession(file, login);
  release.resolve();
  assert.equal((await renewing).userId, '10001');
  await savingLogin;
  assert.deepEqual(await readJSON(file), login);
  assert.deepEqual(await readdir(directory), ['session.json']);
});

test('同一账号重新登录后，旧续期也不能覆盖新登录的凭据', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'school-session-same-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = pathToFileURL(join(directory, 'session.json'));
  const old = { userId: '10001', headers: { 'blade-auth': 'old-token', identity: 'student' }, renewal: 'old-refresh' };
  const login = { ...old, headers: { ...old.headers, 'blade-auth': 'fresh-login-token' }, renewal: 'fresh-login-refresh' };
  await saveSchoolSession(file, old);
  const started = deferred(), release = deferred();
  const client = new SchoolClient(file, () => { throw new Error('测试不调用远程接口'); }, async () => {
    started.resolve(); await release.promise;
    return { ...old, headers: { ...old.headers, 'blade-auth': 'renewed-old-token' }, renewal: 'renewed-old-refresh' };
  });
  const rejected = assert.rejects(client.renew(old), { code: 'SCHOOL_IDENTITY_CHANGED' });
  await started.promise;
  await saveSchoolSession(file, login);
  release.resolve();
  await rejected;
  assert.deepEqual(await readJSON(file), login);
  assert.deepEqual(await readdir(directory), ['session.json']);
});
