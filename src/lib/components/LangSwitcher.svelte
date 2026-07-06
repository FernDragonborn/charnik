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

<!-- `.chip` is the shared global chip style (styles/components.css) -->
<button
	type="button"
	class="chip"
	onclick={cycle}
	title={$_('settings.language')}
	aria-label={$_('settings.language')}
>
	{app.activeLocale.toUpperCase()}
</button>
