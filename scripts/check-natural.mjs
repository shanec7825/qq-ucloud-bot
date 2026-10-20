import { routeNatural } from '../src/natural-chat.mjs';
import { PublicCatalog } from '../src/access.mjs';
import { SharedLibrary } from '../src/shared-library.mjs';
import { loadPersona, ConversationMemory } from '../src/persona.mjs';
import { askCodex } from '../src/codex-ai.mjs';
const event = { message_type: 'group', group_id: (process.env.ALLOWED_GROUPS || '').split(',')[0], user_id: 10001 };
const answer = await routeNatural(process.argv[2] || '请根据课件，用两句话解释偏序关系。', event, {
  owner: process.env.OWNER_QQ,
  catalog: new PublicCatalog(new URL('../data/public-assignments.json', import.meta.url), new URL('../public/books.json', import.meta.url)),
  library: new SharedLibrary(process.env.SHARED_PDFS_ROOT), persona: loadPersona, memory: new ConversationMemory(),
  shareDocumentsWithModel: process.env.SHARED_DOCUMENTS_TO_MODEL === 'true',
  resources: { drive: () => { throw new Error('群聊不应调用私人网盘'); }, github: () => { throw new Error('群聊不应调用私人项目'); } },
  ai: askCodex,
});
console.log(answer ? '自然语言 + 公开课件检索 + 订阅模型联调成功；未向 QQ 群发送消息。' : '未获得回答。');
