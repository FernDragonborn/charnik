<script lang="ts">
	// Appearance & language settings: theme, UI locale, the compendium/search edition filter — and
	// the one RULE option that lives here, because it is a table's house ruling rather than a
	// character's: how a crit doubles damage.
	// All bind straight to the `app` store — which persists to localStorage and is mirrored onto
	// <html> by the root layout — so a choice here is live AND survives a reload. (The system a NEW
	// character is built under is chosen on the Build page, not here.)
	import Icon, { type IconName } from '../Icon.svelte';
	import { app, type SystemId, type ThemeId } from '$lib/stores/app.svelte';
	import { SYSTEMS, SYSTEM_LABELS } from '$lib/rules/pipeline';
	import { LOCALES, _ } from '$lib/i18n';
	import { CRIT_METHOD, type CritMethod } from '$lib/rules/dice';

	// a closed vocabulary: the id is the fact, and its name and hint are catalog entries derived from
	// it, so a method is spelled in exactly one place (docs/internals/ui.md ▸ Strings live in the catalogs)
	const CRIT_METHODS: CritMethod[] = [CRIT_METHOD.classic, CRIT_METHOD.loyal];

	const THEMES: { id: ThemeId; icon: IconName }[] = [
		{ id: 'dark', icon: 'moon' },
		{ id: 'light', icon: 'sun' },
	];

	// An edition may be toggled off to hide it from the compendium/search, but never the last one
	// (that would blank all content) — keep at least one active.
	function toggleEdition(id: SystemId) {
		const on = app.activeEditions.includes(id);
		if (on && app.activeEditions.length === 1) return;
		app.activeEditions = on
			? app.activeEditions.filter((e) => e !== id)
			: [...app.activeEditions, id];
	}
</script>

<section class="sec-head">
	<h2>{$_('settings.general.title')}</h2>
	<p class="sec-note">{$_('settings.general.blurb')}</p>
</section>

<div class="setting-row">
	<span class="setting-label">{$_('settings.theme')}</span>
	<div class="setting-options">
		{#each THEMES as t (t.id)}
			<button class="pill-btn" class:accent={app.theme === t.id} onclick={() => (app.theme = t.id)}
				><Icon name={t.icon} size={13} />
				{$_(`settings.theme${t.id === 'dark' ? 'Dark' : 'Light'}`)}</button
			>
		{/each}
	</div>
</div>

<div class="setting-row">
	<span class="setting-label">{$_('settings.language')}</span>
	<div class="setting-options">
		{#each LOCALES as l (l.id)}
			<button
				class="pill-btn"
				class:accent={app.activeLocale === l.id}
				onclick={() => (app.activeLocale = l.id)}>{l.label}</button
			>
		{/each}
	</div>
</div>

<div class="setting-row">
	<span class="setting-label">{$_('settings.general.editions')}</span>
	<div class="setting-options">
		{#each SYSTEMS as sys (sys)}
			<button
				class="pill-btn"
				class:accent={app.activeEditions.includes(sys)}
				onclick={() => toggleEdition(sys)}>{SYSTEM_LABELS[sys]}</button
			>
		{/each}
	</div>
</div>

<div class="setting-row">
	<span class="setting-label">{$_('settings.general.crit')}</span>
	<div class="setting-options">
		{#each CRIT_METHODS as method (method)}
			<button
				class="pill-btn"
				class:accent={app.critMethod === method}
				title={$_(`settings.general.critHint.${method}`)}
				onclick={() => (app.critMethod = method)}
				>{$_(`settings.general.critName.${method}`)}</button
			>
		{/each}
	</div>
</div>
<p class="sec-note crit-note">{$_('settings.general.critNote')}</p>

<style>
	/* rows use the global .setting-row / .setting-label / .setting-options (components.css) */
	.crit-note {
		margin-top: var(--space-1-5);
	}
</style>
