export const MEDIA_MOODS = Object.freeze({
  '开心': /开心|好耶|哈哈|笑|高兴|快乐|耶|棒|成功|庆祝|鼓掌|赞|太好|厉害|赢/u,
  '安慰': /抱抱|摸头|别担心|辛苦|难过|伤心|哭|委屈|累|压力|加油|努力|安慰/u,
  '疑惑': /疑问|疑惑|不懂|听不懂|想不起来|怎么|什么|为啥|为何|问号|[？?]{2,}|思考/u,
  '惊讶': /惊|吓|震惊|居然|竟然|不会吧|天哪|诶/u,
  '害羞': /害羞|脸红|可爱|喜欢|爱你|贴贴|比心|心动/u,
  '无语': /无语|嫌弃|无奈|叹气|尴尬|流汗|社死|离谱|看戏|盯|沉默/u,
  '生气': /生气|气死|愤怒|哼|火大|别惹/u,
  '问候': /你好|早安|晚上好|晚安|再见|拜拜|睡|困|打扰|冒泡|探头|闪亮登场/u,
  '收到': /收到|明白|知道|好哒|好的|了解|交给我|没问题|谢谢|感谢|ok|[oＯ][kＫ]/iu,
});

export function mediaTags(name) { return Object.entries(MEDIA_MOODS).filter(([, pattern]) => pattern.test(name)).map(([mood]) => mood); }

function stableOrder(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return hash >>> 0;
}

// Choose a bounded, relevant menu rather than hiding every sticker after item 80.
// Only already-authorized library items enter this function.
export function selectReplyMedia(items, question, limit = 40) {
  const moods = mediaTags(question), normalized = question.toLowerCase();
  const ranked = items.map(item => {
    const pack = item.source?.pack || '', tags = item.source?.tags || mediaTags(item.name);
    const keywords = [pack, ...(item.source?.aliases || []), item.name.split(/[·-]/u).at(-1)].filter(word => word?.length >= 2);
    const score = keywords.reduce((sum, word) => sum + (normalized.includes(word.toLowerCase()) ? 12 : 0), 0)
      + tags.filter(tag => moods.includes(tag)).length * 5 + (item.scope?.includes(':account:') ? 0 : 1);
    return { item, pack, tags, score, order: stableOrder(question + item.id) };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const selected = [], skipped = [], counts = new Map();
  for (const row of ranked) {
    const count = counts.get(row.pack) || 0;
    if (row.pack && count >= 4) { skipped.push(row); continue; }
    selected.push(row); counts.set(row.pack, count + 1);
    if (selected.length === limit) break;
  }
  if (selected.length < limit) selected.push(...skipped.slice(0, limit - selected.length));
  return selected.map(({ item, pack, tags }) => ({ id: item.id, name: item.name, type: item.type, ...(pack ? { pack } : {}), ...(tags.length ? { tags } : {}) }));
}
