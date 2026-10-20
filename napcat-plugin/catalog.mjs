export const PLUGIN_MODULES = Object.freeze([
  { module: 'core', id: 'napcat-plugin-qq-agent', name: 'QQ Agent · 机器人核心', description: '通用 AI 机器人：名字、提示词、模型、群组与记忆。' },
  { module: 'github', id: 'napcat-plugin-agent-github', name: 'GitHub', description: '只读搜索和读取代码仓库，支持 ChatGPT 连接器与独立授权。' },
  { module: 'drive', id: 'napcat-plugin-agent-drive', name: 'Google Drive', description: '只读搜索和读取云盘文件，支持 ChatGPT 连接器与独立授权。' },
  { module: 'ucloud', id: 'napcat-plugin-agent-ucloud', name: 'UCloud · 北邮教学云', description: '学校登录、近期作业查询与截止提醒。' },
  { module: 'notices', id: 'napcat-plugin-agent-notices', name: '群通知整理', description: '只读监测通知群、重要事项归纳与私聊汇报。' },
]);

export function nativeConfigSchema(pluginId) {
  const plugin = PLUGIN_MODULES.find(item => item.id === pluginId);
  if (!plugin) throw new Error('Unknown QQ Agent module');
  return [{ key: 'workbench', type: 'html',
    default: `<style>[role="dialog"]:has(iframe[data-qq-agent]) > footer > button:last-child{display:none}</style><iframe data-qq-agent title="${plugin.name}配置" src="/plugin/${pluginId}/files/ui/index.html" style="width:100%;height:68vh;min-height:380px;border:0;display:block" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>`,
    description: '在页面内点击“保存并应用”立即生效，完成后关闭此窗口。' }];
}
