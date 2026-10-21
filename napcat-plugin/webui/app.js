const $ = id => document.getElementById(id);
const pluginId = location.pathname.split('/')[2];
let config, schema = [], dirty = false, busy = false;
const descriptions = {
  accounts: '每个 QQ 连接自己的 NapCat / OneBot 地址和端口。先登录对应 QQ，再新增连接；最多 20 个账号。人格和记忆可以分别管理。',
  profiles: '先创建人格，再绑定到账号、群聊或私聊。切换“管理内容”可编辑此人格在指定账号下的记忆。',
  bindings: '为指定 QQ 的群聊或私聊选择人格。这里的绑定优先于账号默认人格。',
  notes: '按 QQ 账号、人格与会话设置记忆的生效范围。',
  ai: '选择模型来源，保存后可测试连接或发起登录。密钥留空保留原值。',
};
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
function feedback(text, error = false) { $('feedback').textContent = text; $('feedback').classList.toggle('error', error); }
async function request(operation, value) {
  let token; try { token = JSON.parse(localStorage.getItem('token') || 'null'); } catch {}
  if (typeof token !== 'string' || !token) throw Error('请先登录 NapCat，再从扩展页面打开设置。');
  const response = await fetch('/api/Plugin/ext/' + encodeURIComponent(pluginId) + '/settings-ui', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ operation, config: value }) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || '操作失败，请重新载入后重试。'); return result;
}
function lock(value) { busy = value; for (const control of document.querySelectorAll('button,input,textarea,select')) control.disabled = value; }
function defaults() { for (const field of schema) if (field.type !== 'text' && !Object.hasOwn(config, field.key)) config[field.key] = field.default; }
async function refreshSchema() {
  schema = (await request('schema', config)).schema;
  // Dynamic field keys depend on selector defaults (for example the persona section).
  for (const field of schema) if (field.reactive && !Object.hasOwn(config, field.key)) config[field.key] = field.default;
  schema = (await request('schema', config)).schema;
  defaults();
}
function edited(value) { dirty = value; $('save-state').textContent = value ? '有未保存的更改' : '当前设置已载入'; }
async function select(key, value) {
  if (busy) return;
  if (dirty && !confirm('切换管理内容会放弃未保存的更改。继续切换？')) { render(); return; }
  lock(true);
  const previous = config;
  try {
    // Selector changes start a fresh draft so hidden fields and secret inputs never carry over.
    const selectors = Object.fromEntries(schema.filter(f => f.reactive && f.key !== key).map(f => [f.key, config[f.key]]));
    config = { _session: config._session, ...selectors, [key]: value };
    if (key === 'page') config = { _session: config._session, page: value };
    await refreshSchema(); edited(false); feedback(''); render();
  } catch (error) { config = previous; feedback(error.message, true); render(); } finally { lock(false); }
}
function render() {
  const pages = schema.find(f => f.key === 'page'); $('navigation').replaceChildren();
  for (const option of pages.options) { const button = node('button', option.label); button.type = 'button'; if (option.value === config.page) button.setAttribute('aria-current', 'page'); button.onclick = () => select('page', option.value); $('navigation').append(button); }
  const title = pages.options.find(o => o.value === config.page)?.label || '设置'; $('title').textContent = title; document.title = title + ' · QQ Agent';
  $('description').textContent = descriptions[config.page] || '调整当前分类后点击保存。切换分类前请先保存更改。';
  $('selectors').replaceChildren(); $('fields').replaceChildren();
  for (const field of schema) {
    if (field.key === 'page' || field.key === 'help') continue;
    if (field.type === 'text') {
      const note = node('p', field.default); note.className = 'note';
      // Only safe authorization URLs become links; all other data stays plain text.
      const urls = String(field.default).match(/https:\/\/[^\s]+/g) || [];
      for (const url of urls) { const a = node('a', '打开授权页面'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; note.append(node('br'), a); }
      $('fields').append(note); continue;
    }
    const label = node('label'), caption = node('span', field.label); label.className = 'field';
    const long = /(?:Prompt|text|summary|focus)$/.test(field.key);
    const input = node(field.type === 'select' ? 'select' : long ? 'textarea' : 'input');
    if (field.type === 'select') for (const option of field.options) { const o = node('option', option.label); o.value = option.value; input.append(o); }
    else if (!long) input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : /(?:Token|Key|Secret|password)$/.test(field.key) ? 'password' : 'text';
    input.id = field.key; input.name = field.key; caption.id = field.key + '-label'; input.setAttribute('aria-labelledby', caption.id); input.autocomplete = input.type === 'password' ? 'new-password' : 'off';
    if (field.type === 'boolean') { input.checked = config[field.key]; label.classList.add('toggle'); label.append(input, caption); }
    else { input.value = config[field.key] ?? ''; label.append(caption, input); }
    if (long) { label.classList.add('wide'); input.rows = 7; }
    input.addEventListener(field.reactive ? 'change' : 'input', () => { const value = field.type === 'boolean' ? input.checked : field.type === 'number' ? input.valueAsNumber : input.value; if (field.reactive) select(field.key, value); else { config[field.key] = value; edited(true); } });
    (field.reactive ? $('selectors') : $('fields')).append(label);
  }
}
async function load(page) { const result = await request('load'); config = result.config; schema = result.schema; if (page && schema[0].options.some(o => o.value === page)) config.page = page; await refreshSchema(); edited(false); render(); }
$('reload').onclick = async () => { if (busy || dirty && !confirm('放弃未保存的更改并重新载入？')) return; lock(true); try { await load(config?.page); feedback('已重新载入。'); } catch (error) { feedback(error.message, true); } finally { lock(false); } };
$('settings-form').onsubmit = async event => { event.preventDefault(); if (busy || !config) return; const page = config.page; lock(true); try { await request('save', config); edited(false); await load(page); feedback('已保存当前设置。'); } catch (error) { feedback(error.message, true); } finally { lock(false); } };
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
lock(true); load().then(() => feedback('')).catch(error => feedback(error.message, true)).finally(() => { lock(false); if (!config) $('save').disabled = true; });
