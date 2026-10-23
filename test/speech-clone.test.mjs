import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { SpeechReferenceStore, speechReferenceType, SPEECH_REFERENCE_BASE64_LIMIT, SPEECH_REFERENCE_BYTES_LIMIT, SPEECH_REFERENCE_CHUNK_SIZE, SPEECH_REFERENCE_UPLOAD_TTL } from '../src/speech-reference.mjs';
import { defaults, validateSettings, SettingsStore } from '../src/settings.mjs';
import { XiaomiSpeech } from '../src/xiaomi-speech.mjs';
import { speechContext, speechDirection, planSpeechStyle } from '../src/speech-direction.mjs';
import { SPEECH_DEFAULTS } from '../napcat-plugin/speech-config.mjs';
import { BotRuntime } from '../src/runtime.mjs';
import { startAdmin } from '../src/admin-server.mjs';

function wav(dataSize = 8) {
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}
function mp3(withTag = false) {
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0]);
  return withTag ? Buffer.concat([Buffer.from([0x49,0x44,0x33,4,0,0,0,0,0,0]), frame]) : frame;
}
async function sandbox(work) {
  const parent = new URL('../data/test-tmp/', import.meta.url); await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(fileURLToPath(new URL('speech-clone-', parent))), root = pathToFileURL(join(folder, '/'));
  try { await work(root); } finally { await rm(folder, { recursive: true, force: true }); }
}
const cloneConfig = patch => ({ ...SPEECH_DEFAULTS, enabled: true, model: 'mimo-v2.5-tts-voiceclone', referenceAudio: 'ref_' + 'a'.repeat(64), style: '普通话，自然放松，语速稍慢', ...patch });

test('reference audio persists WAV and MP3 by content, restores after restart, and never uses uploaded names as paths', () => sandbox(async root => {
  const store = new SpeechReferenceStore(root), sample = wav(), base64 = sample.toString('base64');
  const first = await store.put({ name: '../outside.wav', base64 });
  assert.deepEqual(Object.keys(first).sort(), ['id','mime','name','size']); assert.match(first.id, /^ref_[a-f0-9]{64}$/);
  assert.equal(first.name, '../outside.wav'); assert.equal(first.mime, 'audio/wav'); assert.equal(first.size, sample.length);
  assert.deepEqual(await store.put({ name: '另一个名称.wav', base64 }), first);
  const [repeated, different] = await Promise.all([store.put({ name: 'duplicate.wav', base64 }), store.put({ name: 'voice.mp3', base64: mp3(true).toString('base64') })]);
  assert.equal(repeated.id, first.id); assert.equal(different.mime, 'audio/mpeg');
  const restored = new SpeechReferenceStore(root); assert.equal((await restored.list()).length, 2);
  const preview = await restored.preview(first.id); assert.deepEqual(preview.reference, first); assert.equal(preview.dataURL, 'data:audio/wav;base64,' + base64);
  assert.equal(await restored.dataURL(different.id), 'data:audio/mpeg;base64,' + mp3(true).toString('base64'));
  assert.deepEqual((await restored.bytes(first.id)).bytes, sample);
  await assert.rejects(() => readFile(new URL('outside.wav', root)), { code: 'ENOENT' });
  await assert.rejects(() => restored.preview('../outside.wav'), /请选择已上传/);
  await assert.rejects(() => restored.preview('ref_' + '0'.repeat(64)), /不存在/);
}));

test('reference validation enforces actual WAV/MP3 signatures, complete frames, canonical base64 and the encoded 10MB limit', () => sandbox(async root => {
  const store = new SpeechReferenceStore(root);
  assert.equal(speechReferenceType(wav()), 'audio/wav'); assert.equal(speechReferenceType(mp3()), 'audio/mpeg'); assert.equal(speechReferenceType(mp3(true)), 'audio/mpeg');
  const boundary = wav(SPEECH_REFERENCE_BYTES_LIMIT - 44);
  assert.equal(boundary.toString('base64').length, SPEECH_REFERENCE_BASE64_LIMIT); assert.equal(speechReferenceType(boundary), 'audio/wav');
  const malformed = [Buffer.from('<html>audio.mp3</html>'), wav().subarray(0, 45), wav(0), mp3().subarray(0, 40), Buffer.from('ID3'), Buffer.from([0xff,0xfb,0xf0,0]), Buffer.concat([Buffer.from([0x49,0x44,0x33,4,0,0,0x80,0,0,0]), mp3()])];
  for (const bytes of malformed) await assert.rejects(() => store.put({ name: 'forged.wav', base64: bytes.toString('base64') }), /有效的 WAV 或 MP3/);
  for (const base64 of ['%%%=', 'YWJj\n', 'data:audio/wav;base64,' + wav().toString('base64'), 'A'.repeat(SPEECH_REFERENCE_BASE64_LIMIT + 4)]) await assert.rejects(() => store.put({ name: 'voice.wav', base64 }), /10MB/);
  for (const name of ['', '  ', 'x'.repeat(121), 'voice\0.wav']) await assert.rejects(() => store.put({ name, base64: wav().toString('base64') }), /名称/);
  assert.throws(() => speechReferenceType(Buffer.alloc(SPEECH_REFERENCE_BYTES_LIMIT + 1)), /10MB/);
  assert.deepEqual(await store.list(), []);
}));

