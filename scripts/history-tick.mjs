import { HistoryDigest } from '../src/history-digest.mjs';
import { askCodex } from '../src/codex-ai.mjs';
const allowed = (process.env.ALLOWED_GROUPS || '').split(',');
const groups = (process.env.GROUP_HISTORY_MODEL_GROUPS || '').split(',').filter(group => allowed.includes(group) && /^\d{5,15}$/.test(group));
const digest = new HistoryDigest({ ai: askCodex });
console.log(JSON.stringify(await digest.tick(groups)));
