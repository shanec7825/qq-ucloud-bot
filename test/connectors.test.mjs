import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ChatGPTConnectorClient, ChatGPTResources, driveQuery, googleURL } from '../src/chatgpt-connectors.mjs';
import { routeNatural } from '../src/natural-chat.mjs';

test('原生连接器只走官方只读 RPC，不启动模型、不转交第三方密钥，拒绝写工具', async () => {
  const calls = []; let child, receivedOptions;
  const spawn = (_binary, args, options) => {
    assert.equal(args[0], 'app-server'); assert.ok(!args.includes('--ignore-user-config')); receivedOptions = options;
    child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit', 0); };
    child.stdin.on('data', chunk => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const request = JSON.parse(line); if (!request.id) continue; calls.push(request);
        const tools = { 'google_drive.search': { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } } };
        const responses = { initialize: {}, 'app/list': { data: [{ id: 'test-drive', name: 'Google Drive', isAccessible: true }] }, 'thread/start': { thread: { id: 'isolated-thread' } }, 'mcpServerStatus/list': { data: [{ name: 'codex_apps', tools }] }, 'mcpServer/tool/call': { structuredContent: { files: [] }, isError: false } };
        queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result: responses[request.method] }) + '\n'));
      }
    }); return child;
  };
  const client = new ChatGPTConnectorClient({ spawner: spawn, timeout: 1000 });
  try {
    await assert.rejects(() => client.call('google_drive.delete_file', {}), /只允许/); assert.equal(calls.length, 0);
    assert.deepEqual(await client.call('google_drive.search', { query: 'README' }), { files: [] });
    assert.ok(calls.every(call => call.method !== 'turn/start'));
    const init = calls.find(call => call.method === 'initialize'); assert.equal(init.params.capabilities.requestAttestation, false);
    const thread = calls.find(call => call.method === 'thread/start'); assert.equal(thread.params.ephemeral, true); assert.equal(thread.params.config['apps.test-drive.enabled'], true); assert.equal(thread.params.config['apps.test-drive.destructive_enabled'], false);
    assert.ok(!Object.keys(receivedOptions.env).some(key => /TOKEN|API_KEY|SECRET|PASSWORD/i.test(key)));
    client.tools['google_drive.search'].annotations.readOnlyHint = false;
    await assert.rejects(() => client.call('google_drive.search', {}), /只读检查/);
  } finally { client.dispose(); }
});

test('Drive 文件名、PDF、目录与列表序号都能定位正文，不从外链读取', async () => {
  const calls = [], file = { id: 'file-one', title: '课程内容.pdf', mime_type: 'application/pdf', url: 'https://drive.google.com/file/d/file-one/view' };
  const resources = new ChatGPTResources({ call: async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'google_drive.search') return { results: [file] };
    if (tool === 'google_drive.list_folder') return { files: [file] };
    return { content: '文件正文：这是偏序关系的教材。' };
  } });
  assert.equal(driveQuery('读取 Google Drive 里的课程内容.pdf'), '课程内容.pdf');
  assert.match(await resources.driveQuestion('读取 Google Drive 里的课程内容.pdf', 'private:100000001'), /这是偏序关系/);
  assert.deepEqual(calls.map(c => c.tool), ['google_drive.search', 'google_drive.fetch']); assert.equal(calls[0].args.query, '课程内容.pdf');
  await resources.driveQuestion('我的网盘里有什么', 'private:100000001');
  assert.match(await resources.driveQuestion('读取第一个文件', 'private:100000001'), /文件正文/);
  await assert.rejects(() => resources.fetch('https://evil.test/secret'), /正式链接/);
  assert.throws(() => googleURL('https://drive.google.com.evil.test/file/d/x/view'));
});

test('同名候选不随意选择，文件选择按私聊隔离，过期选择不复用', async () => {
  const files = [1, 2].map(id => ({ title: '重名.md', id: String(id), url: `https://drive.google.com/file/d/file-${id}/view` }));
  const calls = [], resources = new ChatGPTResources({ call: async (tool, args) => { calls.push({ tool, args }); return tool.endsWith('search') ? { results: files } : { content: '已读取所选正文' }; } });
  assert.match(await resources.driveQuestion('读取网盘“重名.md”', 'private:100000001'), /请指定/);
  assert.equal(calls.some(c => c.tool.endsWith('fetch')), false);
  assert.match(await resources.driveQuestion('读取第二个文件', 'private:100000001'), /已读取所选正文/);
  assert.ok(calls.at(-1).args.url.endsWith('file-2/view'));
  await resources.driveQuestion('读取第二个文件', 'private:100000002');
  assert.equal(calls.at(-1).tool, 'google_drive.search');
  resources.selections.get('private:100000001').touched = 0;
  await resources.driveQuestion('读取第二个文件', 'private:100000001');
  assert.equal(calls.at(-1).tool, 'google_drive.search');
});

test('GitHub 文件链接保留分支与路径，禁止父目录跳转', async () => {
  const calls = [], resources = new ChatGPTResources({ call: async (tool, args) => { calls.push({ tool, args }); return { content: '代码正文' }; } });
  assert.match(await resources.githubQuestion('读取 github https://github.com/example/project/blob/dev/src/main.mjs'), /代码正文/);
  assert.deepEqual(calls[0].args, { repository_full_name: 'example/project', path: 'src/main.mjs', ref: 'dev' });
  await assert.rejects(() => resources.github('example/project ../secret.txt'), /相对文件路径/);
});

test('主人 Drive PDF 问题走原生文件读取，群成员和他人不触发私人连接器', async () => {
  const calls = [], owner = '100000001';
  const deps = { owner, resources: { driveQuestion: async q => { calls.push(q); return 'DRIVE_DOCUMENT_BODY'; } }, catalog: { list: async () => '作业快照' }, ai: async (_q, context) => { assert.equal(context.selectedPrivateContent, 'DRIVE_DOCUMENT_BODY'); return '正文回答'; }, library: { search: async () => { throw new Error('Drive 文件不应错误转到共享库'); } }, persona: async () => ({ voice: [] }) };
  const event = { message_type: 'private', user_id: owner };
  assert.equal(await routeNatural('读取我的 Google Drive “教材.pdf”', event, deps), '正文回答');
  assert.equal(calls.length, 1);
  const publicDeps = { ...deps, ai: async () => '没有私人内容', library: null };
  await routeNatural('打开我的 Google Drive 文件', { message_type: 'private', user_id: '100000002' }, publicDeps);
  await routeNatural('打开我的 Google Drive 文件', { message_type: 'group', group_id: '300000001', user_id: owner }, publicDeps);
  assert.equal(calls.length, 1);
  const memory = { get: () => [{ speaker: '用户', text: '我的 Google Drive 文件有哪些' }] };
  assert.equal(await routeNatural('读取这份文件', event, { ...deps, memory }), '正文回答');
});
