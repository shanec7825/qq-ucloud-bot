import { DEEPSEEK_DEFAULTS, MIMO_AI_DEFAULTS } from './ai-providers.mjs';
import { SPEECH_DEFAULTS } from '../napcat-plugin/speech-config.mjs';
import { NOTICE_FILTER_DEFAULTS, NOTICE_DIGEST_DEFAULTS } from './notice-format.mjs';
// Pure migrations keep saved settings and caller-owned objects unchanged.
export function migrateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = structuredClone(value);
  next.chat ??= { defaultMode: 'normal', memoryContacts: [] };
  next.speech ??= { ...SPEECH_DEFAULTS };
  if (next.speech && typeof next.speech === 'object' && !Array.isArray(next.speech)) {
    if (next.speech.directiveVersion === undefined) {
      if (next.speech.model === 'mimo-v2.5-tts-voicedesign' && next.speech.voiceDescription?.trim()) next.speech.style = [next.speech.voiceDescription.trim(), next.speech.style?.trim()].filter(Boolean).join('；');
      next.speech.directiveVersion = 2;
    }
    next.speech = { autoStyle: SPEECH_DEFAULTS.autoStyle, voiceDescription: SPEECH_DEFAULTS.voiceDescription, referenceAudio: SPEECH_DEFAULTS.referenceAudio, ...next.speech };
  }
  if (next.ai && typeof next.ai === 'object' && !Array.isArray(next.ai)) next.ai = { ...MIMO_AI_DEFAULTS, ...DEEPSEEK_DEFAULTS, ...next.ai };
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
  if (next.realtime && typeof next.realtime === 'object' && !Array.isArray(next.realtime)) next.realtime = { ...NOTICE_FILTER_DEFAULTS, ...next.realtime };
  if (next.monitor && typeof next.monitor === 'object' && !Array.isArray(next.monitor)) next.monitor = { ...NOTICE_DIGEST_DEFAULTS, ...next.monitor };
  if (next.drive && typeof next.drive === 'object') next.drive.accessMode ??= 'read';
  if (next.school && typeof next.school === 'object' && !Array.isArray(next.school) && next.school.groups === undefined) next.school.groups = [];
  next.agent ??= { enabled: false, writes: false, maxSteps: 4 };
  if (Array.isArray(next.groups)) next.groups = next.groups.map(group => group && typeof group === 'object' && !Array.isArray(group) ? { template: 'auto', templatePrompt: '', profileId: '', ...group } : group);
  return next;
}
