import { DEEPSEEK_DEFAULTS } from './ai-providers.mjs';
import { SPEECH_DEFAULTS } from '../napcat-plugin/speech-config.mjs';
// Pure migrations keep saved settings and caller-owned objects unchanged.
export function migrateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = structuredClone(value);
  next.speech ??= { ...SPEECH_DEFAULTS };
  if (next.speech && typeof next.speech === 'object' && !Array.isArray(next.speech)) next.speech = { autoStyle: SPEECH_DEFAULTS.autoStyle, voiceDescription: SPEECH_DEFAULTS.voiceDescription, ...next.speech };
  if (next.ai && typeof next.ai === 'object' && !Array.isArray(next.ai)) next.ai = { ...DEEPSEEK_DEFAULTS, ...next.ai };
  if (next.version === 1) {
    next.version = 2;
    next.profiles ??= [];
  }
  if (next.version === 2) {
    next.version = 3;
    next.accounts ??= [{ id: 'default', name: '默认 QQ', enabled: true, url: next.qq?.url || 'ws://127.0.0.1:3001', defaultProfileId: '' }];
    next.bindings ??= [];
  }
  next.realtime ??= { enabled: false, groups: [], recipientQQ: '', accountId: 'default', debounceSeconds: 10, focus: '考试、选课、报名、材料提交、截止时间、课程调整、奖助评优及重要活动。' };
  if (next.drive && typeof next.drive === 'object') next.drive.accessMode ??= 'read';
  next.agent ??= { enabled: false, writes: false, maxSteps: 4 };
  if (Array.isArray(next.groups)) next.groups = next.groups.map(group => group && typeof group === 'object' && !Array.isArray(group) ? { template: 'auto', templatePrompt: '', profileId: '', ...group } : group);
  return next;
}
