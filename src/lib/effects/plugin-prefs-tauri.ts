/*
 * The desktop side of `PluginPrefsStore`: the consent record is owned by Rust
 * (`src-tauri/src/plugin_consent.rs`), kept where the webview has no capability, and every call here
 * answers the record as Rust then holds it. Nothing in the page can write it — which is the point:
 * script running in the webview can place a plugin folder, and must not be able to place the
 * permission beside it. One of the few files allowed to import Tauri (eslint.config.js).
 */
import { invoke } from '@tauri-apps/api/core';
import type { PluginPrefs, PluginPrefsStore } from './plugin-host';

export const tauriPluginPrefs: PluginPrefsStore = {
	read: () => invoke<PluginPrefs>('plugin_prefs'),
	grant: (namespace, hash, locale) =>
		invoke<PluginPrefs>('grant_plugin_consent', { namespace, hash, locale }),
	forget: (namespaces) => invoke<PluginPrefs>('forget_plugins', { namespaces }),
	setEnabled: (namespace, enabled) =>
		invoke<PluginPrefs>('set_plugin_enabled', { namespace, enabled }),
	setKillSwitch: (on) => invoke<PluginPrefs>('set_plugin_kill_switch', { on }),
};
