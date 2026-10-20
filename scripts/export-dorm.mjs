import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJSON, readJSON } from '../src/core.mjs';
import { SettingsStore } from '../src/settings.mjs';
const store = new SettingsStore(); await store.load();
const groupId = process.argv[2];
if (!/^\d{5,15}$/.test(groupId || '') || !store.get().groups.some(g => g.id === groupId && g.enabled && g.historyEnabled)) throw new Error('请传入已授权历史归纳的群号。');
const root = new URL(`../data/history/${groupId}/manual-export/`, import.meta.url);
await mkdir(root, { recursive: true });
const config = JSON.parse(await readFile(join(process.env.USERPROFILE, '.qq-chat-exporter', 'security.json'), 'utf8'));
async function call(path, body) {
  const response = await fetch('http://127.0.0.1:40653' + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + config.accessToken, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error('QCE 导出请求失败，HTTP ' + response.status);
  return result.data;
}
if (process.argv.includes('--status')) {
  const task = await readJSON(new URL('task.json', root), null);
  const result = await call('/api/tasks/' + encodeURIComponent(task.taskId));
  console.log(JSON.stringify({ status: result.status, progress: result.progress, messageCount: result.messageCount, error: result.error, fileName: result.fileName }));
} else {
  const result = await call('/api/messages/export', { peer: { chatType: 2, peerUid: groupId }, sessionName: 'group-' + groupId, format: 'JSON', filter: { includeRecalled: false, includeSystem: false }, options: { outputDir: fileURLToPath(root), batchSize: 1000, prettyFormat: true, includeResourceLinks: false, includeSystemMessages: false, skipDownloadResourceTypes: ['image', 'video', 'audio', 'file', 'avatar', 'sticker'], embedAvatarsAsBase64: false } });
  await saveJSON(new URL('task.json', root), result);
  console.log(JSON.stringify({ taskId: result.taskId, status: result.status, fileName: result.fileName }));
}
