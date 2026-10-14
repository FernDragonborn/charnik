<script lang="ts">
	// Adding equipment. 773 items, so the same shape as the spell picker: category is the list's
	// STRUCTURE (ui.md §4), sections start collapsed, and the toggle on the left carries the item
	// while the row body opens its article. A second click puts it back — no confirm step over an act
	// that is already one click to undo. Quantity and equipping stay on the sheet's own row.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { rowDetail } from '../rows';
	import SectionedPicker from './SectionedPicker.svelte';
	import RarityRange from './RarityRange.svelte';
	import { WHOLE_BAND, itemSectionsWithin } from '../rarity';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { InstancePicking } from '../item-instance-picking.svelte';
	import ItemInstanceAsk from './ItemInstanceAsk.svelte';
	const b = build;

	let query = $state('');
	let previewId = $state('' as string | null);
	// the picker opens showing everything: a filter that starts narrowed hides rows the player never
	// asked to hide (ui.md §4 — structure, not a filter, is what a list is grouped by)
	let from = $state(WHOLE_BAND.from);
	let to = $state(WHOLE_BAND.to);

	const picking = new InstancePicking({
		scope: () =>
			b.graph
				? { graph: b.graph, system: b.draft.system, locale: app.activeLocale, isActive: isRowActive }
				: null,
		carried: () => b.draft.inventory.map((i) => i.item),
		add: b.inventory.add,
		addInstance: b.inventory.addInstance,
		putBack: b.inventory.putBack,
	});
	const detail = $derived(
		rowDetail(previewId ? b.row(picking.rowIdOf(previewId)) : undefined, 'item'),
	);

	const sections = $derived(
		picking.withInstances(
			query,
			$_('build.inventory.instances'),
			itemSectionsWithin(b.itemList, b.graph, { from, to }),
		),
	);
</script>

<SectionedPicker
	{sections}
	bind:query
	{previewId}
	takenIds={b.draft.inventory.map((i) => i.item)}
	onpreview={(id) => (previewId = id)}
	ontake={picking.take}
	{detail}
	placeholder={$_('build.inventory.search')}
>
	{#snippet controls()}
		<RarityRange bind:from bind:to />
	{/snippet}
</SectionedPicker>
{#if picking.asking}
	<ItemInstanceAsk ask={picking.asking} onanswer={picking.answer} oncancel={picking.cancel} />
{/if}