test('missing and changed reference files fail visibly without silently changing the voice', () => sandbox(async root => {
  const store = new SpeechReferenceStore(root), bytes = wav();
  const reference = await store.put({ name: 'sample.wav', base64: bytes.toString('base64') }), file = new URL(reference.id, store.root);
  const changed = Buffer.from(bytes); changed[changed.length - 1] = 1; await writeFile(file, changed);
  await assert.rejects(() => store.dataURL(reference.id), /校验失败/);
  assert.deepEqual(await store.put({ name: 'same-sample.wav', base64: bytes.toString('base64') }), reference);
  assert.equal(await store.dataURL(reference.id), 'data:audio/wav;base64,' + bytes.toString('base64'));
  await rm(file); await assert.rejects(() => store.preview(reference.id), /丢失或损坏/);
  const restored = await store.put({ name: 're-uploaded.wav', base64: bytes.toString('base64') });
  assert.deepEqual(restored, reference); assert.deepEqual((await store.bytes(reference.id)).bytes, bytes); assert.equal((await store.list()).length, 1);
  await writeFile(store.index, '{broken index'); await assert.rejects(() => store.list(), /索引无法读取/);
}));

test('chunked reference uploads bound sessions, expire after five minutes, validate sizes and release cancellations', () => sandbox(async root => {
  let now = 0;
  const store = new SpeechReferenceStore(root, { now: () => now }), sample = wav(), base64 = sample.toString('base64');
  for (const size of [0,-1,1.5,SPEECH_REFERENCE_BYTES_LIMIT + 1,null]) assert.throws(() => store.startUpload({ name: 'sample.wav', size }), /10MB/);
  assert.throws(() => store.startUpload({ name: '', size: sample.length }), /名称/);
  const sessions = Array.from({ length: 4 }, () => store.startUpload({ name: 'sample.wav', size: sample.length }).uploadId);
  assert.throws(() => store.startUpload({ name: 'fifth.wav', size: sample.length }), /最多上传 4/);
  assert.deepEqual(store.chunkUpload({ uploadId: sessions[0], index: 0, base64 }), { nextIndex: 1 });
  assert.deepEqual(store.cancelUpload({ uploadId: sessions[0] }), { ok: true });
  assert.throws(() => store.chunkUpload({ uploadId: sessions[0], index: 0, base64 }), /不存在或已超过/);
  assert.deepEqual(store.cancelUpload({ uploadId: sessions[0] }), { ok: true });
  assert.throws(() => store.cancelUpload({ uploadId: '../outside' }), /身份无效/);
  const fresh = store.startUpload({ name: 'replacement.wav', size: sample.length }); assert.equal(store.uploads.size, 4);
  now += SPEECH_REFERENCE_UPLOAD_TTL;
  assert.throws(() => store.chunkUpload({ ...fresh, index: 0, base64 }), /不存在或已超过/); assert.equal(store.uploads.size, 0);
  const maximum = store.startUpload({ name: 'maximum.wav', size: SPEECH_REFERENCE_BYTES_LIMIT }); store.cancelUpload(maximum);
  assert.deepEqual(await store.list(), []); await assert.rejects(() => readFile(store.index), { code: 'ENOENT' });
}));

