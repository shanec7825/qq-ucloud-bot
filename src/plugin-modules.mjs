import { readFileSync } from 'node:fs';
import { MODULE_IDS } from './module-registry.mjs';

export function moduleActive(root, module) {
  try {
    const installation = JSON.parse(readFileSync(new URL('napcat-ui.json', root), 'utf8'));
    if (!installation.managedModules) return true;
  } catch (error) { if (error.code === 'ENOENT') return true; return false; }
  if (!MODULE_IDS.includes(module)) return false;
  try { return JSON.parse(readFileSync(new URL('napcat-modules/' + module + '.json', root), 'utf8')).active === true; }
  catch { return false; }
}
