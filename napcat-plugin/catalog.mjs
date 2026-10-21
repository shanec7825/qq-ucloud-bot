export const PLUGIN_MODULES = Object.freeze([
  { module: 'core', id: 'napcat-plugin-qq-agent', name: 'QQ Agent · 机器人核心', description: '名字、提示词、模型、群组与记忆。' },
  { module: 'github', id: 'napcat-plugin-agent-github', name: 'GitHub', description: '只读搜索和读取代码仓库。' },
  { module: 'drive', id: 'napcat-plugin-agent-drive', name: 'Google Drive', description: '只读搜索和读取云盘文件。' },
  { module: 'ucloud', id: 'napcat-plugin-agent-ucloud', name: 'UCloud · 北邮教学云', description: '学校登录、作业查询与提醒。' },
  { module: 'notices', id: 'napcat-plugin-agent-notices', name: '群通知整理', description: '通知监测、重要事项与私聊汇报。' },
]);
export function nativeConfigSchema(pluginId) {
  const plugin=PLUGIN_MODULES.find(x=>x.id===pluginId);
  if(!plugin) throw new Error('Unknown QQ Agent module');
  const pages={core:['bot','ai','qq','memory','history','library','groups','profiles','notes','digests','conversations'],github:['github'],drive:['drive'],ucloud:['school'],notices:['monitor','reports','inbox']}[plugin.module];
  return [{key:'page',type:'select',label:'配置分类',reactive:true,default:pages[0],options:pages.map(value=>({label:value,value}))},{key:'help',type:'text',default:'请等待配置载入。编辑后先保存，再切换分类。'}];
}
