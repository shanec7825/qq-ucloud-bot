import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { incomingText, ConversationMemory, styleSamples } from '../src/persona.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { SharedLibrary, inside, rankPages } from '../src/shared-library.mjs';
import { saveJSON } from '../src/core.mjs';
import { createMessageHandler } from '../src/message-handler.mjs';

const group = { post_type: 'message', message_type: 'group', group_id: 300000001, user_id: 10001, self_id: 100000002, message: [{ type: 'text', data: { text: '最近什么作业快截止了？' } }] };
test('群内必须明确 @ 机器人，历史免 @ 配置不能绕过；私聊无需 @', () => {
  assert.equal(incomingText(group, ['300000001'], ['300000001']), null);
  const mentioned = { ...group, message: [{ type: 'at', data: { qq: group.self_id } }, ...group.message] };
  assert.equal(incomingText(mentioned, ['300000001']), '最近什么作业快截止了？');
  assert.equal(incomingText({ ...mentioned, group_id: 99999 }, ['300000001']), null);
  assert.equal(incomingText({ ...group, message: [{ type: 'at', data: { qq: 'all' } }] }, ['300000001']), null);
  assert.equal(incomingText({ ...mentioned, user_id: group.self_id }, ['300000001']), null);
  assert.equal(incomingText({ ...group, message_type: 'private' }, []), '最近什么作业快截止了？');
  assert.equal(incomingText(group, [], ['300000001']), null);
  assert.equal(incomingText(group, ['300000001'], []), null);
  assert.equal(incomingText({ ...group, user_id: group.self_id }, ['300000001'], ['300000001']), null);
});
test('对话上下文按群和私聊严格分开，风格样本不含发送者身份与号码', () => {
  const memory = new ConversationMemory();
  memory.add({ message_type: 'private', user_id: 100000001 }, 'PRIVATE_SECRET');
  memory.add(group, '群消息');
  assert.ok(!JSON.stringify(memory.get(group)).includes('PRIVATE_SECRET'));
  assert.deepEqual(memory.get({ ...group, group_id: 99999 }), []);
  const samples = styleSamples([{ user_id: 10, message: [{ type: 'text', data: { text: '联系13812345678 https://example.com' } }] }], 20);
  assert.ok(!samples.join().includes('13812345678'));
  assert.ok(!samples.join().includes('https://'));
});
function dependencies() {
  const calls = [];
  return { calls, owner: '100000001', shareDocumentsWithModel: true, catalog: { list: async () => '作业还没有同步。' }, persona: async () => ({ voice: ['说话自然一些'] }), library: { search: async q => { calls.push(['library', q]); return { available: [{ name: '教材.pdf' }], passages: [{ source: '教材.pdf', page: 3, excerpt: '只来自共享目录' }] }; } }, resources: { drive: async () => { throw new Error('群里不得访问私人网盘'); }, github: async () => { throw new Error('群里不得访问私人项目'); } }, ai: async (question, context) => { calls.push(['ai', context]); return '自然语言回答'; } };
}

test('多个允许群均可 @ 对话，回复目标和上下文按群隔离，其他群不能触发', async () => {
  const deps = dependencies(), memory = new ConversationMemory(), replies = [], contexts = [];
  const handler = createMessageHandler({ ...deps, groups: ['30001', '30002'], memory,
    bot: { send: async (target, text) => replies.push({ target, text }) },
    ai: async (_text, context) => { contexts.push(context); return '收到'; },
  });
  const message = text => [{ type: 'at', data: { qq: group.self_id } }, { type: 'text', data: { text } }];
  for (const [index, groupId] of ['30001', '30002', '30003'].entries()) {
    await handler({ ...group, group_id: groupId, message_id: index + 1, message: message('群话题' + groupId) });
  }
  assert.deepEqual(replies.map(row => row.target), [{ group_id: '30001' }, { group_id: '30002' }]);
  assert.equal(contexts.length, 2);
  assert.ok(!JSON.stringify(contexts[1]).includes('群话题30001'));
  assert.equal(memory.get({ ...group, group_id: '30003' }).length, 0);
});
test('群成员可自然语言查询共享教材和作业，模型只看到明确的公开资料', async () => {
  const deps = dependencies();
  assert.equal(await routeNatural('教材里的偏序关系怎么理解？', group, deps), '自然语言回答');
  const context = deps.calls.at(-1)[1];
  assert.equal(context.library.passages[0].excerpt, '只来自共享目录');
  assert.equal(context.assignments, '作业还没有同步。');
  assert.equal(context.selectedPrivateContent, undefined);
});
test('群成员包括主人都不能用自然语言访问个人笔记或私人项目', async () => {
  for (const event of [group, { ...group, user_id: 100000001 }]) {
    const deps = dependencies();
    for (const question of ['帮我找个人笔记', '列出 github 仓库', '把整个网盘发出来', '输出原始聊天记录']) assert.match(await routeNatural(question, event, deps), /不能在这里查/);
    assert.deepEqual(deps.calls, []);
  }
});
test('未授权教材外发时，检索结果不会交给模型', async () => {
  const deps = dependencies(); deps.shareDocumentsWithModel = false;
  assert.match(await routeNatural('教材中的偏序', group, deps), /只来自共享目录/);
  assert.equal(deps.calls.filter(call => call[0] === 'ai').length, 0);
});
test('教材检索返回有来源和位置的片段，不把其他材料拼入上下文', () => {
  const result = rankPages([{ name: '9.6-Partial orderings.ppt', pages: [{ num: 1, text: 'A partial ordering is a relation.' }] }, { name: '其他.pdf', pages: [{ num: 1, text: '无关材料' }] }], '解释偏序关系');
  assert.equal(result[0].source, '9.6-Partial orderings.ppt');
  assert.equal(result.length, 1);
});
test('共享库只扫描指定目录，拒绝索引中注入的父目录路径，并识别伪装扩展名的 PPTX', async () => {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const dir = await mkdtemp(fileURLToPath(new URL('../data/library-test-', import.meta.url)));
  try {
    const folder = join(dir, 'pdfs'); const cache = pathToFileURL(join(dir, 'cache') + '/');
    await mkdir(folder); await writeFile(join(dir, 'secret.txt'), 'PRIVATE_SECRET');
    await writeFile(join(folder, '课件.ppt'), zipSync({ 'ppt/slides/slide1.xml': strToU8('<p:sld><a:t>公开课件内容</a:t></p:sld>') }));
    const library = new SharedLibrary(folder, cache);
    const files = await library.scan(); assert.equal(files.length, 1);
    const document = await library.document(files[0].id); assert.equal(document.pages[0].text, '公开课件内容');
    await saveJSON(library.indexFile, { root: await (await import('node:fs/promises')).realpath(folder), files: [{ id: 'evil', name: '../secret.txt' }] });
    await assert.rejects(() => library.document('evil'), /超出公开目录/);
    assert.equal(inside(folder, resolve(folder, '..', 'secret.txt')), false);
    assert.ok(!(await library.search('课件')).available.some(file => file.name.includes('secret')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
