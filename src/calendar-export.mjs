import { createHash } from 'node:crypto';

const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const utcStamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function foldLine(line) {
  const lines = []; let current = '', length = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (length + size > 75) { lines.push(current); current = ' '; length = 1; }
    current += char; length += size;
  }
  lines.push(current); return lines.join('\r\n');
}

export function calendarExport(item, { start, end, allDay = false } = {}, now = Date.now()) {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') throw new Error('请先选择待办。');
  if (typeof start !== 'string' || typeof end !== 'string' || typeof allDay !== 'boolean') throw new Error('请填写明确的开始和结束时间。');
  let first, last;
  if (allDay) {
    if (!validDay(start) || !validDay(end) || end <= start) throw new Error('全天事项的结束日期须晚于开始日期，结束日期不包含在日程内。');
    first = start.replaceAll('-', ''); last = end.replaceAll('-', '');
  } else {
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (![start, end].every(value => timestamp.test(value) && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value))) || Date.parse(end) <= Date.parse(start)) throw new Error('请选择有效时间，结束须晚于开始；时间必须带时区。');
    first = utcStamp(start); last = utcStamp(end);
  }
  const title = item.title.slice(0, 200), description = [String(item.summary || '').slice(0, 2000), item.groupName || item.groupId ? '来源：' + (item.groupName || '群 ' + item.groupId) : '', item.deadlineText ? '时间原文：' + item.deadlineText : '', ...(item.sources || []).slice(0, 4).map(source => '依据：' + String(source.excerpt || '').slice(0, 500))].filter(Boolean).join('\n\n');
  const google = new URL('https://calendar.google.com/calendar/render');
  google.searchParams.set('action', 'TEMPLATE'); google.searchParams.set('text', title); google.searchParams.set('dates', first + '/' + last); google.searchParams.set('details', description); google.searchParams.set('ctz', 'Asia/Shanghai');
  const uid = createHash('sha256').update(item.id).digest('hex').slice(0, 32) + '@qq-agent.local';
  const dateKind = allDay ? ';VALUE=DATE' : '';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QQ Agent//Local To Do//ZH-CN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + utcStamp(now), `DTSTART${dateKind}:${first}`, `DTEND${dateKind}:${last}`, 'SUMMARY:' + escapeText(title), 'DESCRIPTION:' + escapeText(description), 'END:VEVENT', 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
  return { title, description, start, end, allDay, googleUrl: google.href, ics, filename: 'todo-' + uid.split('@')[0] + '.ics', mode: 'preview' };
}
