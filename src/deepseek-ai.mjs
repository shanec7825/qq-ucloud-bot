import { askAI } from './core.mjs';

export async function askDeepSeek(question, context, env = process.env, fetcher = fetch, options = {}) {
  if (!env.DEEPSEEK_API_KEY) throw new Error('请在模型设置中保存 DeepSeek API Key。');
  return askAI(question, context, { ...env, AI_BACKEND: 'deepseek', OPENAI_API_KEY: env.DEEPSEEK_API_KEY,
    OPENAI_BASE_URL: 'https://api.deepseek.com', OPENAI_MODEL: env.DEEPSEEK_MODEL || 'deepseek-flash' }, fetcher, options);
}
