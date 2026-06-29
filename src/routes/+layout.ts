// Standalone Tauri desktop app: client-side SPA (render in the webview), prerender the
// shell. No server.
import { app } from '$lib/stores/app.svelte';
import { startI18n, waitLocale } from '$lib/i18n';

export const ssr = false;
export const prerender = true;

export const load = async () => {
	startI18n(app.activeLocale);
	// Ensure the active catalog is loaded before first paint (no flash of message keys).
	await waitLocale();
	return {};
};