test('chunked uploads require complete ordered canonical chunks and defer disk writes until valid finalization', () => sandbox(async root => {
  const store = new SpeechReferenceStore(root), sample = wav(200000), base64 = sample.toString('base64'), upload = store.startUpload({ name: 'large.wav', size: sample.length });
  await assert.rejects(() => store.finishUpload(upload), /尚未上传完整/);
  assert.throws(() => store.chunkUpload({ ...upload, index: 1, base64: base64.slice(0, SPEECH_REFERENCE_CHUNK_SIZE) }), /顺序无效/);
  for (const chunk of [base64.slice(0, 4), base64.slice(0, SPEECH_REFERENCE_CHUNK_SIZE + 4), '!'.repeat(SPEECH_REFERENCE_CHUNK_SIZE), base64.slice(0, SPEECH_REFERENCE_CHUNK_SIZE - 4) + 'AA==']) assert.throws(() => store.chunkUpload({ ...upload, index: 0, base64: chunk }), /分块大小|分块编码/);
  assert.equal(store.uploads.get(upload.uploadId).chunks.length, 0);
  let index = 0;
  for (let offset = 0; offset < base64.length; offset += SPEECH_REFERENCE_CHUNK_SIZE) {
    assert.deepEqual(store.chunkUpload({ ...upload, index, base64: base64.slice(offset, offset + SPEECH_REFERENCE_CHUNK_SIZE) }), { nextIndex: index + 1 }); index++;
  }
  assert.throws(() => store.chunkUpload({ ...upload, index, base64: 'AAAA' }), /分块大小/);
  assert.deepEqual(await store.list(), []); await assert.rejects(() => readFile(store.index), { code: 'ENOENT' });
  const pending = store.finishUpload(upload); await assert.rejects(() => store.finishUpload(upload), /正在保存/);
  const reference = await pending; assert.equal(reference.size, sample.length); assert.equal(store.uploads.size, 0); assert.equal(await store.dataURL(reference.id), 'data:audio/wav;base64,' + base64);
  await assert.rejects(() => store.finishUpload(upload), /不存在或已超过/);
  const mismatched = store.startUpload({ name: 'wrong-size.wav', size: wav().length + 1 });
  assert.throws(() => store.chunkUpload({ ...mismatched, index: 0, base64: wav().toString('base64') }), /大小与声明不一致/); store.cancelUpload(mismatched);
  const forged = Buffer.from('pretend to be audio'), invalid = store.startUpload({ name: 'forged.wav', size: forged.length }); store.chunkUpload({ ...invalid, index: 0, base64: forged.toString('base64') });
  await assert.rejects(() => store.finishUpload(invalid), /有效的 WAV 或 MP3/); assert.equal(store.uploads.size, 0); assert.equal((await store.list()).length, 1);
}));

test('voice clone sends the documented audio.voice data URL and applies expression without exposing reference identity to the text model', async () => {
  const sampleURL = 'data:audio/wav;base64,' + wav().toString('base64'), config = cloneConfig(), requests = [], resolved = [];
  const speech = new XiaomiSpeech({ settings: () => config, key: () => 'tp-fixture', referenceAudio: async id => { resolved.push(id); return sampleURL; }, fetcher: async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return Response.json({ choices: [{ message: { audio: { data: wav().toString('base64') } } }] }); } });
  const result = await speech.synthesize('我陪你慢慢来。', 'clone-fixture', { style: '轻声安慰，句尾停顿' });
  assert.equal(result.type, 'record'); assert.deepEqual(resolved, [config.referenceAudio]);
  assert.equal(requests[0].url, config.baseURL + '/chat/completions'); assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].body.model, 'mimo-v2.5-tts-voiceclone'); assert.deepEqual(requests[0].body.audio, { format: 'wav', voice: sampleURL });
  assert.deepEqual(requests[0].body.messages.at(-1), { role: 'assistant', content: '我陪你慢慢来。' });
  const context = requests[0].body.messages[0].content; assert.match(context, /参考音频/); assert.match(context, /普通话，自然放松/); assert.match(context, /轻声安慰/);
  assert.ok(!context.includes('冰糖')); assert.ok(!context.includes(config.referenceAudio)); assert.ok(!context.includes(sampleURL));
  const direction = speechDirection(config); let aiInput;
  const style = await planSpeechStyle('我陪你慢慢来。', { direction, conversation: [{ speaker: 'user', text: '今天有点难过' }], ai: async (_question, input) => { aiInput = input; return '{"style":"轻声安慰，放慢语速"}'; } });
  assert.match(style, /安慰/); assert.match(direction.voice, /固定参考音频/); assert.equal(aiInput.text, '我陪你慢慢来。');
  for (const secret of [config.referenceAudio, sampleURL, '冰糖']) assert.ok(!JSON.stringify(aiInput).includes(secret));
  assert.match(speechContext(config, '开心一点'), /保持说话人音色不变/);
});

