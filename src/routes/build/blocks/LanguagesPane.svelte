<script lang="ts">
	// Languages. A flat multi-select — there is nothing to compare and nothing to preview, so this
	// pane is deliberately just the chips and a count.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	const b = build;

	let query = $state('');
	const shown = $derived(
		query.trim()
			? b.languageList.filter((r) => rowName(r).toLowerCase().includes(query.trim().toLowerCase()))
			: b.languageList
	);
</script>

<p class="subtext">
	{$_('build.languages.chosen', { values: { count: b.draft.selectedLanguages.length } })}{#if b.backgroundLangCount > 0}
		· {$_('build.languages.backgroundGrants', { values: { count: b.backgroundLangCount } })}{/if}
</p>

<input class="text-field" placeholder={$_('build.languages.search')} bind:value={query} />

<div class="chips">
	{#each shown as row (row.effectiveId)}
		<button
			class="pick-chip"
			class:on={b.draft.selectedLanguages.includes(row.effectiveId)}
			onclick={() => b.toggleLanguage(row.effectiveId)}>{rowName(row)}</button
		>
	{:else}
		<p class="subtext">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>
