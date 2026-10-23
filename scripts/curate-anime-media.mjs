import { writeFile } from 'node:fs/promises';

// Public, fixed package IDs from the BiliEmoji index. No cookies or user data.
const packages = [91, 111, 115, 123, 158, 175, 187, 202, 265, 410, 474, 714, 801, 803, 1240, 1241, 1301, 1339, 1803, 2035];
const indexRevision = '224dd0d5e63f1459df0f6b53873e91275a3a1296';
const aliases = {
  91: ['公主连结', '佩可', '凯露', '可可萝'], 111: ['约会大作战', '约战'], 115: ['初音未来', '初音', 'Miku'],
  123: ['约会大作战', '狂三'], 158: ['总之就是非常可爱', '小司'], 175: ['约会大作战', '白之女王'],
  187: ['小埋', '干物妹'], 202: ['柯南', 'Conan'], 265: ['工作细胞', '血小板'], 410: ['约会大作战', '约战'],
  474: ['初音未来', '初音', 'Miku'], 714: ['初音未来', '初音', 'Miku'], 801: ['小新', '蜡笔小新'],
  803: ['pop子', 'pipi美', 'Pop Team Epic'], 1240: ['铃芽之旅', '大臣'], 1241: ['平家物语', '犬王'],
  1301: ['摇曳露营', '露营', '抚子', '凛'], 1339: ['咒术回战', '五条悟', '虎杖'], 1803: ['柯南', '黑暗组织'],
  2035: ['pop子', 'pipi美', 'Pop Team Epic'],
};

const response = await fetch('https://api.bilibili.com/x/emote/package?business=reply&ids=' + packages.join(','), {
  headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error',
});
if (!response.ok) throw Error('表情目录请求失败：' + response.status);
const result = await response.json();
if (result.code !== 0 || !Array.isArray(result.data?.packages) || result.data.packages.length !== packages.length) throw Error('公开表情目录不完整，未更新本机目录。');
const used = new Set();
const packs = result.data.packages.map(pack => ({
  id: pack.id, name: pack.text, aliases: aliases[pack.id] || [],
  sourceURL: 'https://github.com/lrhtony/BiliEmoji/tree/' + indexRevision + '/src/' + encodeURIComponent(pack.text),
  items: pack.emote.map(item => {
    const url = new URL(item.url); url.protocol = 'https:';
    if (!/^i[0-2]\.hdslb\.com$/.test(url.hostname) || !/^\/bfs\/(?:emote|garb)\/[a-f0-9]+\.(png|gif|webp)$/.test(url.pathname) || url.search || url.username || url.password || url.port || used.has(item.id)) throw Error('目录包含无效的图片地址或重复编号，未更新：' + item.text + ' ' + url.href);
    used.add(item.id);
    const name = item.text.replace(/^\[|\]$/gu, '').replace('_', '·');
    if (!name || name.length > 60) throw Error('素材名称不符合本机素材库要求。');
    return { id: 'anime_bili_' + item.id, name, imageURL: url.href };
  }),
}));
await writeFile(new URL('../src/anime-media-catalog.json', import.meta.url), JSON.stringify({
  source: 'Bilibili / BiliEmoji', indexRevision, catalogCheckedAt: new Date().toISOString(),
  note: '公开图片与名称来自 B 站表情详情接口；权利归原作者。目录可访问性不代表获得商业再分发授权。', packs,
}, null, 2) + '\n');
console.log(JSON.stringify({ packs: packs.length, stickers: used.size }));
