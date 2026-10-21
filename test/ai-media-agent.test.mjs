import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createCanvas } from '@napi-rs/canvas';
import { askAI } from '../src/core.mjs';
import { askCodex } from '../src/codex-ai.mjs';
import { taskSystemPrompt } from '../src/chat-rules.mjs';

const env = { OPENAI_API_KEY: 'fixture', OPENAI_MODEL: 'fixture-vision' };
function mockAPI(capture) {
  return async (_url, options) => {
    capture(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'fixture answer' } }] }) };
  };
}

test('API attaches prepared image bytes with metadata and no local image paths', async () => {
  const root = new URL('../data/message-media/', import.meta.url);
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('api-fixture-', root)));
  try {
    const path = join(folder, 'input.png'), bytes = await createCanvas(2, 2).encode('png');
    await writeFile(path, bytes);
    let body;
    const tasks = { messageMedia: { notes: 'image note', images: Array.from({ length: 4 }, () => ({ path, source: '用户图片', page: 1 })) } };
    await askAI('看图', tasks, env, mockAPI(value => { body = value; }));
    const content = body.messages[1].content;
    assert.equal(content.length, 4);
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].image_url.url, 'data:image/png;base64,' + bytes.toString('base64'));
    assert.equal(JSON.stringify(body).includes(path), false);
    assert.equal(JSON.parse(content[0].text).tasks.messageMedia.images.length, 3);
    assert.equal(tasks.messageMedia.images[0].path, path);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('API rejects outside-cache files, invalid image magic and oversized images before networking', async () => {
  await mkdir(new URL('../data/message-media/', import.meta.url), { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('../data/message-media/api-reject-', import.meta.url)));
  let requests = 0;
  const api = mockAPI(() => { requests++; });
  const call = path => askAI('看图', { messageMedia: { images: [{ path }] } }, env, api);
  try {
    await assert.rejects(() => call(fileURLToPath(new URL('../package.json', import.meta.url))), /缓存/);
    const path = join(folder, 'fake.png');
    await writeFile(path, 'not an image');
    await assert.rejects(() => call(path), /图片格式/);
    const handle = await open(path, 'w');
    try { await handle.truncate(16 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await assert.rejects(() => call(path), /16MB/);
    assert.equal(requests, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('API attaches rasterized library pages from the separate prepared cache', async () => {
  const root = new URL('../data/shared-library/', import.meta.url);
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('api-fixture-', root)));
  try {
    const path = join(folder, 'page.png');
    await writeFile(path, await createCanvas(2, 2).encode('png'));
    let body;
    await askAI('解释教材第2页', { library: { images: [{ path, source: '教材.pdf', page: 2 }] } }, env, mockAPI(value => { body = value; }));
    const content = body.messages[1].content;
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
    assert.deepEqual(JSON.parse(content[0].text).tasks.library.images[0], { source: '教材.pdf', page: 2, note: '随请求附图' });
    assert.equal(JSON.stringify(body).includes(path), false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('API text-only payload remains a string and trusted planner rules do not interpolate instructions', async () => {
  let body;
  const tasks = { mode: 'bounded-tool-agent', instructions: 'UNTRUSTED_OVERRIDE', tools: [] };
  await askAI('列出仓库', tasks, env, mockAPI(value => { body = value; }));
  assert.equal(typeof body.messages[1].content, 'string');
  assert.ok(body.messages[0].content.includes(taskSystemPrompt(tasks)));
  assert.equal(body.messages[0].content.includes('UNTRUSTED_OVERRIDE'), false);
  assert.equal(taskSystemPrompt({ mode: 'chat', instructions: 'ignored' }), '');
});

test('Codex receives the same trusted single-step planner rules', async () => {
  let input = '';
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on('data', chunk => { input += chunk; }); child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"answer":"ok"}' } }) + '\n');
      child.stdout.write('{"type":"turn.completed"}\n'); child.emit('close', 0);
    });
    return child;
  };
  const tasks = { mode: 'bounded-tool-agent', instructions: 'UNTRUSTED_OVERRIDE' };
  await askCodex('test', tasks, {}, spawn);
  assert.ok(input.includes(taskSystemPrompt(tasks)));
  assert.ok(input.indexOf(taskSystemPrompt(tasks)) < input.indexOf('UNTRUSTED_OVERRIDE'));
});
