<script lang="ts">
	// Adding equipment: search the item list, read the article, add it. Quantity, equipping and
	// removal stay on the sheet's own row — those are one click on something you can already see.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { buildDetail } from '$lib/content/detail';
	import { app } from '$lib/stores/app.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import OptionList from './OptionList.svelte';
	const b = build;

	let query = $state('');
	let previewId = $state<string | null>(null);

	const options = $derived(
		query.trim()
			? b.itemList.filter((r) => rowName(r).toLowerCase().includes(query.trim().toLowerCase()))
			: b.itemList
	);
	const previewRow = $derived(previewId ? b.row(previewId) : undefined);
	const detail = $derived(previewRow ? buildDetail(previewRow, 'item', undefined, app.activeLocale) : null);
	const alreadyCarried = $derived(!!previewId && b.draft.inventory.some((i) => i.item === previewId));
</script>

<OptionList
	{options}
	bind:query
	{previewId}
	takenIds={b.draft.inventory.map((i) => i.item)}
	onpreview={(id) => (previewId = id)}
	placeholder={$_('build.inventory.search')}
/>

{#if previewId}
	<button
		class="btn primary add"
		disabled={alreadyCarried}
		onclick={() => previewId && b.addInventoryItem(previewId)}
	>
		{alreadyCarried
			? $_('build.inventory.alreadyCarried')
			: $_('build.inventory.addNamed', { values: { name: rowName(previewRow) } })}
	</button>
{/if}

{#if detail}
	<div class="article"><WikiDetail {detail} /></div>
{:else}
	<p class="subtext">{$_('build.inventory.highlightToRead')}</p>
{/if}

<style>
	.add {
		width: 100%;
	}
</style>
