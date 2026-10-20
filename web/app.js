const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state, csrf, dirty = false, groups = [], memories, editingNote, saving = false;
const titles = { bot: '机器人', connections: '服务连接', groups: '群组', memory: '记忆' };
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function notice(message, error = false) { let box = $('#feedback'); if ($('#shell').hidden) { box = $('#login-feedback'); if (!box) { box = element('p', undefined, 'feedback'); box.id = 'login-feedback'; box.setAttribute('role', 'status'); $('#login').append(box); } } box.textContent = message; box.classList.toggle('error', error); box.hidden = false; if (error) box.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
async function api(path, method = 'GET', value) {
  const response = await fetch('/api/' + path, { method, headers: { ...(value !== undefined ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== 'session') showLogin(); throw new Error(data.error || '操作失败，请重试。'); }
  return data;
}
function markDirty() { dirty = true; $('#save-state').textContent = '有未保存的更改'; }
function dependencies() {
  const backend = $('[data-setting="ai.backend"]').value;
  $('#api-options').hidden = backend !== 'api'; $('#codex-model').hidden = backend !== 'codex'; $('#codex-help').hidden = backend !== 'codex';
  const token = $('[data-setting="github.authMode"]').value === 'token';
  $('#github-token-options').hidden = !token; $('#github-existing-help').hidden = token;
  $('#google-oauth-options').hidden = $('[data-setting="drive.authMode"]').value !== 'oauth';
}
function fillSettings() {
  groups = structuredClone(state.settings.groups);
  for (const field of $$('[data-setting]')) { const [section, key] = field.dataset.setting.split('.'); if (field.type === 'checkbox') field.checked = state.settings[section][key]; else field.value = state.settings[section][key]; }
  for (const field of $$('[data-secret]')) field.value = '';
  for (const hint of $$('[data-secret-status]')) {
    const key = hint.dataset.secretStatus;
    hint.replaceChildren(document.createTextNode(state.secrets[key] ? '已配置。留空保留原值，不显示已保存密钥。 ' : '尚未配置。'));
    if (state.secrets[key]) hint.append(actionButton('清除密钥', async () => {
      if (!confirm('清除这个连接的已存密钥？使用该密钥的连接将不可用。')) return;
      if (dirty) await save();
      state.secrets = (await api('secrets', 'PUT', { [key]: null })).secrets;
      state.status = (await api('state')).status; fillSettings(); notice('密钥已清除。');
    }, 'danger-text secret-clear'));
  }
  $('#google-redirect').textContent = state.googleRedirectURI;
  $('#brand-name').textContent = state.settings.bot.name; document.title = state.settings.bot.name + ' 管理台';
  dirty = false; $('#save-state').textContent = '配置已保存'; renderGroups(); dependencies(); renderStatus();
}
function draft() {
  const value = structuredClone(state.settings);
  for (const field of $$('[data-setting]')) { const [section, key] = field.dataset.setting.split('.'); value[section][key] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value; }
  value.groups = groups; return value;
}
async function save() {
  if (saving) throw new Error('正在保存，请稍后。');
  const invalid = [...$('#settings-form').elements].find(field => field.willValidate && !field.checkValidity());
  if (invalid) { const tab = invalid.closest('[data-view]')?.dataset.view; if (tab) { location.hash = '#' + tab; navigate(false); } const details = invalid.closest('details'); if (details) details.open = true; invalid.focus(); invalid.reportValidity(); throw new Error('请检查表单中标出的字段。'); }
  saving = true; $('#save-settings').disabled = true;
  const settings = draft(), secrets = Object.fromEntries($$('[data-secret]').filter(field => field.value !== '').map(field => [field.dataset.secret, field.value]));
  let configSaved = false;
  try {
    const result = await api('settings', 'PUT', { settings, revision: state.settings.revision });
    state.settings = result.settings; configSaved = true;
    if (Object.keys(secrets).length) { const result = await api('secrets', 'PUT', secrets); state.secrets = result.secrets; }
    state = await api('state'); fillSettings(); notice('已保存并应用。新的消息会使用这份配置。');
  } catch (error) { markDirty(); throw new Error((configSaved ? '普通配置已保存，但密钥保存或状态刷新未完成；输入已保留，可重试。' : '') + error.message); }
  finally { saving = false; $('#save-settings').disabled = false; }
}
async function busy(button, work) {
  const old = button.textContent; button.disabled = true; button.textContent = '处理中…';
  try { await work(); } catch (error) { notice(error.message, true); } finally { button.disabled = false; button.textContent = button.id === 'save-note' ? editingNote ? '保存记忆' : '添加记忆' : old; }
}
function renderStatus() {
  const status = state.status;
  const online = status.qq.connected, badge = $('#qq-status'); badge.textContent = online ? 'QQ 已连接' : status.qq.configured ? 'QQ 未连接' : 'QQ 待配置'; badge.classList.toggle('ok', online);
  for (const service of ['ucloud', 'github', 'drive']) {
    const checked = status.checks[service], badge = $(`[data-service-state="${service}"]`);
    badge.textContent = checked ? checked.ok ? '已验证' : '连接失败' : status.configured[service] ? '有登录配置 · 待验证' : '待连接';
    badge.classList.toggle('ok', !!checked?.ok); badge.classList.toggle('error', checked?.ok === false);
    $('#check-' + service).textContent = checked ? checked.message + ' · ' + new Date(checked.checkedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
  }
  const model = status.checks.model; if (model) $('#check-model').textContent = model.message;
}
function showLogin() { $('#shell').hidden = true; $('#login').hidden = false; }
async function enter() { state = await api('state'); fillSettings(); $('#login').hidden = true; $('#shell').hidden = false; navigate(false); }
function navigate(focus = true) {
  const tab = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'bot';
  for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== tab;
  $('#memory-tools').hidden = tab !== 'memory'; $('#page-label').textContent = titles[tab];
  for (const link of $$('[data-tab]')) { if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  if (tab === 'memory' && state) loadMemory().catch(error => notice(error.message, true));
  if (focus) $('#main').focus({ preventScroll: true });
}
function actionButton(text, work, className) { const button = element('button', text, className); button.type = 'button'; button.addEventListener('click', () => busy(button, work)); return button; }
function renderGroups() {
  const list = $('#group-list'); list.replaceChildren();
  if (!groups.length) list.append(element('p', '尚未允许任何群。添加群号并保存后，机器人即可在该群被 @ 时回复。', 'empty'));
  for (const group of groups) {
    const row = element('div', undefined, 'group-row'), name = element('div', undefined, 'group-name'), inputName = element('input');
    inputName.value = group.name; inputName.placeholder = '未命名群组'; inputName.maxLength = 80; inputName.setAttribute('aria-label', '群 ' + group.id + ' 的备注名称');
    inputName.addEventListener('input', () => { group.name = inputName.value; markDirty(); }); name.append(inputName, element('small', group.id)); row.append(name);
    for (const [key, title] of [['enabled', '允许回复'], ['historyEnabled', '允许历史归纳']]) { const label = element('label', undefined, 'check'), input = element('input'); input.type = 'checkbox'; input.checked = group[key]; input.addEventListener('change', () => { group[key] = input.checked; markDirty(); }); label.append(input, document.createTextNode(title)); row.append(label); }
    row.append(actionButton('移除', async () => { groups = groups.filter(g => g.id !== group.id); markDirty(); renderGroups(); }, 'danger-text')); list.append(row);
  }
}
function addGroup(id, name = '') {
  if (!/^\d{5,15}$/.test(id)) throw new Error('群号应为 5–15 位数字。');
  if (groups.some(g => g.id === id)) throw new Error('这个群已经在列表中。');
  if (groups.length >= 200) throw new Error('最多添加 200 个群。');
  groups.push({ id, name, enabled: true, historyEnabled: false }); markDirty(); renderGroups();
}
const scopeName = scope => scope === 'global' ? '全局 · 所有会话可用' : scope.startsWith('group:') ? '群组 ' + (state.settings.groups.find(g => 'group:' + g.id === scope)?.name || scope.slice(6)) : '私聊 ' + scope.slice(8);
function resetNote() { editingNote = undefined; $('#note-text').value = ''; $('#save-note').textContent = '添加记忆'; $('#cancel-note').hidden = true; }
async function loadMemory() {
  memories = await api('memory');
  const scope = $('#note-scope'), previous = scope.value; scope.replaceChildren();
  const values = ['global', ...(state.settings.bot.ownerQQ ? ['private:' + state.settings.bot.ownerQQ] : []), ...state.settings.groups.map(g => 'group:' + g.id), ...memories.notes.map(n => n.scope)];
  for (const value of new Set(values)) { const option = element('option', scopeName(value)); option.value = value; scope.append(option); }
  if (values.includes(previous)) scope.value = previous; else if (state.settings.bot.ownerQQ) scope.value = 'private:' + state.settings.bot.ownerQQ;
  const list = $('#note-list'); list.replaceChildren();
  for (const note of memories.notes) {
    const row = element('article', undefined, 'note'), header = element('header'); header.append(element('span', scopeName(note.scope)), element('span', new Date(note.updatedAt).toLocaleDateString('zh-CN'))); row.append(header, element('p', note.text));
    const actions = element('div', undefined, 'action-row'); actions.append(actionButton('编辑', async () => { editingNote = note.id; $('#note-scope').value = note.scope; $('#note-text').value = note.text; $('#save-note').textContent = '保存记忆'; $('#cancel-note').hidden = false; $('#note-text').focus(); }), actionButton('删除', async () => { if (!confirm('删除这条长期记忆？')) return; await api('memory/notes/' + note.id, 'DELETE'); if (editingNote === note.id) resetNote(); await loadMemory(); notice('记忆已删除。'); }, 'danger-text')); row.append(actions); list.append(row);
  }
  if (!memories.notes.length) list.append(element('p', '还没有长期记忆。写下你希望它长期参考的信息。', 'empty'));
  const select = $('#digest-group'), selected = select.value; select.replaceChildren();
  for (const group of memories.digests) { const option = element('option', group.name || group.groupId); option.value = group.groupId; select.append(option); }
  if (memories.digests.some(g => g.groupId === selected)) select.value = selected; showDigest();
  const conversations = $('#conversation-list'); conversations.replaceChildren();
  for (const session of memories.conversations) {
    const row = element('div', undefined, 'conversation'), header = element('header'); header.append(element('span', scopeName(session.scope) + ' · ' + session.entries.length + ' 条'), actionButton('清空', async () => { if (!confirm('清空这段最近上下文？')) return; await api('memory/conversations', 'DELETE', { scope: session.scope }); await loadMemory(); notice('最近上下文已清空。'); }, 'danger-text'));
    const details = element('details'); details.append(element('summary', '查看最近上下文')); for (const entry of session.entries) details.append(element('p', entry.speaker + '：' + entry.text)); row.append(header, details); conversations.append(row);
  }
  if (!memories.conversations.length) conversations.append(element('p', '当前没有最近上下文。', 'empty'));
}
function showDigest() {
  const entry = memories?.digests.find(g => g.groupId === $('#digest-group').value), digest = entry?.digest;
  $('#digest-text').value = digest?.summary || ''; $('#digest-meta').textContent = digest?.updatedAt ? '最近更新：' + new Date(digest.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无摘要。可手动填写，也可授权历史归纳后等待生成。';
  $('#save-digest').disabled = !entry; $('#clear-digest').disabled = !entry;
}
$('#settings-form').addEventListener('input', event => { if (event.target.matches('[data-setting],[data-secret]')) { markDirty(); dependencies(); } });
$('#settings-form').addEventListener('submit', event => { event.preventDefault(); save().catch(error => notice(error.message, true)); });
$('#reload').addEventListener('click', () => busy($('#reload'), async () => { if (dirty && !confirm('放弃未保存的设置并重新载入？')) return; state = await api('state'); fillSettings(); notice('已重新载入配置。'); }));
$('#login-form').addEventListener('submit', event => { event.preventDefault(); busy($('#login-form button'), async () => { const data = await api('session', 'POST', { key: $('#admin-key').value.trim() }); csrf = data.csrf; $('#admin-key').value = ''; await enter(); }); });
$('#logout').addEventListener('click', () => busy($('#logout'), async () => { if (dirty && !confirm('退出并放弃未保存设置？')) return; await api('logout', 'POST', {}); csrf = undefined; dirty = false; showLogin(); }));
for (const button of $$('[data-check]')) button.addEventListener('click', () => busy(button, async () => { if (dirty) await save(); const result = await api('check/' + button.dataset.check, 'POST', {}); state.status.checks[button.dataset.check] = result; renderStatus(); notice(result.message, !result.ok); }));
$('#school-login').addEventListener('click', () => busy($('#school-login'), async () => { const username = $('#school-user').value, password = $('#school-password').value; if (!username || !password) throw new Error('请填写学号和学校密码。'); try { await api('ucloud/login', 'POST', { username, password }); state.status = (await api('state')).status; renderStatus(); notice('学校登录成功。启用教学云并保存后，即可同步作业。'); } finally { $('#school-password').value = ''; } }));
$('#google-authorize').addEventListener('click', () => busy($('#google-authorize'), async () => {
  // Open synchronously so browser popup blocking does not lose the authorization window.
  const popup = window.open('about:blank', '_blank');
  try { if (dirty) await save(); const result = await api('google/authorize', 'POST', {}); if (popup) { popup.opener = null; popup.location.replace(result.url); } else notice('浏览器拦截了授权窗口，请允许弹窗后重新点击。', true); }
  catch (error) { popup?.close(); throw error; }
}));
$('#copy-redirect').addEventListener('click', () => busy($('#copy-redirect'), async () => { await navigator.clipboard.writeText($('#google-redirect').textContent); notice('回调地址已复制。'); }));
$('#add-group').addEventListener('click', () => { try { addGroup($('#new-group-id').value.trim(), $('#new-group-name').value.trim()); $('#new-group-id').value = ''; $('#new-group-name').value = ''; } catch (error) { notice(error.message, true); } });
$('#discover-groups').addEventListener('click', () => busy($('#discover-groups'), async () => { const result = await api('groups'); const list = $('#group-discovery'); list.replaceChildren(); for (const group of result.groups.filter(g => !groups.some(allowed => allowed.id === g.id))) { const row = element('div', undefined, 'group-row'); row.append(element('span', (group.name || 'QQ群') + ' · ' + group.id), actionButton('添加', async () => { addGroup(group.id, group.name); row.remove(); })); list.append(row); } if (!list.children.length) list.append(element('p', '没有尚未配置的 QQ 群。', 'empty')); }));
$('#note-form').addEventListener('submit', event => { event.preventDefault(); busy($('#save-note'), async () => { await api('memory/notes', 'PUT', { id: editingNote, scope: $('#note-scope').value, text: $('#note-text').value }); resetNote(); await loadMemory(); notice('长期记忆已保存。'); }); });
$('#cancel-note').addEventListener('click', resetNote); $('#digest-group').addEventListener('change', showDigest);
$('#save-digest').addEventListener('click', () => busy($('#save-digest'), async () => { await api('memory/digest', 'PUT', { groupId: $('#digest-group').value, summary: $('#digest-text').value }); await loadMemory(); notice('群历史摘要已保存。'); }));
$('#clear-digest').addEventListener('click', () => busy($('#clear-digest'), async () => { if (!confirm('清空该群的历史摘要？')) return; await api('memory/digest', 'PUT', { groupId: $('#digest-group').value, summary: '' }); await loadMemory(); notice('摘要已清空。自动归纳仍按原有周期运行。'); }));
$('#clear-conversations').addEventListener('click', () => busy($('#clear-conversations'), async () => { if (!confirm('清空所有最近上下文？长期记忆与摘要将保留。')) return; await api('memory/conversations', 'DELETE', { scope: 'all' }); await loadMemory(); notice('全部最近上下文已清空。'); }));
window.addEventListener('hashchange', () => navigate());
window.addEventListener('beforeunload', event => { if (dirty || $('#note-text').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
async function bootstrap() {
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (key) history.replaceState(null, '', '/#bot');
  try { const session = key ? await api('session', 'POST', { key }) : await api('session'); csrf = session.csrf; await enter(); }
  catch (error) { showLogin(); if (key) { $('#login').prepend(element('p', error.message, 'feedback error')); } }
}
await bootstrap();
setInterval(async () => { if (!csrf || $('#shell').hidden) return; try { const latest = await api('state'); state.status = latest.status; renderStatus(); if (latest.settings.revision !== state.settings.revision) $('#save-state').textContent = '其他页面已更新配置，请重新载入'; } catch { $('#qq-status').textContent = '管理服务未连接'; $('#qq-status').classList.remove('ok'); $('#save-state').textContent = '无法连接本机服务，请检查进程'; } }, 15000);
