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
	import { LOCALES } from '$lib/i18n';
	import { CRIT_METHOD, type CritMethod } from '$lib/rules/dice';

	const CRIT_METHODS: { id: CritMethod; label: string; hint: string }[] = [
		{ id: CRIT_METHOD.classic, label: 'Classic', hint: 'RAW — roll the damage dice twice' },
		{ id: CRIT_METHOD.loyal, label: 'Loyal', hint: 'One set rolled, one set at its maximum' },
	];

	const THEMES: { id: ThemeId; label: string; icon: IconName }[] = [
		{ id: 'dark', label: 'Dark', icon: 'moon' },
		{ id: 'light', label: 'Light', icon: 'sun' },
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

<div class="setting-row">
	<span class="setting-label">Theme</span>
	<div class="setting-options">
		{#each THEMES as t (t.id)}
			<button class="pill-btn" class:accent={app.theme === t.id} onclick={() => (app.theme = t.id)}
				><Icon name={t.icon} size={13} /> {t.label}</button
			>
		{/each}
	</div>
</div>

<div class="setting-row">
	<span class="setting-label">Language</span>
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
	<span class="setting-label">Shown editions</span>
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
	<span class="setting-label">Critical hits</span>
	<div class="setting-options">
		{#each CRIT_METHODS as m (m.id)}
			<button
				class="pill-btn"
				class:accent={app.critMethod === m.id}
				title={m.hint}
				onclick={() => (app.critMethod = m.id)}>{m.label}</button
			>
		{/each}
	</div>
</div>
<p class="sec-note crit-note">
	Either way the flat modifier is never doubled. A single roll can be switched to the other method
	in the roller, where a table usually rules on it.
</p>

<style>
	/* rows use the global .setting-row / .setting-label / .setting-options (components.css) */
	.crit-note {
		margin-top: 6px;
	}
</style>
