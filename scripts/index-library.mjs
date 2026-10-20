import { SharedLibrary } from '../src/shared-library.mjs';
import { SettingsStore } from '../src/settings.mjs';
const settings = new SettingsStore(); await settings.load();
const library = new SharedLibrary(settings.get().library.root);
const files = await library.scan();
console.log(`找到 ${files.length} 个授权目录内的教材或课件。`);
let success = 0;
for (const file of files) {
  try { const document = await library.document(file.id); const count = document.pages.reduce((sum, page) => sum + page.text.trim().length, 0); console.log(`${file.name}: ${document.pages.length} 页/文本块，${count} 字符${count < 50 ? '，可能需要 OCR' : ''}`); success++; }
  catch { console.error(`${file.name}: 解析失败，尚不可全文查询。`); }
}
console.log(`已建立 ${success}/${files.length} 个文件的只读文本索引。`);