test('clone rejects missing or unavailable reference samples before making a TTS network request', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('unexpected networking'); };
  for (const [config, referenceAudio] of [[cloneConfig({ referenceAudio: '' }), async () => 'unused'], [cloneConfig(), undefined], [cloneConfig(), async () => { throw Error('参考音频不存在'); }], [cloneConfig(), async () => 'file:///tmp/voice.wav']]) {
    const speech = new XiaomiSpeech({ settings: () => config, key: () => 'tp-fixture', referenceAudio, fetcher });
    await assert.rejects(() => speech.synthesize('原文'), /参考音频/);
  }
  assert.equal(calls, 0);
});

test('existing settings gain an empty audio reference and keep their customized name, saved preset and design identity', () => {
  const config = defaults({ BOT_NAME: '我的角色' }); delete config.speech.referenceAudio; config.speech.voice = 'Dean'; config.speech.voiceDescription = '既有音色'; config.speech.style = '原有固定要求';
  const migrated = validateSettings(config); assert.equal(migrated.speech.referenceAudio, ''); assert.equal(migrated.bot.name, '我的角色'); assert.equal(migrated.speech.voice, 'Dean'); assert.equal(migrated.speech.voiceDescription, '既有音色'); assert.equal(migrated.speech.style, '原有固定要求'); assert.equal(config.speech.referenceAudio, undefined);
  assert.equal(defaults({}).bot.name, 'Qlyra');
  assert.throws(() => validateSettings({ ...migrated, speech: { ...migrated.speech, enabled: true, model: 'mimo-v2.5-tts-voiceclone' } }), /上传参考音频/);
  for (const referenceAudio of ['data:audio/wav;base64,AAAA', '../sample.wav', 'ref_fake']) assert.throws(() => validateSettings({ ...migrated, speech: { ...migrated.speech, referenceAudio } }), /referenceAudio/);
  const cloned = validateSettings({ ...migrated, speech: cloneConfig() }); assert.equal(cloned.speech.referenceAudio, cloneConfig().referenceAudio); assert.equal(cloned.speech.voice, SPEECH_DEFAULTS.voice);
});

