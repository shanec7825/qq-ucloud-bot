import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
const origin = 'http://127.0.0.1:6099';
const config = JSON.parse(await readFile(new URL('../tools/napcat/napcat/config/webui.json', import.meta.url), 'utf8'));
let credential;
async function api(path, body) {
  const response = await fetch(origin + '/api/' + path, { method:body === undefined ? 'GET' : 'POST', signal:AbortSignal.timeout(30000), headers:{ 'content-type':'application/json', origin, ...(credential ? { authorization:'Bearer ' + credential } : {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok || value.code !== 0) throw Error('NapCat 操作失败：' + path); return value.data;
}
credential = (await api('auth/login', { hash:createHash('sha256').update(config.token + '.napcat').digest('hex') })).Credential;
if (!credential) throw Error('NapCat 认证失败。');
const before = await api('Plugin/List');
for (const p of PLUGIN_MODULES) {
  const installed = before.plugins.find(item => item.id === p.id);
  if (installed?.status !== 'active') continue;
  await api('Plugin/SetStatus', { id:p.id, enable:false });
  await api('Plugin/SetStatus', { id:p.id, enable:true });
}
const after = await api('Plugin/List');
console.log(JSON.stringify({ modules:after.plugins.filter(p => PLUGIN_MODULES.some(item => item.id === p.id)).map(p => ({ id:p.id,status:p.status })), extensionPages:after.extensionPages.filter(p => PLUGIN_MODULES.some(item => item.id === p.pluginId)).map(p => ({ pluginId:p.pluginId,path:p.path,title:p.title })) }));
