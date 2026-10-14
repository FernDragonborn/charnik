<script lang="ts">
	// The band of item rarities a picker shows: two handles over one ladder, from mundane gear up to
	// an artifact. A starting character shops among things with no rarity at all, and the SRD's magic
	// rows outnumber them 234 to 149 — so the list a player needs was buried under items no level-1
	// character will ever hold.
	//
	// Rarity, not price: magic rows carry no cost in either edition (0 of 234 and 0 of 251), so it is
	// the only axis the shipped content can actually support.
	//
	// Two native range inputs, not a hand-rolled drag: the keyboard, the screen reader and the
	// touch target all come with them. They overlap on one track, each owning its own handle.
	import { untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import { RARITY_BAND } from '../rarity';

	let { from = $bindable(0), to = $bindable(RARITY_BAND.length - 1) }: { from?: number; to?: number } =
		$props();

	const label = (i: number) => $_(`itemRarity.${RARITY_BAND[i]}`);
	const last = RARITY_BAND.length - 1;
	/* Each handle keeps its own position and may pass the other; the band is whatever lies between
	   them. Clamping one handle at its partner left the input standing where it was dragged while the
	   band stayed put — and two handles parked on the same end, the upper one on top, could not be
	   moved at all. Nothing to clamp is nothing to get stuck on. */
	let first = $state(untrack(() => from));
	let second = $state(untrack(() => to));
	const place = () => {
		from = Math.min(first, second);
		to = Math.max(first, second);
	};
	const pct = (i: number) => (i / last) * 100;
</script>

<div class="rarity">
	<span class="eyebrow">{$_('build.inventory.rarityBand')}</span>
	<div class="track">
		<span class="fill" style:inset-inline-start="{pct(from)}%" style:width="{pct(to) - pct(from)}%"
		></span>
		<input
			type="range"
			min="0"
			max={last}
			value={first}
			aria-label={$_('build.inventory.rarityFrom')}
			oninput={(e) => {
				first = Number(e.currentTarget.value);
				place();
			}}
		/>
		<input
			type="range"
			min="0"
			max={last}
			value={second}
			aria-label={$_('build.inventory.rarityTo')}
			oninput={(e) => {
				second = Number(e.currentTarget.value);
				place();
			}}
		/>
	</div>
	<span class="band">{from === to ? label(from) : `${label(from)} — ${label(to)}`}</span>
</div>

<style>
	.rarity {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		padding: var(--space-1) 0;
	}
	.band {
		flex: none;
		font-size: var(--font-size-xs);
		color: var(--color-text);
		font-weight: 600;
	}
	.track {
		position: relative;
		flex: 1 1 auto;
		min-width: 6rem;
		height: 18px;
		display: flex;
		align-items: center;
	}
	/* the rail and the selected span of it, drawn under both inputs */
	.track::before,
	.fill {
		position: absolute;
		height: 3px;
		border-radius: var(--radius-full);
	}
	.track::before {
		content: '';
		inset-inline: 0;
		background: var(--color-border-strong);
	}
	.fill {
		background: var(--color-resource);
	}
	/* Both inputs share the track. The BAR of each is transparent and click-through so the one
	   underneath stays reachable; only the thumbs take the pointer. */
	.track input {
		position: absolute;
		inset-inline: 0;
		width: 100%;
		margin: 0;
		background: transparent;
		appearance: none;
		pointer-events: none;
	}
	.track input::-webkit-slider-thumb {
		appearance: none;
		pointer-events: auto;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--color-text);
		border: 2px solid var(--color-bg);
		cursor: pointer;
	}
	.track input::-moz-range-thumb {
		pointer-events: auto;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--color-text);
		border: 2px solid var(--color-bg);
		cursor: pointer;
	}
	/* the ring belongs to the HANDLE, not to the input: the input is the whole track, so the default
	   outline drew a box around the entire control and said nothing about which handle has the key */
	.track input:focus-visible {
		outline: none;
	}
	.track input:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 0 0 3px var(--color-accent);
	}
	.track input:focus-visible::-moz-range-thumb {
		box-shadow: 0 0 0 3px var(--color-accent);
	}
</style>
