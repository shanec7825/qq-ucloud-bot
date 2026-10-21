export function resolveConversation(config, event = {}) {
  const accountId = event.accountId || 'default', kind = event.message_type === 'private' ? 'private' : 'group';
  const targetId = String(kind === 'group' ? event.group_id : event.user_id);
  const account = config.accounts?.find(a => a.id === accountId);
  const binding = config.bindings?.find(b => b.accountId === accountId && b.kind === kind && b.targetId === targetId);
  const group = config.groups.find(g => g.id === targetId);
  const profileId = binding?.profileId || account?.defaultProfileId || (kind === 'group' && accountId === 'default' ? group?.profileId : '') || '';
  const profile = config.profiles.find(p => p.id === profileId);
  const legacyDenied = kind === 'group' && accountId === 'default' && group && !group.enabled;
  const enabled = !legacyDenied && (account ? account.enabled : accountId === 'default') && (binding ? binding.enabled : kind === 'private' || accountId === 'default' && !!group?.enabled);
  return { accountId, kind, targetId, profileId: profile?.id || '', profile, enabled, binding };
}
export function resolveGroupPolicy(config, id, accountId = 'default') {
  const group = config.groups.find(item => item.id === String(id));
  const conversation = resolveConversation(config, { accountId, message_type: 'group', group_id: id });
  const monitorOnly = accountId === 'default' && config.monitor.groups.includes(String(id));
  return { id: String(id), accountId, name: group?.name || '', enabled: !!conversation.enabled, monitorOnly,
    canReply: !!conversation.enabled && !monitorOnly, historyEnabled: !!conversation.enabled && !!group?.historyEnabled,
    profileId: conversation.profileId, profileName: conversation.profile?.name || config.bot.name, template: group?.template || 'auto' };
}
export function profileSettings(config, id, accountId = 'default', kind = 'group') {
  const { profile } = resolveConversation(config, { accountId, message_type: kind, group_id: id, user_id: id });
  if (!profile) return config;
  return { ...config, bot: { ...config.bot, name: profile.name, systemPrompt: profile.systemPrompt },
    ai: { ...config.ai, ...(profile.model ? config.ai.backend === 'api' ? { apiModel: profile.model } : { model: profile.model } : {}) } };
}
