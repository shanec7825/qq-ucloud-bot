// QQ text segments deliberately remain text, including any literal CQ syntax.
export function qqPlainText(value) {
  const input = String(value ?? '').replace(/\r\n/g, '\n');
  let prefix = '\u0000qq-code:';
  while (input.includes(prefix)) prefix += ':';
  const protectedText = [];
  const protect = text => {
    const token = prefix + protectedText.length + '\u0000';
    protectedText.push(text);
    return token;
  };
  const lines = input.split('\n'), prose = [];
  for (let index = 0; index < lines.length; index++) {
    const fence = lines[index].match(/^ {0,3}(`{3,})([^`\n]*)$|^ {0,3}(~{3,})[^\n]*$/);
    if (fence) {
      const marker = fence[1] || fence[3];
      const body = [], closing = new RegExp('^ {0,3}' + marker[0] + '{' + marker.length + ',}[ \\t]*$');
      while (++index < lines.length && !closing.test(lines[index])) body.push(lines[index]);
      prose.push(protect(body.join('\n')));
    } else if (/^(?: {4}|\t)/.test(lines[index])) prose.push(protect(lines[index]));
    else prose.push(lines[index]);
  }
  const output = prose.join('\n')
    .replace(/(`+)([^\n]*?)\1/g, (_, delimiter, code) => protect(code))
    .replace(/\$\$[\s\S]*?\$\$|\$[^\n$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, protect)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '$1（$2）')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1（$2）')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/(?<![\w*])\*\*(\S(?:[^\n]*?\S)?)\*\*(?![\w*])/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, cells) => cells.split('|').map(cell => cell.trim()).join(' · '))
    .replace(/^\s*>\s?/gm, '引用：')
    .replace(/\n{3,}/g, '\n\n').trim();
  return output.replace(new RegExp(prefix + '(\\d+)\u0000', 'g'), (_, index) => protectedText[Number(index)]);
}
