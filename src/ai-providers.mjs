import { MIMO_API_BASE_URL, MIMO_TOKEN_PLAN_CN_BASE_URL } from '../napcat-plugin/speech-config.mjs';
export { MIMO_API_BASE_URL, MIMO_TOKEN_PLAN_CN_BASE_URL };
export const AI_BACKENDS = ['codex', 'api', 'mimo-api', 'mimo-token-plan-cn', 'deepseek', 'deepseek-harness'];
export const MIMO_AI_DEFAULTS = Object.freeze({ mimoModel: 'mimo-v2.6-pro' });
export const DEEPSEEK_DEFAULTS = Object.freeze({ deepseekModel: 'deepseek-flash', deepseekThinking: false, harnessModel: 'deepseek-flash', harnessAuth: 'api-key' });
export function modelField(backend) {
  return ({ codex: 'model', api: 'apiModel', 'mimo-api': 'mimoModel', 'mimo-token-plan-cn': 'mimoModel', deepseek: 'deepseekModel', 'deepseek-harness': 'harnessModel' })[backend];
}
export function selectedModel(settings) { return settings.ai[modelField(settings.ai.backend)] || ''; }
