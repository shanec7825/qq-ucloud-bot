import { initialNativeSchema } from './native-config.mjs';
export const PLUGIN_MODULES = Object.freeze([
  { module: 'core', id: 'napcat-plugin-qq-agent', name: '机器人', description: '人格、群聊、账号与记忆' },
  { module: 'github', id: 'napcat-plugin-agent-github', name: 'GitHub', description: '仓库与文件' },
  { module: 'drive', id: 'napcat-plugin-agent-drive', name: 'Google Drive', description: '云盘资料' },
  { module: 'ucloud', id: 'napcat-plugin-agent-ucloud', name: '教学云', description: '作业与通知' },
  { module: 'notices', id: 'napcat-plugin-agent-notices', name: '群消息', description: '提醒、待办与整理' },
]);
export function nativeConfigSchema(pluginId) {
  const plugin=PLUGIN_MODULES.find(x=>x.id===pluginId);
  if(!plugin) throw new Error('Unknown QQ Agent module');
  return initialNativeSchema(plugin.module);
}
