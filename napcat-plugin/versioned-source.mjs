import { createHash } from 'node:crypto';

// NapCat cache-busts only the entry module; version its relative ESM imports too.
export function pluginBuildId(sources) {
  return createHash('sha256').update(sources.join('\n')).digest('hex').slice(0, 20);
}
export function versionedPluginSource(source, buildId) {
  if (!/^[a-f0-9]{20}$/.test(buildId)) throw new Error('Invalid plugin build identity.');
  return source.replace(/(\bfrom\s*['"])(\.\/[\w./-]+\.mjs)(['"])/g, '$1$2?qlyra=' + buildId + '$3');
}
