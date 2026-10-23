import { modelField } from './ai-providers.mjs';

export function resolveConversation(config, event = {}) {
  const accountId = event.accountId || 'default', kind = event.message_type === 'private' ? 'private' : 'group';
  const targetId = String(kind === 'group' ? event.group_id : event.user_id);
  const account = config.accounts?.find(a => a.id === accountId);
  const binding = config.bindings?.find(b => b.accountId === accountId && b.kind === kind && b.targetId === targetId);
  const group = config.groups.find(g => g.id === targetId);
  const contact = kind === 'private' ? config.chat?.memoryContacts.find(row => row.id === targetId) : null;
  const profileId = contact ? contact.profileId : binding?.profileId || (kind === 'group' ? group?.profileId : '') || account?.defaultProfileId || '';
  const profile = config.profiles.find(p => p.id === profileId);
  const legacyDenied = kind === 'group' && group && !group.enabled;
  const enabled = !legacyDenied && (account ? account.enabled : accountId === 'default') && (binding ? binding.enabled : kind === 'private' || !!group?.enabled);
  return { accountId, kind, targetId, profileId: profile?.id || '', profile, enabled, binding };
}
export function contactMemoryMode(config, event = {}) {
  return config.chat?.memoryContacts.find(row => row.id === String(event.user_id))?.mode || config.chat?.defaultMode || 'normal';
}
export function resolveGroupPolicy(config, id, accountId = 'default') {
  const group = config.groups.find(item => item.id === String(id));
  const conversation = resolveConversation(config, { accountId, message_type: 'group', group_id: id });
  const monitorOnly = config.monitor.groups.includes(String(id));
  return { id: String(id), accountId, name: group?.name || '', enabled: !!conversation.enabled, monitorOnly,
    canReply: !!conversation.enabled && !monitorOnly, historyEnabled: !!conversation.enabled && !!group?.historyEnabled,
    profileId: conversation.profileId, profileName: conversation.profile?.name || config.bot.name, template: group?.template || 'auto' };
}
export function profileSettings(config, id, accountId = 'default', kind = 'group') {
  const { profile } = resolveConversation(config, { accountId, message_type: kind, group_id: id, user_id: id });
  if (!profile) return config;
  return { ...config, bot: { ...config.bot, name: profile.name, systemPrompt: profile.systemPrompt },
    ai: { ...config.ai, ...(profile.model && (!config.ai.backend.startsWith('mimo-') || /^mimo-/i.test(profile.model)) ? { [modelField(config.ai.backend)]: profile.model } : {}) } };
}
