export function resolveGroupPolicy(config, id) {
  const group = config.groups.find(item => item.id === String(id));
  const monitorOnly = config.monitor.groups.includes(String(id));
  const profile = config.profiles.find(item => item.id === group?.profileId);
  return { id: String(id), name: group?.name || '', enabled: !!group?.enabled, monitorOnly,
    canReply: !!group?.enabled && !monitorOnly, historyEnabled: !!group?.enabled && !!group?.historyEnabled,
    profileId: profile?.id || '', profileName: profile?.name || config.bot.name, template: group?.template || 'auto' };
}

export function profileSettings(config, id) {
  const policy = resolveGroupPolicy(config, id), profile = config.profiles.find(item => item.id === policy.profileId);
  if (!profile) return config;
  return { ...config, bot: { ...config.bot, name: profile.name, systemPrompt: profile.systemPrompt },
    ai: { ...config.ai, ...(profile.model ? config.ai.backend === 'api' ? { apiModel: profile.model } : { model: profile.model } : {}) } };
}
