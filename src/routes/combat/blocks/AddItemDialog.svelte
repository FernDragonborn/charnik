<script lang="ts">
	// Adding an item from PLAY. The item itself is build data, so this writes through to
	// `build.inventory` exactly as the builder's equipment pane does — what differs is only when you
	// reach for it: you looted something mid-session and the builder is a screen away.
	//
	// It is the SAME picker the builder mounts, in a dialog: sections by category, take on the left,
	// read on the right. A second, smaller item search here would be a different contract for the
	// same act, and the row you are looking for would sort differently in the two.
	import { _ } from '$lib/i18n';
	import DialogShell from '$lib/components/DialogShell.svelte';
	import SectionedPicker from '../../build/blocks/SectionedPicker.svelte';
	import RarityRange from '../../build/blocks/RarityRange.svelte';
	import { WHOLE_BAND, withinBand } from '../../build/rarity';
	import { rowDetail, rowName } from '../../build/rows';
	import { ITEM_CATEGORIES } from '$lib/content/schemas';
	import { titleCase } from '$lib/util/format';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { combat } from '../combat-view-model.svelte';

	let { onclose }: { onclose: () => void } = $props();

	let query = $state('');
	let previewId = $state<string | null>(null);
	let from = $state(WHOLE_BAND.from);
	let to = $state(WHOLE_BAND.to);

	const inv = $derived(combat.inventory);
	/** The same pool the builder offers: this character's edition, enabled sources only. A row the
	 *  character already carries stays listed — the picker marks it taken rather than hiding it. */
	const items = $derived(
		combat.graph && combat.character
			? [...combat.graph.list('item', { system: combat.character.system })]
					.filter((r) => isRowActive(r))
					.sort((a, b) => rowName(a).localeCompare(rowName(b)))
			: [],
	);
	const sections = $derived(
		ITEM_CATEGORIES.map((category) => ({
			key: category,
			label: titleCase(category),
			rows: items.filter(
				(r) => r.data.category === category && withinBand(r.data.rarity, from, to),
			),
		})).filter((s) => s.rows.length),
	);
	const detail = $derived(rowDetail(previewId ? combat.graph?.get(previewId) : undefined, 'item'));
	const carried = $derived(inv.rows.map((r) => r.entry.item));
</script>

<DialogShell
	titleId="add-item-title"
	title={$_('combat.inventory.addItem')}
	subtitle={$_('combat.inventory.addItemBody')}
	width="760px"
	onDismiss={onclose}
>
	<div class="picker">
		<SectionedPicker
			{sections}
			bind:query
			{previewId}
			takenIds={carried}
			onpreview={(id) => (previewId = id)}
			ontake={(id) => (carried.includes(id) ? inv.remove(id) : inv.add(id))}
			{detail}
			placeholder={$_('build.inventory.search')}
		>
			{#snippet controls()}
				<RarityRange bind:from bind:to />
			{/snippet}
		</SectionedPicker>
	</div>
</DialogShell>

<style>
	/* the picker is a list that scrolls itself; the dialog gives it a height to do that inside rather
	   than growing past the viewport on a pack with a few hundred items */
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 0;
		max-height: min(62vh, 560px);
	}
</style>
