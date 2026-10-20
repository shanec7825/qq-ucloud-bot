import qqFaces from './qq-faces.json' with { type: 'json' };

const decode = value => String(value).replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#44;/g, ',').replace(/&amp;/g, '&');

export function faceName(data = {}) {
  // NapCat includes the current QQ label in raw.faceText, including newer faces.
  for (const candidate of [data.raw?.faceText, data.text, data.name, qqFaces[String(data.id)]]) {
    const label = String(candidate || '').replace(/^\/+/, '').trim().slice(0, 80);
    if (label && !/^\d+$/.test(label)) return label;
  }
  return '未识别的表情，无法判断含义';
}

export function segments(event) {
  if (Array.isArray(event.message)) return event.message;
  const input = String(event.raw_message || event.message || '');
  const result = []; let end = 0;
  for (const match of input.matchAll(/\[CQ:([\w]+)((?:,[^\]]*)?)\]/g)) {
    if (match.index > end) result.push({ type: 'text', data: { text: decode(input.slice(end, match.index)) } });
    const data = Object.fromEntries(match[2].slice(1).split(',').filter(Boolean).map(pair => { const index = pair.indexOf('='); return [pair.slice(0, index), decode(pair.slice(index + 1))]; }));
    result.push({ type: match[1], data }); end = match.index + match[0].length;
  }
  if (end < input.length) result.push({ type: 'text', data: { text: decode(input.slice(end)) } });
  return result;
}

const names = { image: '图片或表情包', mface: '商城表情包', face: 'QQ表情', record: '语音', video: '视频', file: '文件', reply: '引用消息', forward: '合并转发', node: '转发节点', json: '分享卡片', xml: '分享卡片', share: '链接分享', contact: '联系人卡片', location: '位置', music: '音乐', dice: '骰子', rps: '猜拳', markdown: 'Markdown', lightapp: '小程序', poke: '戳一戳', shake: '窗口抖动' };
export function contentText(event) {
  return segments(event).map(({ type, data = {} }) => {
    if (type === 'text') return String(data.text || '');
    if (type === 'at') return '';
    if (type === 'face') return `[QQ表情：${faceName(data)}]`;
    if (type === 'node' && Array.isArray(data.content)) return '[转发节点] ' + contentText({ message: data.content });
    const detail = type === 'json' || type === 'xml' ? data.data : data.summary || data.name || data.title || (['dice', 'rps'].includes(type) ? data.id || data.result : '');
    return `[${names[type] || '消息类型:' + type}${detail ? '：' + String(detail).slice(0, 1200) : ''}]`;
  }).join(' ').trim().slice(0, 4000);
}
