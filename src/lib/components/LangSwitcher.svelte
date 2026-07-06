<script lang="ts">
	// The one canonical language switcher — reused everywhere (topbar, dialogs) so it looks and behaves
	// identically. Cycles the active locale through the discovered LOCALES; the layout's reactive effect
	// pushes `app.activeLocale` into svelte-i18n, so the whole UI (including any open dialog) re-renders.
	import { _, LOCALES, FALLBACK_LOCALE } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';

	function cycle() {
		const ids = LOCALES.map((l) => l.id);
		app.activeLocale = ids[(ids.indexOf(app.activeLocale) + 1) % ids.length] ?? FALLBACK_LOCALE;
	}
</script>

<button
	type="button"
	class="lang-switch"
	onclick={cycle}
	title={$_('settings.language')}
	aria-label={$_('settings.language')}
>
	{app.activeLocale.toUpperCase()}
</button>

<style>
	.lang-switch {
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	.lang-switch:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
</style>
