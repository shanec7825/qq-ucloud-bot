import { initialNativeSchema } from './native-config.mjs';
export const PLUGIN_MODULES = Object.freeze([
  { module: 'core', id: 'napcat-plugin-qq-agent', name: 'chat', description: '联系人、角色与自动记忆' },
  { module: 'speech', id: 'napcat-plugin-agent-speech', name: '语音', description: '语音指令与试听' },
  { module: 'github', id: 'napcat-plugin-agent-github', name: 'GitHub', description: '仓库与文件' },
  { module: 'drive', id: 'napcat-plugin-agent-drive', name: 'Google Drive', description: '云盘资料' },
  { module: 'ucloud', id: 'napcat-plugin-agent-ucloud', name: 'ucloud', description: '作业与通知' },
  { module: 'notices', id: 'napcat-plugin-agent-notices', name: 'To Do', description: '通知、待办与整理' },
]);
export function nativeConfigSchema(pluginId) {
  const plugin=PLUGIN_MODULES.find(x=>x.id===pluginId);
  if(!plugin) throw new Error('Unknown QQ Agent module');
  return initialNativeSchema(plugin.module);
}
