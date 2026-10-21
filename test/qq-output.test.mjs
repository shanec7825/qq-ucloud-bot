import test from 'node:test';
import assert from 'node:assert/strict';
import { qqPlainText } from '../src/qq-output.mjs';

test('QQ formatting preserves fenced and indented code contents', () => {
  const python = 'x = 2 ** 3 ** 2\n__name__\n# comment\n\n\nprint(x)';
  assert.equal(qqPlainText('```python\n' + python + '\n```'), python);
  const js = 'const text = `hello ${name}`;';
  assert.equal(qqPlainText('~~~js\n' + js + '\n~~~'), js);
  assert.equal(qqPlainText('代码：\n    ' + js + '\n    __name__'), '代码：\n    ' + js + '\n    __name__');
});

test('QQ formatting protects inline code, identifiers and mathematical expressions', () => {
  assert.equal(qqPlainText('计算 `2 ** 3 ** 2` 和 ``const s = `hello`;``'), '计算 2 ** 3 ** 2 和 const s = `hello`;');
  assert.equal(qqPlainText('2 ** 3 ** 2; 2**3**2; __name__'), '2 ** 3 ** 2; 2**3**2; __name__');
  assert.equal(qqPlainText('$a ** b ** c$\n\\[x ** y ** z\\]'), '$a ** b ** c$\n\\[x ** y ** z\\]');
  assert.equal(qqPlainText('**重点** [官网](https://example.com)'), '重点 官网（https://example.com）');
});
