import { open, mkdir, unlink, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AdminBridge } from './bridge.mjs';

// Both NapCat extensions share one local engine. Never terminate a process owned by another launcher.
export async function ensureEngine(projectRoot, nodeBinary) {
  const bridge = new AdminBridge(projectRoot);
  const ready = async () => { try { return (await bridge.request('GET', 'state')).status === 200; } catch { return false; } };
  if (await ready()) return;
  if (typeof nodeBinary !== 'string' || !isAbsolute(nodeBinary)) throw new Error('Missing Node runtime; reinstall the NapCat extensions.');
  const data = join(projectRoot, 'data'); await mkdir(data, { recursive: true });
  const lockPath = join(data, 'napcat-engine.lock'); let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stamp = Number(await readFile(lockPath, 'utf8'));
    if (Number.isFinite(stamp) && Date.now() - stamp > 60000) { await unlink(lockPath); return ensureEngine(projectRoot, nodeBinary); }
    for (let count = 0; count < 30; count++) { await delay(500); if (await ready()) return; }
    throw new Error('Shared slyra engine did not become ready.');
  }
  try {
    await lock.writeFile(String(Date.now()));
    if (await ready()) return;
    const log = await open(join(data, 'napcat-engine.log'), 'a', 0o600);
    try {
      const child = spawn(nodeBinary, ['--env-file-if-exists=.env', 'src/main.mjs'], { cwd: projectRoot, windowsHide: true, detached: true, shell: false, stdio: ['ignore', log.fd, log.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    } finally { await log.close(); }
    for (let count = 0; count < 30; count++) { await delay(500); if (await ready()) return; }
    throw new Error('slyra engine failed to start; check data/napcat-engine.log.');
  } finally { await lock.close(); await unlink(lockPath).catch(() => {}); }
}
