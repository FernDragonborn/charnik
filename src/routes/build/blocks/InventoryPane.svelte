<script lang="ts">
	// Adding equipment. 773 items, so the same shape as the spell picker: category is the list's
	// STRUCTURE (ui.md §4), sections start collapsed, and the toggle on the left carries the item
	// while the row body opens its article. A second click puts it back — no confirm step over an act
	// that is already one click to undo. Quantity and equipping stay on the sheet's own row.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { ITEM_CATEGORIES } from '$lib/content/schemas';
	import { titleCase } from '$lib/util/format';
	import { rowDetail } from '../rows';
	import SectionedPicker from './SectionedPicker.svelte';
	import RarityRange from './RarityRange.svelte';
	import { WHOLE_BAND, withinBand } from '../rarity';
	const b = build;

	let query = $state('');
	let previewId = $state('' as string | null);
	// the picker opens showing everything: a filter that starts narrowed hides rows the player never
	// asked to hide (ui.md §4 — structure, not a filter, is what a list is grouped by)
	let from = $state(WHOLE_BAND.from);
	let to = $state(WHOLE_BAND.to);

	const detail = $derived(rowDetail(previewId ? b.row(previewId) : undefined, 'item'));
	const carrying = (id: string) => b.draft.inventory.some((i) => i.item === id);

	// The schema's own order, which runs weapon → armor → gear → magic, is the order a player shops
	// in; sorting it alphabetically would only scatter that.
	const sections = $derived(
		ITEM_CATEGORIES.map((category) => ({
			key: category,
			label: titleCase(category),
			rows: b.itemList.filter(
				(r) => r.data.category === category && withinBand(r.data.rarity, from, to),
			),
		})).filter((s) => s.rows.length),
	);
</script>

<SectionedPicker
	{sections}
	bind:query
	{previewId}
	takenIds={b.draft.inventory.map((i) => i.item)}
	onpreview={(id) => (previewId = id)}
	ontake={(id) => (carrying(id) ? b.inventory.remove(id) : b.inventory.add(id))}
	{detail}
	placeholder={$_('build.inventory.search')}
>
	{#snippet controls()}
		<RarityRange bind:from bind:to />
	{/snippet}
</SectionedPicker>
