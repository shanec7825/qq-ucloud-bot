import { SchoolClient } from '../src/core.mjs';
import { pathToFileURL } from 'node:url';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const source = pathToFileURL(join(process.cwd(), 'data/session.json'));
try {
  const tasks = await new SchoolClient(source).tasks();
  console.log(JSON.stringify({ stage: 'source-session', ok: true, tasks: tasks.length }));
  if (process.argv.includes('--restore-active')) {
    const target = join(process.env.LOCALAPPDATA, 'QQAgent/workspace/data/session.json');
    let exists = false;
    try { await access(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) { await mkdir(join(process.env.LOCALAPPDATA, 'QQAgent/workspace/data'), { recursive: true }); await copyFile(source, target, constants.COPYFILE_EXCL); }
    const current = await new SchoolClient(pathToFileURL(target)).tasks();
    console.log(JSON.stringify({ stage: 'active-session', ok: true, restored: !exists, tasks: current.length }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code || error.name, message: error.message.replace(/(?:file:\/\/\/|[A-Z]:\\)[^\s]+/gi, '[local-path]') }));
  process.exitCode = 1;
}
