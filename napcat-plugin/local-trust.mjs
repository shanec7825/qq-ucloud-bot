import { PLUGIN_MODULES } from './catalog.mjs';

// Exact local module IDs only. Preserve upstream restrictions and sensitive-word checks.
export function trustAgentPlugins(source) {
  const replacement = 'return this.isOfficialPlugin($1) || (' + JSON.stringify(PLUGIN_MODULES.map(item => item.id)) + '.includes($1) && !$2) ? null : $2 ?';
  const current = /return this\.isOfficialPlugin\((\w+)\) \|\| \(\[(?:"napcat-plugin-[a-z-]+",?)+\]\.includes\(\1\) && !(\w+)\) \? null : \2 \?/g;
  const one = /return this\.isOfficialPlugin\((\w+)\) \|\| \(\1 === "napcat-plugin-slyra" && !(\w+)\) \? null : \2 \?/g;
  const original = /return this\.isOfficialPlugin\((\w+)\) \? null : (\w+) \?/g;
  for (const pattern of [current, one, original]) {
    const matches = [...source.matchAll(pattern)]; if (matches.length !== 1) continue;
    if (pattern === current) {
      const ids = JSON.parse(matches[0][0].match(/\[[^\]]+\]/)[0]).sort().join(',');
      const knownVersions = [
        ['napcat-plugin-slyra', 'napcat-plugin-slyra-monitor'],
        ['napcat-plugin-qq-agent', 'napcat-plugin-agent-github', 'napcat-plugin-agent-drive', 'napcat-plugin-agent-ucloud', 'napcat-plugin-agent-notices'],
        PLUGIN_MODULES.map(item => item.id),
      ];
      if (!knownVersions.some(version => [...version].sort().join(',') === ids)) throw new Error('加载器包含其他本机信任项，未覆盖。');
    }
    return source.replace(pattern, replacement);
  }
  throw new Error('NapCat 插件加载器版本不匹配，未修改。');
}
