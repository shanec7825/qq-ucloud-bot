import { initialNativeSchema } from './native-config.mjs';
export const PLUGIN_MODULES = Object.freeze([
  { module: 'core', id: 'napcat-plugin-qq-agent', name: 'QQ Agent · 机器人设置', description: 'QQ 账号连接、群聊回复、角色与记忆。' },
  { module: 'github', id: 'napcat-plugin-agent-github', name: 'GitHub', description: '搜索仓库、文件、议题与 PR；确认后写入。' },
  { module: 'drive', id: 'napcat-plugin-agent-drive', name: 'Google Drive', description: '搜索与读取云盘；独立授权后可确认写入。' },
  { module: 'ucloud', id: 'napcat-plugin-agent-ucloud', name: 'UCloud · 北邮教学云', description: '学校登录、作业查询、准备与截止提醒。' },
  { module: 'notices', id: 'napcat-plugin-agent-notices', name: '群消息与提醒', description: '即时重要提醒、定时总结、待办与记录。' },
]);
export function nativeConfigSchema(pluginId) {
  const plugin=PLUGIN_MODULES.find(x=>x.id===pluginId);
  if(!plugin) throw new Error('Unknown QQ Agent module');
  return initialNativeSchema(plugin.module);
}
