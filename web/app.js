const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state, csrf, dirty = false, groups = [], profiles = [], memories, editingNote, saving = false, inbox = { items: [], counts: {} };
const inNapcat = document.body.dataset.napcat === 'true';
const moduleIds = { core: 'napcat-plugin-qq-agent', github: 'napcat-plugin-agent-github', drive: 'napcat-plugin-agent-drive', ucloud: 'napcat-plugin-agent-ucloud', notices: 'napcat-plugin-agent-notices' };
const moduleName = Object.hasOwn(moduleIds, document.body.dataset.module) ? document.body.dataset.module : 'core';
const pluginId = moduleIds[moduleName];
const monitorOnly = inNapcat && moduleName === 'notices';
const serviceOnly = inNapcat && ['github', 'drive', 'ucloud'].includes(moduleName);
const digestDrafts = new Map();
const titles = { bot: '机器人', connections: '服务连接', groups: '群组', memory: '记忆', monitor: '消息整理', customization: '自定义' };
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function notice(message, error = false) { let box = $('#feedback'); if ($('#shell').hidden) { box = $('#login-feedback'); if (!box) { box = element('p', undefined, 'feedback'); box.id = 'login-feedback'; box.setAttribute('role', 'status'); $('#login').append(box); } } box.textContent = message; box.classList.toggle('error', error); box.hidden = false; if (error) box.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
async function api(path, method = 'GET', value) {
  let response;
  if (inNapcat) {
    let credential; try { credential = JSON.parse(localStorage.getItem('token') || 'null'); } catch {}
    if (typeof credential !== 'string' || !credential) throw new Error('请先在 NapCat 登录，再打开插件配置。');
    response = await fetch('/api/Plugin/ext/' + pluginId + '/bridge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credential }, body: JSON.stringify({ method, path, ...(value !== undefined ? { value } : {}) }) });
  } else response = await fetch('/api/' + path, { method, headers: { ...(value !== undefined ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== 'session') showLogin(); throw new Error(data.error || '操作失败，请重试。'); }
  return data;
}
function markDirty() { dirty = true; $('#save-state').textContent = '有未保存的更改'; }
function dependencies() {
  const backend = $('[data-setting="ai.backend"]').value;
  $('#api-options').hidden = backend !== 'api'; $('#codex-model').hidden = backend !== 'codex'; $('#codex-help').hidden = backend !== 'codex';
  $('#deepseek-options').hidden = backend !== 'deepseek'; $('#harness-options').hidden = backend !== 'deepseek-harness';
  $('#deepseek-key-options').hidden = backend !== 'deepseek' && !(backend === 'deepseek-harness' && $('[data-setting="ai.harnessAuth"]').value === 'api-key');
  for (const id of ['codex-status','codex-login','codex-account-state']) $('#' + id).hidden = backend !== 'codex';
  const token = $('[data-setting="github.authMode"]').value === 'token';
  $('#github-token-options').hidden = !token; $('#github-existing-help').hidden = $('[data-setting="github.authMode"]').value !== 'existing';
  $('#github-chatgpt-help').hidden = $('[data-setting="github.authMode"]').value !== 'chatgpt';
  const driveMode = $('[data-setting="drive.authMode"]').value;
  $('#google-oauth-options').hidden = driveMode !== 'oauth'; $('#drive-chatgpt-help').hidden = driveMode !== 'chatgpt'; $('#drive-root-option').hidden = driveMode === 'chatgpt';
}
function fillSettings() {
  groups = structuredClone(state.settings.groups);
  profiles = structuredClone(state.settings.profiles || []);
  $('#monitor-group-ids').value = state.settings.monitor.groups.join('\n');
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
  $('#brand-name').textContent = state.settings.bot.name; document.title = 'QQ Agent · ' + state.settings.bot.name;
  dirty = false; $('#save-state').textContent = '配置已保存'; renderGroups(); renderProfiles(); dependencies(); renderStatus();
}
function draft() {
  const value = structuredClone(state.settings);
  for (const field of $$('[data-setting]')) { const [section, key] = field.dataset.setting.split('.'); value[section][key] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value; }
  value.monitor.groups = [...new Set($('#monitor-group-ids').value.split(/[\s,，]+/).filter(Boolean))];
  value.groups = groups; value.profiles = profiles; return value;
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
    const chatgptMode = ['github', 'drive'].includes(service) && state.settings[service].authMode === 'chatgpt';
    badge.textContent = checked ? checked.ok ? '已验证' : '连接失败' : status.configured[service] ? '有登录配置 · 待验证' : chatgptMode ? 'ChatGPT · 按需连接' : '待连接';
    badge.classList.toggle('ok', !!checked?.ok); badge.classList.toggle('error', checked?.ok === false);
    $('#check-' + service).textContent = checked ? checked.message + ' · ' + new Date(checked.checkedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
  }
  const model = status.checks.model; if (model) $('#check-model').textContent = model.message;
}
function showLogin() {
  $('#shell').hidden = true; $('#login').hidden = false;
  if (inNapcat) { $('#login-form').hidden = true; $('#login h1').textContent = '请先登录 NapCat'; $('#login p').textContent = '登录 NapCat 后，从插件卡片打开配置，无需第二次登录。'; }
}
async function enter() { state = await api('state'); fillSettings(); $('#login').hidden = true; $('#shell').hidden = false; navigate(false); }
function navigate(focus = true) {
  const requested = location.hash.slice(1);
  const tab = monitorOnly ? 'monitor' : serviceOnly ? 'connections' : Object.hasOwn(titles, requested) && (!inNapcat || !['connections', 'monitor'].includes(requested)) ? requested : 'bot';
  for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== tab;
  $('#memory-tools').hidden = tab !== 'memory'; $('#page-label').textContent = titles[tab];
  $('#monitor-tools').hidden = tab !== 'monitor';
  for (const link of $$('[data-tab]')) { if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  if (tab === 'memory' && state) loadMemory().catch(error => notice(error.message, true));
  if (tab === 'monitor' && state) loadMonitor().catch(error => notice(error.message, true));
  if (tab === 'customization' && state) loadWorkspace().catch(error => notice(error.message, true));
  if (focus) $('#main').focus({ preventScroll: true });
}
function actionButton(text, work, className) { const button = element('button', text, className); button.type = 'button'; button.addEventListener('click', () => busy(button, work)); return button; }
function renderProfiles() {
  const list = $('#profile-list'); list.replaceChildren();
  if (!profiles.length) list.append(element('p', '尚无自定义方案。群组目前使用默认机器人配置。', 'empty'));
  for (const profile of profiles) {
    const card = element('article', undefined, 'profile-card'), header = element('header');
    header.append(element('h3', profile.name || '未命名方案'), actionButton('删除方案', async () => {
      if (groups.some(group => group.profileId === profile.id)) throw new Error('这个方案仍被群组使用，请先到群组页切换方案。');
      if (!confirm('删除方案“' + profile.name + '”？保存后生效。')) return;
      profiles = profiles.filter(item => item !== profile); markDirty(); renderProfiles(); renderGroups();
    }, 'danger-text')); card.append(header);
    const columns = element('div', undefined, 'two-columns');
    for (const [key, title, max] of [['id', '方案 ID', 40], ['name', '显示名称', 40], ['model', '模型覆盖（留空继承默认）', 100], ['systemPrompt', '方案提示词', 12000]]) {
      const label = element('label', title), field = element(key === 'systemPrompt' ? 'textarea' : 'input'); field.value = profile[key] || ''; field.maxLength = max; field.dataset.profileField = key; field.setAttribute('aria-label', profile.id + ' · ' + title);
      if (key === 'id') { field.required = true; field.pattern = '[A-Za-z0-9_-]{1,40}'; field.readOnly = state.settings.profiles.some(item => item.id === profile.id) || groups.some(group => group.profileId === profile.id); }
      if (key === 'name') field.required = true;
      if (key === 'systemPrompt') field.rows = 4;
      field.addEventListener('input', () => { profile[key] = field.value; if (key === 'name') header.querySelector('h3').textContent = field.value || '未命名方案'; markDirty(); });
      field.addEventListener('change', () => renderGroups()); label.append(field); if (key === 'id' || key === 'name') columns.append(label); else card.append(label);
    }
    card.insertBefore(columns, header.nextSibling); list.append(card);
  }
}
async function loadWorkspace() {
  const data = await api('workspace'), list = $('#workspace-modules'); list.replaceChildren();
  for (const module of data.modules || []) { const row = element('article', undefined, 'module-row'), content = element('div'); content.append(element('strong', module.name), element('p', module.description)); row.append(content, element('span', module.active ? '已启用' : '未启用', 'badge')); list.append(row); }
}
function renderInbox() {
  const list = $('#inbox-list'); list.replaceChildren(); let visible = 0;
  $('#inbox-counts').textContent = '待处理 ' + (inbox.counts.pending || 0) + ' · 已完成 ' + (inbox.counts.done || 0) + ' · 已归档 ' + (inbox.counts.archived || 0);
  for (const item of inbox.items) {
    if ($('#inbox-status').value !== 'all' && item.status !== $('#inbox-status').value) continue;
    if ($('#inbox-search').value && ![item.title, item.summary, item.groupName, item.groupId].join(' ').toLowerCase().includes($('#inbox-search').value.toLowerCase())) continue;
    visible++; const row = element('article', undefined, 'inbox-item'); row.dataset.inboxId = item.id;
    row.append(element('h3', (item.priority === 'urgent' ? '紧急 · ' : '') + item.title), element('p', item.summary), element('p', (item.groupName || item.groupId) + ' · ' + new Date(item.createdAt).toLocaleString('zh-CN'), 'hint'));
    if (item.deadlineText) row.append(element('p', '截止原文：' + item.deadlineText));
    const detail = element('details'); detail.append(element('summary', '查看来源与依据'));
    detail.append(element('p', '报告 ' + item.reportId + ' · 群 ' + item.groupId, 'hint'));
    for (const source of item.sources || []) detail.append(element('blockquote', [source.time, source.excerpt].filter(Boolean).join(' · ')));
    if (!item.sources?.length) detail.append(element('p', '此事项未附原文片段，请结合群历史核实。', 'hint'));
    row.append(detail); const actions = element('div', undefined, 'action-row');
    for (const [status, label] of [['done', '标为完成'], ['pending', '恢复待处理'], ['archived', '归档']]) if (item.status !== status) actions.append(actionButton(label, async () => { await api('inbox/item', 'PUT', { id: item.id, status }); inbox = await api('inbox'); renderInbox(); notice('事项状态已更新。'); }));
    row.append(actions); list.append(row);
  }
  if (!visible) list.append(element('p', inbox.items.length ? '当前筛选下没有事项。' : '还没有事项。保存监测群后，可以立即整理或等待定期任务。', 'empty'));
}
async function loadMonitor() {
  inbox = await api('inbox'); renderInbox();
  const data = await api('monitor'), list = $('#notice-reports'); list.replaceChildren();
  const names = { reading: '读取中', unchanged: '无新文字', updated: '已生成报告', no_important_info: '未发现重要通知', failed: '导出或模型失败' };
  $('#monitor-status').textContent = data.running ? '正在整理，请稍后刷新。' : Object.entries(data.state).filter(([id]) => state.settings.monitor.groups.includes(id)).map(([id, row]) => '群 ' + id + '：' + (names[row.status] || row.status) + ' · 模型调用 ' + (row.modelCalls || 0) + ' 次').join('；') || '还没有整理记录。请先选择监测群并保存。';
  if (!data.reports.length) list.append(element('p', '暂无重要信息报告。', 'empty'));
  const delivery = { web: '保存在后台', private_sent: '已发 QQ 私聊', private_failed: '私聊发送失败，请在本页查看' };
  for (const report of data.reports) {
    const card = element('article', undefined, 'panel'); card.append(element('h3', report.groupName), element('p', new Date(report.createdAt).toLocaleString('zh-CN') + ' · ' + (delivery[report.delivery] || '保存在后台'), 'hint'));
    for (const item of report.items) {
      card.append(element('h4', (item.priority === 'urgent' ? '紧急 · ' : '') + item.title), element('p', item.summary));
      if (item.deadlineText) card.append(element('p', '截止时间原文：' + item.deadlineText));
      const detail = element('details'); detail.append(element('summary', '查看依据'));
      for (const source of item.sources) detail.append(element('blockquote', source.time + ' · ' + source.excerpt));
      card.append(detail);
    }
    list.append(card);
  }
}
$('#refresh-monitor').addEventListener('click', () => busy($('#refresh-monitor'), loadMonitor));
$('#run-monitor').addEventListener('click', () => busy($('#run-monitor'), async () => {
  if (dirty) throw new Error('请先保存监测配置。');
  const result = await api('monitor/run', 'POST', {}); await loadMonitor();
  const status = { disabled: '请先启用并保存群通知整理。', no_groups: '请先选择并保存监测群。', busy: '已有整理任务正在进行。' };
  const outcomes = { updated: '已生成报告', unchanged: '没有新文字', no_important_info: '没有重要通知', not_due: '间隔不足一分钟', failed: '导出或模型失败', cancelled: '配置变更，已取消' };
  notice(status[result.status] || result.results.map(row => '群 ' + row.groupId + '：' + (outcomes[row.status] || row.status)).join('；'));
}));
$('#discover-monitor-groups').addEventListener('click', () => busy($('#discover-monitor-groups'), async () => {
  const data = await api('groups'), list = $('#monitor-discovery'); list.replaceChildren();
  for (const group of data.groups) list.append(actionButton(group.name + ' · ' + group.id, async () => {
    const selected = new Set($('#monitor-group-ids').value.split(/[\s,，]+/).filter(Boolean)); selected.add(group.id);
    $('#monitor-group-ids').value = [...selected].join('\n'); markDirty(); notice('已加入只读监测列表，请保存以应用禁言保护。');
  }));
  if (!data.groups.length) list.append(element('p', 'QQ 没有返回已加入的群。', 'empty'));
}));
$('#codex-status').addEventListener('click', () => busy($('#codex-status'), async () => {
  const status = await api('codex/account');
  $('#codex-account-state').textContent = status.authenticated ? '已登录 ChatGPT 订阅；实际模型和可用额度以账号为准。' : status.loginPending ? '等待你在 OpenAI 页面完成登录，完成后再检查。' : '尚未使用 ChatGPT 登录。可点击“登录 ChatGPT”。';
}));
$('#codex-login').addEventListener('click', () => busy($('#codex-login'), async () => {
  const popup = window.open('about:blank', '_blank');
  try {
    const result = await api('codex/login', 'POST', {});
    if (result.authenticated) { popup?.close(); $('#codex-account-state').textContent = '本机已登录 ChatGPT，可以使用订阅后端。'; return; }
    if (popup) popup.location.href = result.authUrl;
    else { const link = element('a', '打开 OpenAI 登录页面'); link.href = result.authUrl; link.target = '_blank'; link.rel = 'noopener'; $('#codex-account-state').replaceChildren(link); }
    notice('在 OpenAI 页面完成登录，然后点击“检查订阅登录”。不会自动切换到按量 API。');
  } catch (error) { popup?.close(); throw error; }
}));
function renderGroups() {
  const list = $('#group-list'); list.replaceChildren();
  if (!groups.length) list.append(element('p', '尚未允许任何群。添加群号并保存后，机器人即可在该群被 @ 时回复。', 'empty'));
  let visible = 0;
  for (const group of groups) {
    const monitored = $('#monitor-group-ids').value.split(/[\s,，]+/).includes(group.id);
    const mode = monitored ? 'monitor' : group.enabled ? 'reply' : 'disabled';
    if ($('#group-search').value && !(group.name + ' ' + group.id).toLowerCase().includes($('#group-search').value.toLowerCase())) continue;
    if ($('#group-mode').value !== 'all' && $('#group-mode').value !== mode) continue;
    visible++;
    const row = element('div', undefined, 'group-row'), name = element('div', undefined, 'group-name'), inputName = element('input');
    inputName.value = group.name; inputName.placeholder = '未命名群组'; inputName.maxLength = 80; inputName.setAttribute('aria-label', '群 ' + group.id + ' 的备注名称');
    inputName.addEventListener('input', () => { group.name = inputName.value; markDirty(); }); name.append(inputName, element('small', group.id)); row.append(name);
    for (const [key, title] of [['enabled', '允许回复'], ['historyEnabled', '允许历史归纳']]) { const label = element('label', undefined, 'check'), input = element('input'); input.type = 'checkbox'; input.checked = group[key]; input.addEventListener('change', () => { group[key] = input.checked; markDirty(); }); label.append(input, document.createTextNode(title)); row.append(label); }
    row.append(actionButton('移除', async () => { groups = groups.filter(g => g.id !== group.id); markDirty(); renderGroups(); }, 'danger-text'));
    const card = element('article', undefined, 'group-card'), settings = element('div', undefined, 'group-template-settings');
    const label = element('label', '群场景'), select = element('select'); select.setAttribute('aria-label', '群 ' + group.id + ' 的场景模板'); select.dataset.groupTemplate = group.id;
    for (const template of state.groupTemplates || []) { const option = element('option', template.name); option.value = template.id; select.append(option); }
    select.value = group.template || 'auto'; label.append(select);
    const hint = element('p', undefined, 'hint'), preview = element('details'), previewText = element('pre', undefined, 'template-preview'); preview.append(element('summary', '查看模板和输出示例'), previewText);
    const refreshTemplate = () => { const selected = (state.groupTemplates || []).find(item => item.id === select.value); hint.textContent = selected?.description || ''; previewText.textContent = select.value === 'auto' ? 'AI 会在本次回答中选择游戏群、年级群或课程群模板。\n普通闲聊自然回答；只有整理和起草事项时才采用结构化格式。\n不会为选择模板增加一次模型请求。' : [selected?.format || '自然回答，不套通知格式。', selected?.rules, selected?.example && '示例：' + selected.example].filter(Boolean).join('\n\n'); };
    select.addEventListener('change', () => { group.template = select.value; markDirty(); refreshTemplate(); }); refreshTemplate();
    const custom = element('label', '这个群的补充要求（可选）'), prompt = element('textarea'); prompt.rows = 2; prompt.maxLength = 2000; prompt.value = group.templatePrompt || ''; prompt.placeholder = '例如：活动时间用北京时间；作业汇总优先列最近截止事项。'; prompt.setAttribute('aria-label', '群 ' + group.id + ' 的补充提示词');
    prompt.addEventListener('input', () => { group.templatePrompt = prompt.value; markDirty(); }); custom.append(prompt);
    const profileLabel = element('label', '机器人方案'), profileSelect = element('select'); profileSelect.setAttribute('aria-label', '群 ' + group.id + ' 的机器人方案'); profileSelect.dataset.groupProfile = group.id;
    const defaultOption = element('option', '默认 · 使用机器人页配置'); defaultOption.value = ''; profileSelect.append(defaultOption);
    for (const profile of profiles) { const option = element('option', profile.name); option.value = profile.id; profileSelect.append(option); }
    profileSelect.value = group.profileId || ''; profileLabel.append(profileSelect);
    const effective = element('p', undefined, 'effective-mode');
    const refreshMode = () => { effective.textContent = '生效方式：' + (monitored ? '只读监测 · 不发送群消息' : group.enabled ? '被 @ 时回复' : '暂停回复') + ' · 方案：' + (profiles.find(profile => profile.id === group.profileId)?.name || '默认'); };
    profileSelect.addEventListener('change', () => { group.profileId = profileSelect.value; markDirty(); refreshMode(); }); refreshMode();
    settings.append(profileLabel, label, hint, preview, custom); card.append(row, effective, settings); list.append(card);
  }
  if (groups.length && !visible) list.append(element('p', '没有符合筛选条件的群组。', 'empty'));
}
function addGroup(id, name = '') {
  if (!/^\d{5,15}$/.test(id)) throw new Error('群号应为 5–15 位数字。');
  if (groups.some(g => g.id === id)) throw new Error('这个群已经在列表中。');
  if (groups.length >= 200) throw new Error('最多添加 200 个群。');
  groups.push({ id, name, enabled: true, historyEnabled: false, template: 'auto', templatePrompt: '', profileId: '' }); markDirty(); renderGroups();
}
const scopeName = scope => scope === 'global' ? '全局 · 所有会话可用' : scope.startsWith('profile:') ? '方案 ' + (profiles.find(p => 'profile:' + p.id === scope)?.name || scope.slice(8)) : scope.startsWith('group:') ? '群组 ' + (state.settings.groups.find(g => 'group:' + g.id === scope)?.name || scope.slice(6)) : '私聊 ' + scope.slice(8);
function resetNote() { editingNote = undefined; $('#note-text').value = ''; $('#note-kind').value = 'fact'; $('#note-tags').value = ''; $('#note-enabled').checked = true; $('#save-note').textContent = '添加记忆'; $('#cancel-note').hidden = true; }
async function loadMemory() {
  memories = await api('memory');
  const scope = $('#note-scope'), previous = scope.value; scope.replaceChildren();
  const values = ['global', ...(state.settings.bot.ownerQQ ? ['private:' + state.settings.bot.ownerQQ] : []), ...state.settings.groups.map(g => 'group:' + g.id), ...profiles.map(profile => 'profile:' + profile.id), ...memories.notes.map(n => n.scope)];
  for (const value of new Set(values)) { const option = element('option', scopeName(value)); option.value = value; scope.append(option); }
  if (values.includes(previous)) scope.value = previous; else if (state.settings.bot.ownerQQ) scope.value = 'private:' + state.settings.bot.ownerQQ;
  const filter = $('#memory-filter'), selectedScope = filter.value; filter.replaceChildren(); const all = element('option', '所有范围'); all.value = 'all'; filter.append(all);
  for (const value of new Set(values)) { const option = element('option', scopeName(value)); option.value = value; filter.append(option); }
  filter.value = [...filter.options].some(option => option.value === selectedScope) ? selectedScope : 'all';
  renderNotes();
  const select = $('#digest-group'), selected = select.value; select.replaceChildren();
  for (const group of memories.digests) { const option = element('option', group.name || group.groupId); option.value = group.groupId; select.append(option); }
  if (memories.digests.some(g => g.groupId === selected)) select.value = selected; showDigest();
  renderConversations();
}
function renderNotes() {
  const list = $('#note-list'); list.replaceChildren(); let visible = 0;
  const kindNames = { fact: '事实', preference: '偏好', instruction: '指令' };
  for (const note of memories.notes) {
    if ($('#memory-filter').value !== 'all' && note.scope !== $('#memory-filter').value) continue;
    if ($('#memory-kind-filter').value !== 'all' && (note.kind || 'fact') !== $('#memory-kind-filter').value) continue;
    if ($('#memory-search').value && !(note.text + ' ' + (note.tags || []).join(' ')).toLowerCase().includes($('#memory-search').value.toLowerCase())) continue;
    visible++;
    const row = element('article', undefined, 'note'), header = element('header'); header.append(element('span', scopeName(note.scope)), element('span', new Date(note.updatedAt).toLocaleDateString('zh-CN'))); row.append(header, element('p', note.text));
    const meta = element('div', undefined, 'note-meta'); for (const tag of [kindNames[note.kind || 'fact'], note.enabled === false ? '已停用' : '使用中', ...(note.tags || [])]) meta.append(element('span', tag, 'tag')); row.append(meta); row.classList.toggle('disabled', note.enabled === false);
    const actions = element('div', undefined, 'action-row'); actions.append(actionButton('编辑', async () => { editingNote = note.id; $('#note-scope').value = note.scope; $('#note-text').value = note.text; $('#note-kind').value = note.kind || 'fact'; $('#note-tags').value = (note.tags || []).join(', '); $('#note-enabled').checked = note.enabled !== false; $('#save-note').textContent = '保存记忆'; $('#cancel-note').hidden = false; $('#note-text').focus(); }), actionButton(note.enabled === false ? '启用' : '停用', async () => { await api('memory/notes', 'PUT', { ...note, enabled: note.enabled === false }); await loadMemory(); }), actionButton('删除', async () => { if (!confirm('删除这条长期记忆？')) return; await api('memory/notes/' + note.id, 'DELETE'); if (editingNote === note.id) resetNote(); await loadMemory(); notice('记忆已删除。'); }, 'danger-text')); row.append(actions); list.append(row);
  }
  if (!visible) list.append(element('p', memories.notes.length ? '没有符合筛选条件的记忆。' : '还没有长期记忆。写下你希望它长期参考的信息。', 'empty'));
}
function renderConversations() {
  const conversations = $('#conversation-list'); conversations.replaceChildren();
  for (const session of memories.conversations) {
    const background = session.background || [];
    const row = element('div', undefined, 'conversation'), header = element('header'); header.append(element('span', scopeName(session.scope) + ' · 对话 ' + session.entries.length + ' 条 · 背景 ' + background.length + ' 条'), actionButton('清空', async () => { if (!confirm('清空这段最近对话和群聊背景？')) return; await api('memory/conversations', 'DELETE', { scope: session.scope }); await loadMemory(); notice('最近上下文已清空。'); }, 'danger-text'));
    const details = element('details'); details.append(element('summary', '查看最近对话')); for (const entry of session.entries) details.append(element('p', (entry.senderName ? entry.senderName + ' · ' : '') + entry.speaker + '：' + entry.text));
    const ambient = element('details'); ambient.append(element('summary', '查看群聊背景')); for (const entry of background) ambient.append(element('p', (entry.senderName ? entry.senderName + ' · ' : '') + entry.speaker + '：' + entry.text)); row.append(header, details, ambient); conversations.append(row);
  }
  if (!memories.conversations.length) conversations.append(element('p', '当前没有最近上下文。', 'empty'));
}
function showDigest() {
  const entry = memories?.digests.find(g => g.groupId === $('#digest-group').value), digest = entry?.digest;
  $('#digest-text').value = digestDrafts.get($('#digest-group').value) ?? digest?.summary ?? ''; $('#digest-meta').textContent = digest?.updatedAt ? '最近更新：' + new Date(digest.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无摘要。可手动填写，也可授权历史归纳后等待生成。';
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
$('#note-form').addEventListener('submit', event => { event.preventDefault(); busy($('#save-note'), async () => { const tags = [...new Set($('#note-tags').value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))]; if (tags.length > 10 || tags.some(tag => tag.length > 30)) throw new Error('最多 10 个标签，每个不超过 30 字。'); await api('memory/notes', 'PUT', { id: editingNote, scope: $('#note-scope').value, text: $('#note-text').value, kind: $('#note-kind').value, tags, enabled: $('#note-enabled').checked }); resetNote(); await loadMemory(); notice('长期记忆已保存。'); }); });
$('#digest-text').addEventListener('input', () => { const id = $('#digest-group').value, saved = memories?.digests.find(group => group.groupId === id)?.digest?.summary || ''; if ($('#digest-text').value === saved) digestDrafts.delete(id); else digestDrafts.set(id, $('#digest-text').value); });
$('#cancel-note').addEventListener('click', resetNote); $('#digest-group').addEventListener('change', showDigest);
$('#save-digest').addEventListener('click', () => busy($('#save-digest'), async () => { const groupId = $('#digest-group').value, summary = $('#digest-text').value; await api('memory/digest', 'PUT', { groupId, summary }); if (digestDrafts.get(groupId) === summary) digestDrafts.delete(groupId); await loadMemory(); notice('群历史摘要已保存。'); }));
$('#clear-digest').addEventListener('click', () => busy($('#clear-digest'), async () => { if (!confirm('清空该群的历史摘要？')) return; const groupId = $('#digest-group').value, draftBefore = digestDrafts.get(groupId); await api('memory/digest', 'PUT', { groupId, summary: '' }); if (digestDrafts.get(groupId) === draftBefore) digestDrafts.delete(groupId); await loadMemory(); notice('摘要已清空。自动归纳仍按原有周期运行。'); }));
$('#clear-conversations').addEventListener('click', () => busy($('#clear-conversations'), async () => { if (!confirm('清空所有最近上下文？长期记忆与摘要将保留。')) return; await api('memory/conversations', 'DELETE', { scope: 'all' }); await loadMemory(); notice('全部最近上下文已清空。'); }));
window.addEventListener('hashchange', () => navigate());
window.addEventListener('beforeunload', event => { if (dirty || $('#note-text').value.trim() || digestDrafts.size) { event.preventDefault(); event.returnValue = ''; } });
$('#add-profile').addEventListener('click', () => { if (profiles.length >= 50) return notice('最多创建 50 个方案。', true); profiles.push({ id: 'profile-' + crypto.randomUUID().slice(0, 8), name: '新方案', systemPrompt: '', model: '' }); markDirty(); renderProfiles(); renderGroups(); $('#profile-list .profile-card:last-child input').focus(); });
for (const id of ['group-search', 'group-mode']) $('#' + id).addEventListener(id === 'group-search' ? 'input' : 'change', renderGroups);
$('#monitor-group-ids').addEventListener('input', () => { markDirty(); renderGroups(); });
for (const id of ['memory-search', 'memory-filter', 'memory-kind-filter']) $('#' + id).addEventListener(id === 'memory-search' ? 'input' : 'change', () => { if (memories) renderNotes(); });
for (const id of ['inbox-search', 'inbox-status']) $('#' + id).addEventListener(id === 'inbox-search' ? 'input' : 'change', renderInbox);
function syncTheme() {
  let dark = matchMedia('(prefers-color-scheme: dark)').matches;
  try { if (inNapcat && parent !== window) { const root = parent.document.documentElement; dark = root.classList.contains('dark') || root.dataset.theme === 'dark'; } } catch {}
  const theme = dark ? 'dark' : 'light'; if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}
syncTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
async function bootstrap() {
  if (inNapcat) {
    document.body.classList.add('napcat-embedded');
    if (serviceOnly) {
      for (const card of $$('[data-service]')) card.hidden = card.dataset.service !== moduleName;
      const label = { github: 'GitHub', drive: 'Google Drive', ucloud: 'UCloud' }[moduleName];
      $('[data-view="connections"] h1').textContent = label + ' 连接';
      $('[data-view="connections"] .page-heading p').textContent = '此模块可独立启停。私人 GitHub / Drive 仅允许机器人核心设置的主人 QQ 私聊访问。';
      $('[data-tab="connections"]').textContent = label;
    }
    try {
      if (parent !== window) new MutationObserver(syncTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] }); syncTheme();
    } catch {}
  }
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (key) history.replaceState(null, '', '/#bot');
  try { const session = key ? await api('session', 'POST', { key }) : await api('session'); csrf = session.csrf; await enter(); }
  catch (error) { showLogin(); if (key) { $('#login').prepend(element('p', error.message, 'feedback error')); } }
}
await bootstrap();
setInterval(async () => { if (!csrf || $('#shell').hidden) return; try { const latest = await api('state'); state.status = latest.status; renderStatus(); if (latest.settings.revision !== state.settings.revision) $('#save-state').textContent = '其他页面已更新配置，请重新载入'; } catch { $('#qq-status').textContent = '管理服务未连接'; $('#qq-status').classList.remove('ok'); $('#save-state').textContent = '无法连接本机服务，请检查进程'; } }, 15000);
