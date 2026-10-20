import { spawn } from 'node:child_process';
import { askCodex } from '../src/codex-ai.mjs';
const clean = text => text.replace(/Bearer\s+\S+/gi, 'Bearer [hidden]').replace(/eyJ[A-Za-z0-9_.-]{40,}/g, '[hidden]').replace(/([?&](?:token|ticket|code|key)=)[^\s&]+/gi, '$1[hidden]');
function runner(binary, args, options) {
  const child = spawn(binary, args, options);
  let log = '';
  child.stderr.on('data', chunk => { log += chunk.toString(); if (log.length > 4000) log = log.slice(-4000); });
  child.on('close', code => { if (code) console.log(clean(log)); });
  return child;
}
try { console.log(await askCodex('请仅回复：连接成功', {}, process.env, runner)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
