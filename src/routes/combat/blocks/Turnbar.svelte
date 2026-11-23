<script lang="ts">
	// Action-economy bar (only shown while Combat is ON): round counter, the action/bonus/reaction
	// pip slots, the movement tracker, and Next turn. Reads the `combat` view-model; the non-null
	// character comes in as a prop (for the per-slot spent counts in `play.turn`).
	import Icon from '#lib/components/Icon.svelte';
	import { provenance } from '#lib/actions/provenance.ts';
	import type { Character } from '#lib/character/schema.ts';
	import { combat } from '../combat-view-model.svelte';
	import { range } from '#lib/combat/helpers.ts';
	import { _ } from '#lib/i18n/index.ts';

	let { c }: { c: Character } = $props();
	// the round of THIS fight, counted from 1, on a clock that keeps running under it
	const fightRound = $derived(c.play.round - c.play.fightStartRound + 1);

	// action-economy slots (id + label); base 1 pip each until a feature grants extras. Each slot's
	// pip has its own SHAPE (see the styles) — on the narrow bar the words are gone and the shape is
	// the only thing telling an action from a bonus action from a reaction.
	const SLOTS = ['action', 'bonus', 'reaction'] as const;
	/** A slot's word. Its id IS the catalog key, so a new slot needs no table here. */
	const slotLabel = (slot: (typeof SLOTS)[number]) => $_(`combat.turn.${slot}`);

	// the narrow bar drops the words, so the readout can't be the accessible name any more
	const moveLabel = $derived(
		$_('combat.turn.moveReading', {
			values: { left: combat.economy.moveLeft, max: combat.economy.moveMax },
		}),
	);
</script>

