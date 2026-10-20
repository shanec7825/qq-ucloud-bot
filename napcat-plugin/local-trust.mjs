// A narrow compatibility patch for NapCat builds with a hardcoded official-plugin list.
// Other non-official plugins stay blocked; sensitive-word checks still apply to both adapters.
export function trustSlyraPlugin(source) {
  const patched = /return this\.isOfficialPlugin\((\w+)\) \|\| \(\["napcat-plugin-slyra","napcat-plugin-slyra-monitor"\]\.includes\(\1\) && !(\w+)\) \? null/;
  if (patched.test(source)) return source;
  const legacy = /return this\.isOfficialPlugin\((\w+)\) \|\| \(\1 === "napcat-plugin-slyra" && !(\w+)\) \? null : \2 \?/g;
  if ([...source.matchAll(legacy)].length === 1) return source.replace(legacy, 'return this.isOfficialPlugin($1) || (["napcat-plugin-slyra","napcat-plugin-slyra-monitor"].includes($1) && !$2) ? null : $2 ?');
  const expected = /return this\.isOfficialPlugin\((\w+)\) \? null : (\w+) \?/g;
  if ([...source.matchAll(expected)].length !== 1) throw new Error('NapCat 插件加载器版本不匹配，未修改。');
  return source.replace(expected, 'return this.isOfficialPlugin($1) || (["napcat-plugin-slyra","napcat-plugin-slyra-monitor"].includes($1) && !$2) ? null : $2 ?');
}
