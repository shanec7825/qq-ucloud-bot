// Shared by delivery and the local settings preview; this module has no I/O.
export const NOTICE_FILTER_DEFAULTS = Object.freeze({ includeKeywords: '', excludeKeywords: '', senderQQs: '', minPriority: 'important', outputFormat: 'detailed' });
export const NOTICE_DIGEST_DEFAULTS = Object.freeze({ template: 'inherit', templatePrompt: '', outputFormat: 'concise' });
export const noticeList = value => [...new Set(String(value || '').split(/[\n,，;；、]+/u).map(item => item.trim()).filter(Boolean))];
export const noticeSenders = value => [...new Set(String(value || '').split(/[\s,，;；、]+/u).filter(Boolean))];

export function matchesNoticeFilters(message, senderQQ, config = {}) {
  const senders = noticeSenders(config.senderQQs);
  if (senders.length && !senders.includes(String(senderQQ))) return false;
  const text = String(message).toLocaleLowerCase('zh-CN');
  const include = noticeList(config.includeKeywords).map(word => word.toLocaleLowerCase('zh-CN'));
  const exclude = noticeList(config.excludeKeywords).map(word => word.toLocaleLowerCase('zh-CN'));
  return (!include.length || include.some(word => text.includes(word))) && !exclude.some(word => text.includes(word));
}

export function formatNoticeItems(items, outputFormat = 'concise') {
  const detailed = outputFormat === 'detailed';
  return items.map(item => {
    const fullSummary = String(item.summary || '');
    const briefSummary = fullSummary.replace(/\s*\n+\s*/gu, '；');
    const summary = detailed ? fullSummary : briefSummary.slice(0, 220) + (briefSummary.length > 220 ? '…' : '');
    const title = `【${item.title}】${summary}`;
    const deadline = item.deadlineText ? `\n时间原文：${item.deadlineText}` : '';
    const sources = (item.sources || []).slice(0, detailed ? 4 : 1).map(source => {
      const location = [source.groupId ? `群 ${source.groupId}` : '', detailed ? source.time : ''].filter(Boolean).join(' · ');
      return `依据：${location ? location + '｜' : ''}${String(source.excerpt || '').slice(0, detailed ? 300 : 90)}`;
    });
    return title + deadline + (sources.length ? '\n' + sources.join('\n') : '');
  }).join('\n\n');
}
