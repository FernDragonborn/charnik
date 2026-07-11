<script lang="ts">
	// Appearance & language settings: theme, UI locale, and the compendium/search edition filter.
	// All bind straight to the `app` store — which persists to localStorage and is mirrored onto
	// <html> by the root layout — so a choice here is live AND survives a reload. (The system a NEW
	// character is built under is chosen on the Build page, not here.)
	import { app, type SystemId, type ThemeId } from '$lib/stores/app.svelte';
	import { LOCALES } from '$lib/i18n';

	const THEMES: { id: ThemeId; label: string }[] = [
		{ id: 'dark', label: '☾ Dark' },
		{ id: 'light', label: '☀ Light' }
	];
	const SYSTEMS: { id: SystemId; label: string }[] = [
		{ id: '5e', label: 'D&D 5e (2014)' },
		{ id: '5.5e', label: 'D&D 5.5e (2024)' }
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
	<h2>Appearance & language</h2>
	<p class="sec-note">
		Theme, language, and which rules edition the compendium shows. Saved on this device and restored
		next time you open Charnik.
	</p>
</section>

<div class="setrow">
	<span class="setlabel">Theme</span>
	<div class="opts">
		{#each THEMES as t (t.id)}
			<button class="pill-btn" class:accent={app.theme === t.id} onclick={() => (app.theme = t.id)}
				>{t.label}</button
			>
		{/each}
	</div>
</div>

<div class="setrow">
	<span class="setlabel">Language</span>
	<div class="opts">
		{#each LOCALES as l (l.id)}
			<button
				class="pill-btn"
				class:accent={app.activeLocale === l.id}
				onclick={() => (app.activeLocale = l.id)}>{l.label}</button
			>
		{/each}
	</div>
</div>

<div class="setrow">
	<span class="setlabel">Shown editions</span>
	<div class="opts">
		{#each SYSTEMS as sys (sys.id)}
			<button
				class="pill-btn"
				class:accent={app.activeEditions.includes(sys.id)}
				onclick={() => toggleEdition(sys.id)}>{sys.label}</button
			>
		{/each}
	</div>
</div>

<style>
	.setrow {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 0;
		border-top: 1px solid var(--color-border);
	}
	.setrow:first-of-type {
		border-top: 0;
	}
	.setlabel {
		flex: 0 0 140px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		color: var(--color-text);
	}
	.opts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
