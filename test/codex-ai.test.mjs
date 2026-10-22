import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { askCodex, codexArgs } from '../src/codex-ai.mjs';

function fixture() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  child.kill = () => { killed++; child.emit('close', 143); };
  const request = askCodex('测试', {}, {}, () => { started(); return child; });
  const emit = event => child.stdout.write(JSON.stringify(event) + '\n');
  return { child, request, ready, emit, killed: () => killed };
}
const answer = { type: 'item.completed', item: { type: 'agent_message', text: '最终回复' } };
const done = { type: 'turn.completed' };

test('完成通知立即返回答案并停止进程，不等待退出阶段的网络清理', async () => {
  const f = fixture(); await f.ready;
  let resolved = false; f.request.then(() => { resolved = true; });
  f.emit(answer); await setImmediate(); assert.equal(resolved, false);
  f.emit(done);
  try { assert.equal(await Promise.race([f.request, delay(100).then(() => 'still waiting for exit')]), '最终回复'); }
  finally { f.child.emit('close', 0); }
  assert.equal(f.killed(), 1);
  f.child.emit('error', new Error('late cleanup failure'));
});

test('未收到完成通知时，正常进程退出也不能转发部分答案', async () => {
  const f = fixture(); await f.ready; f.emit(answer); f.child.emit('close', 0);
  await assert.rejects(f.request, /不可用/);
});

test('失败通知或越权工具事件不能因随后出现完成通知而被当成成功', async () => {
  for (const event of [{ type: 'turn.failed' }, { type: 'error' }, { type: 'item.started', item: { type: 'command_execution' } }]) {
    const f = fixture(); await f.ready; f.emit(answer); f.emit(event); f.emit(done); f.child.emit('close', 0);
    await assert.rejects(f.request, /不可用/);
  }
});

test('分片到达的最终答案与无换行完成通知仍能正确收尾', async () => {
  const f = fixture(); await f.ready;
  const line = JSON.stringify(answer) + '\n';
  f.child.stdout.write(line.slice(0, 20)); f.child.stdout.write(line.slice(20));
  f.child.stdout.write(JSON.stringify(done)); f.child.emit('close', 0);
  assert.equal(await f.request, '最终回复');
});

test('空白答案和超量输出被拒绝，避免发送不完整或异常输出', async () => {
  const empty = fixture(); await empty.ready;
  empty.emit({ ...answer, item: { ...answer.item, text: '  ' } }); empty.emit(done); empty.child.emit('close', 0);
  await assert.rejects(empty.request, /不可用/);
  const huge = fixture(); await huge.ready; huge.child.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(huge.request, /不可用/); assert.equal(huge.killed(), 1);
});

test('QQ 模型使用简短的宿主规则，并关闭不使用的 Code Mode', async () => {
  const args = codexArgs('gpt-6-luna'), setting = args.find(value => value.startsWith('model_instructions_file='));
  assert.ok(setting);
  for (const flag of ['code_mode', 'code_mode_only', 'code_mode_only_strict_3p_tools', 'code_mode_host']) {
    const index = args.indexOf(flag); assert.ok(index > 0); assert.equal(args[index - 1], '--disable');
  }
  const file = JSON.parse(setting.slice('model_instructions_file='.length)), instructions = await readFile(file, 'utf8');
  assert.match(instructions, /QQ/); assert.match(instructions, /数据/); assert.match(instructions, /工具/);
  assert.ok(instructions.length < 2000);
});
