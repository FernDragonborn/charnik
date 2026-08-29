<script lang="ts">
	// Adding equipment: search the item list, click to carry it, read the article. A click carries the
	// item and a second one puts it back — no confirm step over an act that is already one click to
	// undo. Quantity and equipping stay on the sheet's own row, on something you can already see.
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
	const carrying = (id: string) => b.draft.inventory.some((i) => i.item === id);
</script>

<OptionList
	{options}
	bind:query
	{previewId}
	takenIds={b.draft.inventory.map((i) => i.item)}
	onpreview={(id) => (previewId = id)}
	onactivate={(id) => (carrying(id) ? b.removeInventoryItem(id) : b.addInventoryItem(id))}
	placeholder={$_('build.inventory.search')}
/>

{#if detail}
	<div class="article"><WikiDetail {detail} /></div>
{:else}
	<p class="subtext">{$_('build.inventory.highlightToRead')}</p>
{/if}
