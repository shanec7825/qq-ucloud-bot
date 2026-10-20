import { loadAppContext } from '../src/app-context.mjs';
const { settings, runtime } = await loadAppContext();
const groups = settings.history.enabled && settings.memory.enabled ? settings.groups.filter(group => group.enabled && group.historyEnabled).map(group => group.id) : [];
console.log(JSON.stringify(await runtime.history.tick(groups)));
