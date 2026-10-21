// Pure migrations keep saved settings and caller-owned objects unchanged.
export function migrateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = structuredClone(value);
  if (next.version === 1) {
    next.version = 2;
    next.profiles ??= [];
  }
  if (Array.isArray(next.groups)) next.groups = next.groups.map(group => group && typeof group === 'object' && !Array.isArray(group) ? { template: 'auto', templatePrompt: '', profileId: '', ...group } : group);
  return next;
}
