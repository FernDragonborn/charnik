<script lang="ts">
	// Adding an item from PLAY. The item itself is build data, so this writes through to
	// `build.inventory` exactly as the builder's equipment pane does — what differs is only when you
	// reach for it: you looted something mid-session and the builder is a screen away.
	//
	// It is the SAME picker the builder mounts: sections by category, take in the list, read in the
	// card beside it. A second, smaller item search here would be a different contract for the same
	// act, and the row you are looking for would sort differently in the two.
	//
	// The chrome is a POPOVER on the control that opened it, not a dialog: adding an item is a step
	// inside the inventory panel, and nothing is being asked of the player. So no backdrop, no
	// badge, no subtitle — a title, a way out, and the sheet still readable around it.
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import { anchored } from '$lib/actions/anchored';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import SectionedPicker from '../../build/blocks/SectionedPicker.svelte';
	import RarityRange from '../../build/blocks/RarityRange.svelte';
	import { WHOLE_BAND, itemWithinBand } from '../../build/rarity';
	import { itemRarities } from '$lib/content/options';
	import { rowDetail, rowName } from '../../build/rows';
	import { ITEM_CATEGORIES } from '$lib/content/schemas';
	import { titleCase } from '$lib/util/format';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { combat } from '../combat-view-model.svelte';

	let { anchor, onclose }: { anchor: HTMLElement; onclose: () => void } = $props();

	/** The picker's own floating parts, which live in the body: a press on the card's Take is a
	 *  press inside this surface. */
	const PICKER_PARTS = '.picker-card, .picker-peek';

	let surface = $state<HTMLDivElement>();
	let query = $state('');
	let previewId = $state<string | null>(null);
	let from = $state(WHOLE_BAND.from);
	let to = $state(WHOLE_BAND.to);

	// the keyboard starts in the search field, and goes back to the control when this closes
	onMount(() => {
		surface?.querySelector('input')?.focus();
		return () => anchor.focus();
	});

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
				(r) =>
					r.data.category === category && itemWithinBand(itemRarities(r, combat.graph), from, to),
			),
		})).filter((s) => s.rows.length),
	);
	const detail = $derived(rowDetail(previewId ? combat.graph?.get(previewId) : undefined, 'item'));
	const carried = $derived(inv.rows.map((r) => r.entry.item));
</script>

<div
	bind:this={surface}
	class="add-item-popover"
	role="dialog"
	aria-labelledby="add-item-title"
	use:anchored={{ anchor, onclose, companions: PICKER_PARTS }}
	use:dismissOnEscape={onclose}
>
	<header class="head">
		<h2 id="add-item-title">{$_('combat.inventory.addItem')}</h2>
		<button class="close" onclick={onclose} aria-label={$_('app.close')}>
			<Icon name="x" size={15} />
		</button>
	</header>
	<div class="picker">
		<SectionedPicker
			{sections}
			bind:query
			{previewId}
			takenIds={carried}
			onpreview={(id) => (previewId = id)}
			ontake={(id) => (carried.includes(id) ? inv.putBack(id) : inv.add(id))}
			{detail}
			placeholder={$_('build.inventory.search')}
		>
			{#snippet controls()}
				<RarityRange bind:from bind:to />
			{/snippet}
		</SectionedPicker>
	</div>
</div>

<style>
	.add-item-popover {
		position: fixed;
		z-index: 61;
		display: flex;
		flex-direction: column;
		width: min(47.5rem, calc(100vw - 2 * var(--space-4)));
		/* the picker is a list that scrolls itself; the popover gives it a height to do that inside
		   rather than growing past the viewport on a pack with a few hundred items */
		height: min(32.5rem, 62vh);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		overflow: hidden;
		/* a list scrolled to its end must not start scrolling the sheet under it */
		overscroll-behavior: contain;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}
	.head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-h5);
	}
	.close {
		display: grid;
		place-items: center;
		width: var(--space-6);
		height: var(--space-6);
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.close:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1;
		min-height: 0;
		padding: var(--space-3) var(--space-4) var(--space-4);
	}
</style>
