import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';

const features = {
  core: { capabilities: ['chat', 'profiles', 'groups', 'memory'], navigation: ['bot', 'groups', 'memory', 'customization'] },
  speech: { capabilities: ['speech'], navigation: ['speech'] },
  notices: { capabilities: ['monitor', 'inbox'], navigation: ['monitor'] },
  github: { capabilities: ['github'], navigation: ['connections'] },
  drive: { capabilities: ['drive'], navigation: ['connections'] },
  ucloud: { capabilities: ['school'], navigation: ['connections'] },
};
export const MODULES = Object.freeze(PLUGIN_MODULES.map(plugin => Object.freeze({ id: plugin.module, pluginId: plugin.id,
  name: plugin.name, description: plugin.description, ...features[plugin.module] })));
export const MODULE_IDS = Object.freeze(MODULES.map(module => module.id));