<section class="turnbar combat-bar">
	<span class="bar-label">{$_('combat.turn.round')} <b>{fightRound}</b></span>
	{#each SLOTS as slot (slot)}
		{@const label = slotLabel(slot)}
		<!-- UBUG-17: the WHOLE pill is the hit area ("spend one {label}"), not just the 12px dot: the
		     spend button is stretched over the pill, and the pips sit above it as buttons of their
		     own that set the count exactly (click a spent one to restore). Siblings rather than one
		     button inside another, which no assistive technology can operate. By keyboard you spend
		     via the pill and refresh with "Next turn"; the pips stay out of the tab order. -->
		<div class="turn-slot">
			<button
				type="button"
				class="slot-spend"
				onclick={() => combat.economy.trySpend(slot)}
				use:provenance={$_('combat.turn.spendOne', { values: { label } })}
				aria-label={$_('combat.turn.spendOne', { values: { label } })}
			>
				<span class="slot-label">{label}</span>
			</button>
			<span class="turn-pips">
				{#each range(combat.economy.slotMax[slot]) as i (i)}
					{@const used = i >= combat.economy.slotMax[slot] - c.play.turn[slot]}
					<button
						type="button"
						class="turn-pip pip-{slot}"
						class:used
						tabindex="-1"
						onclick={() => combat.economy.usePip(slot, i)}
						use:provenance={$_(used ? 'combat.turn.pipUsed' : 'combat.turn.pipAvailable', {
							values: { label },
						})}
						aria-label={$_('combat.turn.pip', { values: { label, n: i + 1 } })}
					></button>
				{/each}
			</span>
		</div>
	{/each}
	<button
		type="button"
		class="turn-slot move"
		onclick={() => combat.economy.spendMove(5)}
		use:provenance={$_('combat.turn.moveHint')}
		aria-label={moveLabel}
	>
		<Icon name="footprints" size={13} /> <span class="slot-label">{$_('combat.turn.move')}</span>
		<b class:spent={combat.economy.moveLeft === 0}>{combat.economy.moveLeft}</b>
		/ {combat.economy.moveMax} <span class="slot-label">{$_('combat.turn.feet')}</span>
	</button>
	<button
		type="button"
		class="action-economy-reset"
		onclick={combat.economy.resetMove}
		use:provenance={$_('combat.turn.resetMove')}
		aria-label={$_('combat.turn.resetMove')}><Icon name="rotate-ccw" size={13} /></button
	>
	<span class="spacer"></span>
	<button
		type="button"
		class="nextturn"
		onclick={combat.nextTurn}
		aria-label={$_('combat.turn.nextTurn')}
		use:provenance={$_('combat.turn.nextTurn')}
		><span class="slot-label">{$_('combat.turn.nextTurn')}</span>
		<Icon name="chevron-right" size={13} /></button
	>
</section>

<style>
	/* container (.combat-bar) + .bar-label are shared (components.css) */

	/* The bar never wraps (.combat-bar), so it has to fit itself into whatever the status row leaves
	   it — which is a CONTAINER width, not a viewport one: the same 1400px window gives this bar half
	   the room once a long roll is sitting in the strip beside it. Two steps: first the padding and
	   the unit go, then the words, leaving the pips that carry the actual state. Nothing is ever
	   removed — every control keeps its box, its hit area, and (via aria-label) its name. */
	.turnbar {
		container-type: inline-size;
	}
	.turnbar .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}
	/* Each threshold is the width the regime ABOVE it stops fitting in, as the CONTENT box the query
	   sees (the bar's own 12px padding and 1px border are NOT in it), taken as the MAXIMUM over every
	   shipped locale — `container-type` zeroes the min-content floor, so a label too long for the
	   regime overflows the bar instead of pushing it wider. Measured: full 612 (en) / 627 (uk),
	   compact 520 (en) / 541 (uk), wordless 341 (en) / 338 (uk) — only the last is locale-proof, being
	   pips, numbers and icons. A NEW LOCALE MEANS RE-MEASURING: force each regime's declarations with
	   `container-type: normal; width: min-content` and read the bar's width back. */
	@container (max-width: 630px) {
		.turnbar .turn-slot {
			gap: var(--space-1);
			padding: var(--space-1) var(--space-2);
		}
		.turnbar .nextturn {
			padding: var(--space-1-5) var(--space-2-5);
		}
		.turnbar .turn-slot.move .slot-label {
			display: none;
		}
	}
	@container (max-width: 545px) {
		.turnbar .turn-slot .slot-label,
		.turnbar .nextturn .slot-label {
			display: none;
		}
		/* label-less, the pill is only as wide as its pips — keep a finger-sized target */
		.turnbar .turn-slot {
			min-width: 34px;
			justify-content: center;
		}
	}
	/* every pill in this bar is a button; they all signal it the same way (hover + pointer + the
	   global focus ring) — a pill that looked inert was the UBUG-17 complaint */
	.turn-slot {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-2-5);
		color: var(--color-text);
		cursor: pointer;
	}
	.turn-slot:hover {
		border-color: var(--color-accent);
	}
	/* the slot pill is a box around two kinds of button; the spend one covers all of it */
	div.turn-slot {
		position: relative;
	}
	.slot-spend {
		background: none;
		border: 0;
		padding: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.slot-spend::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.slot-spend:focus-visible {
		outline: none;
	}
	div.turn-slot:has(.slot-spend:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.turn-slot .turn-pips {
		position: relative;
		z-index: 1;
		display: inline-flex;
		gap: var(--space-1);
	}
	/* One shape per slot, following Baldur's Gate 3's action economy — a circle for an action, a
	   triangle for a bonus action, a four-pointed star for a reaction. The shape, not the colour, is
	   what identifies a slot: it survives a user theme, a colour-blind eye, and the narrow bar that
	   has dropped the words. Colours come from existing semantic tokens rather than new ones, so
	   every shipped and user-written theme keeps working with no entry to add.
	   `clip-path` clips a border and a box-shadow away with the box, so a spent pip is a MUTED FILL
	   (not an outline) and the glow is a drop-shadow filter.
	   The SHAPE is drawn on `::before`, and only the glow lives on the pip itself: CSS applies a
	   filter BEFORE clip-path, so a pip that clipped itself cut its own drop-shadow away — which is
	   why the circle glowed and the triangle and the star did not. */
	.turn-slot .turn-pip {
		width: 13px;
		height: 13px;
		padding: 0;
		border: 0;
		background: none;
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--pip-color) 55%, transparent));
		cursor: pointer;
	}
	.turn-slot .turn-pip::before {
		content: '';
		display: block;
		width: 100%;
		height: 100%;
		background: var(--pip-color);
		clip-path: var(--pip-shape, none);
		border-radius: var(--pip-radius, 0);
	}
	.turn-slot .turn-pip.used {
		--pip-color: var(--color-border-strong);
		filter: none;
	}
	.turn-slot .pip-action {
		--pip-color: var(--color-good);
		--pip-radius: 50%;
	}
	.turn-slot .pip-bonus {
		--pip-color: var(--color-warning);
		width: 15px;
		--pip-shape: polygon(50% 4%, 100% 96%, 0 96%);
	}
	.turn-slot .pip-reaction {
		--pip-color: var(--color-accent-bright);
		width: 15px;
		height: 15px;
		--pip-shape: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
	}
	.turn-slot b {
		color: var(--color-text);
	}
	.turn-slot b.spent {
		color: var(--color-text-muted);
	}
	/* the Move readout is quieter than the three economy slots until hovered */
	.turn-slot.move {
		color: var(--color-text-muted);
	}
	.turn-slot.move:hover {
		color: var(--color-text);
	}
	.action-economy-reset {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		width: 28px;
		height: 28px;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: var(--font-size-body);
	}
	.action-economy-reset:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.nextturn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: var(--radius);
		padding: var(--space-1-5) 15px;
		cursor: pointer;
	}
	.nextturn:hover {
		filter: brightness(1.14);
	}
</style>
