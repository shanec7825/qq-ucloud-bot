import { readFile, writeFile, readdir } from 'node:fs/promises';
const folder = new URL('../tools/napcat/napcat/config/', import.meta.url);
const token = process.env.ONEBOT_ACCESS_TOKEN;
if (!token) throw new Error('缺少 OneBot token。');
const config = { network: { httpServers: [], httpSseServers: [], httpClients: [], websocketServers: [{ name: 'homework-bot', enable: true, host: '127.0.0.1', port: 3001, messagePostFormat: 'array', reportSelfMessage: false, token, enableForcePushEvent: true, debug: false, heartInterval: 30000 }], websocketClients: [], plugins: [] }, musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false, imageDownloadProxy: '', timeout: { baseTimeout: 10000, uploadSpeedKBps: 256, downloadSpeedKBps: 256, maxTimeout: 1800000 } };
const names = await readdir(folder);
const files = ['onebot11.json', ...names.filter(name => /^onebot11_\d+\.json$/.test(name))];
for (const file of files) await writeFile(new URL(file, folder), JSON.stringify(config, null, 2), { mode: 0o600 });
const webuiFile = new URL('webui.json', folder);
try { const webui = JSON.parse(await readFile(webuiFile, 'utf8')); webui.host = '127.0.0.1'; await writeFile(webuiFile, JSON.stringify(webui, null, 2)); } catch {}
console.log('已配置本机 OneBot 服务及鉴权，登录后生效；WebUI 本机监听配置将在重启时生效。');