async function httpFixture(work) {
  await sandbox(async root => {
    const store = new SettingsStore(new URL('settings.json', root), {}); await store.load();
    const vault = { get: key => key === 'mimoKey' ? 'tp-fixture' : null, flags: () => ({ mimoKey: true }) }, runtime = new BotRuntime(store, vault, { root });
    runtime.apply = () => {}; runtime.status = async () => ({ connected: false });
    const network = [], planning = []; let time = 0;
    runtime.speech.now = () => (time += 6000);
    runtime.speech.fetcher = async (url, options) => { network.push({ url, body: JSON.parse(options.body) }); return Response.json({ choices: [{ message: { audio: { data: wav().toString('base64') } } }] }); };
    runtime.ai = async (_question, context) => { planning.push(context); return '{"style":"轻声安慰，语速稍慢，句间停顿"}'; };
    const admin = await startAdmin({ store, vault, runtime, root, port: 0 }); let cookie = '', csrf = '';
    const call = async (path, method = 'POST', value, headers = {}, authenticated = true) => {
      const response = await fetch(admin.origin + '/api/' + path, { method, headers: { origin: admin.origin, 'content-type': 'application/json', ...(authenticated ? { cookie, 'x-csrf-token': csrf } : {}), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
      return { status: response.status, headers: response.headers, data: await response.json() };
    };
    const login = await call('session', 'POST', { key: admin.accessKey }, {}, false); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = login.data.csrf;
    try { await work({ root, store, runtime, call, network, planning }); } finally { runtime.stop(); await admin.close(); }
  });
}

test('authenticated HTTP audio upload, local preview, settings persistence and clone synthesis form a complete local workflow', () => httpFixture(async ({ root, store, call, network }) => {
  const input = { name: '仅用于声音复刻.wav', base64: wav().toString('base64') };
  assert.equal((await call('speech/reference', 'POST', input, {}, false)).status, 401);
  assert.equal((await call('speech/reference', 'POST', input, { 'x-csrf-token': '' })).status, 403);
  const uploaded = await call('speech/reference', 'POST', input); assert.equal(uploaded.status, 200); const reference = uploaded.data.reference;
  assert.equal((await call('speech/reference/preview', 'POST', { id: reference.id }, {}, false)).status, 401);
  const preview = await call('speech/reference/preview', 'POST', { id: reference.id }); assert.equal(preview.status, 200); assert.deepEqual(preview.data.reference, reference); assert.equal(preview.data.dataURL, 'data:audio/wav;base64,' + input.base64);
  const missing = store.get(); missing.speech = cloneConfig({ referenceAudio: 'ref_' + '0'.repeat(64) });
  assert.equal((await call('settings', 'PUT', { settings: missing, revision: missing.revision })).status, 400); assert.equal(store.get().speech.referenceAudio, '');
  const settings = store.get(); settings.speech = cloneConfig({ referenceAudio: reference.id });
  assert.equal((await call('settings', 'PUT', { settings, revision: settings.revision })).status, 200);
  const persisted = await readFile(new URL('settings.json', root), 'utf8'); assert.ok(persisted.includes(reference.id)); assert.ok(!persisted.includes(input.base64)); assert.ok(!persisted.includes(input.name)); assert.ok(!persisted.includes('speech-references'));
  const publicState = await call('state', 'GET'); assert.equal(publicState.status, 200); assert.equal(publicState.data.settings.speech.referenceAudio, reference.id); assert.ok(!JSON.stringify(publicState.data).includes(input.base64));
  const spoken = await call('speech/preview', 'POST', { text: '你好，我在这里。', style: '微笑着说，语速舒缓' }); assert.equal(spoken.status, 200); assert.equal(spoken.data.style, '微笑着说，语速舒缓'); assert.match(spoken.data.dataURL, /^data:audio\/wav;base64,/);
  assert.equal(network.length, 1); assert.equal(network[0].body.audio.voice, preview.data.dataURL); assert.deepEqual(network[0].body.messages.at(-1), { role: 'assistant', content: '你好，我在这里。' });
  const reload = new SettingsStore(new URL('settings.json', root), {}); await reload.load(); assert.equal(reload.get().speech.referenceAudio, reference.id);
  assert.equal((await call('speech/reference', 'POST', { name: 'sample.mp3', base64: mp3().toString('base64') })).data.reference.mime, 'audio/mpeg');
}));

test('HTTP chunked upload transfers a reference larger than 100KB using only requests below the NapCat JSON parser limit', () => httpFixture(async ({ runtime, call }) => {
  const sample = wav(200000), base64 = sample.toString('base64'), startInput = { name: 'large-reference.wav', size: sample.length };
  assert.ok(sample.length > 100 * 1024);
  assert.equal((await call('speech/reference/start', 'POST', startInput, {}, false)).status, 401);
  assert.equal((await call('speech/reference/start', 'POST', startInput, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await call('speech/reference/start', 'POST', { ...startInput, size: SPEECH_REFERENCE_BYTES_LIMIT + 1 })).status, 400);
  const started = await call('speech/reference/start', 'POST', startInput); assert.equal(started.status, 200); const { uploadId } = started.data;
  assert.equal((await call('speech/reference/finish', 'POST', { uploadId })).status, 400);
  assert.equal((await call('speech/reference/chunk', 'POST', { uploadId, index: 1, base64: base64.slice(0, SPEECH_REFERENCE_CHUNK_SIZE) })).status, 400);
  let index = 0;
  for (let offset = 0; offset < base64.length; offset += SPEECH_REFERENCE_CHUNK_SIZE) {
    const input = { uploadId, index, base64: base64.slice(offset, offset + SPEECH_REFERENCE_CHUNK_SIZE) };
    assert.ok(Buffer.byteLength(JSON.stringify(input)) < 100 * 1024);
    const response = await call('speech/reference/chunk', 'POST', input); assert.equal(response.status, 200); assert.equal(response.data.nextIndex, ++index);
  }
  assert.deepEqual(await runtime.speechReferences.list(), []);
  const finished = await call('speech/reference/finish', 'POST', { uploadId }); assert.equal(finished.status, 200); assert.equal(finished.data.reference.size, sample.length); assert.equal(runtime.speechReferences.uploads.size, 0);
  const preview = await call('speech/reference/preview', 'POST', { id: finished.data.reference.id }); assert.equal(preview.status, 200); assert.equal(preview.data.dataURL, 'data:audio/wav;base64,' + base64);
  const cancelled = await call('speech/reference/start', 'POST', startInput);
  assert.equal((await call('speech/reference/cancel', 'POST', cancelled.data)).status, 200);
  assert.equal((await call('speech/reference/finish', 'POST', cancelled.data)).status, 400);
  for (const [path, input] of [['speech/reference/start', { ...startInput, path: '../file' }], ['speech/reference/chunk', { uploadId, index: 0, base64: 'AAAA', extra: true }], ['speech/reference/finish', { uploadId, extra: true }], ['speech/reference/cancel', { uploadId: '../outside' }]]) assert.equal((await call(path, 'POST', input)).status, 400);
}));

test('HTTP automatic preview plans from bounded conversation, keeps exact spoken text, honors manual override and exposes planning failures', () => httpFixture(async ({ store, runtime, call, network, planning }) => {
  const uploaded = await call('speech/reference', 'POST', { name: 'PRIVATE_SAMPLE_NAME.wav', base64: wav().toString('base64') }), reference = uploaded.data.reference;
  const settings = store.get(); settings.speech = cloneConfig({ referenceAudio: reference.id }); await store.update(settings, settings.revision);
  const text = '我会陪着你，慢慢来。', conversation = '今天没通过考试，有一点失落';
  const automatic = await call('speech/preview', 'POST', { text, autoStyle: true, conversation }); assert.equal(automatic.status, 200); assert.match(automatic.data.style, /安慰/);
  assert.equal(planning.length, 1); assert.equal(planning[0].text, text); assert.deepEqual(planning[0].conversation, [{ speaker: 'user', text: conversation }]);
  for (const secret of [reference.id, 'PRIVATE_SAMPLE_NAME', wav().toString('base64')]) assert.ok(!JSON.stringify(planning[0]).includes(secret));
  assert.deepEqual(network[0].body.messages.at(-1), { role: 'assistant', content: text }); assert.match(network[0].body.messages[0].content, /轻声安慰/);
  const manual = await call('speech/preview', 'POST', { text, autoStyle: true, conversation, style: '热情明快' }); assert.equal(manual.status, 200); assert.equal(manual.data.style, '热情明快'); assert.equal(planning.length, 1);
  const legacy = await call('speech/preview', 'POST', { text }); assert.equal(legacy.status, 200); assert.equal(legacy.data.style, ''); assert.equal(planning.length, 1);
  const invalid = [{ text, autoStyle: 'true' }, { text, conversation: 'x'.repeat(1001) }, { text, conversation: {} }, { text, conversation: 'bad\0input' }, { text, style: {} }, { text, style: 'x'.repeat(301) }, { text, voice: 'Dean' }, [], null];
  for (const value of invalid) assert.equal((await call('speech/preview', 'POST', value)).status, 400);
  for (const value of [{ name: 'sample.wav', base64: 'AAAA', path: '../outside' }, { id: '../outside' }]) assert.equal((await call(value.id ? 'speech/reference/preview' : 'speech/reference', 'POST', value)).status, 400);
  assert.equal(network.length, 3); assert.equal(planning.length, 1);
  runtime.ai = async () => { throw Error('fixture 模型离线'); };
  const failed = await call('speech/preview', 'POST', { text, autoStyle: true, conversation }); assert.equal(failed.status, 400); assert.match(failed.data.error, /自动语气分析未完成.*fixture 模型离线/); assert.equal(network.length, 3);
}));

test('HTTP preview rejects settings or key changes during automatic planning before TTS can use stale instructions', () => httpFixture(async ({ store, runtime, call, network }) => {
  const reference = (await call('speech/reference', 'POST', { name: 'sample.wav', base64: wav().toString('base64') })).data.reference;
  const settings = store.get(); settings.speech = cloneConfig({ referenceAudio: reference.id }); await store.update(settings, settings.revision);
  for (const change of ['settings','key']) {
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    runtime.ai = async () => { entered(); await gate; return '{"style":"轻声安慰"}'; };
    const pending = call('speech/preview', 'POST', { text: '慢慢来。', autoStyle: true, conversation: '我有点难过' }); await ready;
    if (change === 'settings') { const current = store.get(); current.speech.style = '语速稍快'; await store.update(current, current.revision); }
    else runtime.vault.get = key => key === 'mimoKey' ? 'tp-updated-fixture' : null;
    release(); const result = await pending; assert.equal(result.status, 409); assert.match(result.data.error, /设置或授权已改变/); assert.equal(network.length, 0);
  }
}));
