export const AI_BACKENDS = ['codex', 'api', 'deepseek', 'deepseek-harness'];
export const DEEPSEEK_DEFAULTS = Object.freeze({ deepseekModel: 'deepseek-flash', deepseekThinking: false, harnessModel: 'deepseek-flash', harnessAuth: 'api-key' });
export function modelField(backend) {
  return ({ codex: 'model', api: 'apiModel', deepseek: 'deepseekModel', 'deepseek-harness': 'harnessModel' })[backend];
}
export function selectedModel(settings) { return settings.ai[modelField(settings.ai.backend)] || ''; }
