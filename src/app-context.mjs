import { SettingsStore } from './settings.mjs';
import { SecretVault } from './secret-vault.mjs';
import { BotRuntime } from './runtime.mjs';
export async function loadAppContext() {
  const store = new SettingsStore(); await store.load();
  const vault = new SecretVault(); await vault.load();
  const runtime = new BotRuntime(store, vault);
  return { store, vault, runtime, settings: store.get() };
}
