<script lang="ts">
	// Adding equipment. 773 items, so the same shape as the spell picker: category is the list's
	// STRUCTURE (ui.md §4), sections start collapsed, and the toggle on the left carries the item
	// while the row body opens its article. A second click puts it back — no confirm step over an act
	// that is already one click to undo. Quantity and equipping stay on the sheet's own row.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { buildDetail } from '$lib/content/detail';
	import { ITEM_CATEGORIES } from '$lib/content/schemas';
	import { app } from '$lib/stores/app.svelte';
	import { titleCase } from '$lib/util/format';
	import SectionedPicker from './SectionedPicker.svelte';
	const b = build;

	let query = $state('');
	let previewId = $state<string | null>(null);

	const previewRow = $derived(previewId ? b.row(previewId) : undefined);
	const detail = $derived(
		previewRow ? buildDetail(previewRow, 'item', undefined, app.activeLocale) : null,
	);
	const carrying = (id: string) => b.draft.inventory.some((i) => i.item === id);

	// The schema's own order, which runs weapon → armor → gear → magic, is the order a player shops
	// in; sorting it alphabetically would only scatter that.
	const sections = $derived(
		ITEM_CATEGORIES.map((category) => ({
			key: category,
			label: titleCase(category),
			rows: b.itemList.filter((r) => r.data.category === category),
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
/>
