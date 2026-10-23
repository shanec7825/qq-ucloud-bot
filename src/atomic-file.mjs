import { rename } from 'node:fs/promises';

// Windows scanners and concurrent readers can briefly deny replacement. Keep
// the destination intact and retry only the atomic rename, never delete it.
export async function replaceFile(source, destination, { renameFile = rename, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await renameFile(source, destination); }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await wait(20 * 2 ** attempt);
    }
  }
}
