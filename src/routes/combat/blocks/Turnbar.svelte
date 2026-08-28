<script lang="ts">
	// Action-economy bar (only shown while Combat is ON): round counter, the action/bonus/reaction
	// pip slots, the movement tracker, and Next turn. Reads the `combat` view-model; the non-null
	// character comes in as a prop (for the per-slot spent counts in `play.turn`).
	import Icon from '$lib/components/Icon.svelte';
	import type { Character } from '$lib/character/schema';
	import { combat } from '../combat-view-model.svelte';
	import { range } from '$lib/combat/helpers';

	let { c }: { c: Character } = $props();

	// action-economy slots (id + label); base 1 pip each until a feature grants extras
	const SLOTS = [
		['action', 'Action'],
		['bonus', 'Bonus'],
		['reaction', 'Reaction'],
	] as const;

	// the narrow bar drops the words, so the readout can't be the accessible name any more
	const moveLabel = $derived(
		`Movement: ${combat.economy.moveLeft} of ${combat.economy.moveMax} ft left — click to spend 5 ft`,
	);
</script>

<section class="turnbar combat-bar">
	<span class="bar-label">Round <b>{combat.round}</b></span>
	{#each SLOTS as [slot, label] (slot)}
		<!-- UBUG-17: the WHOLE pill is the hit area ("spend one {label}"), not just the 12px dot; the
		     pips inside still set the count exactly (click a spent one to restore) and stop the
		     pill's click, the same nesting the resource chips use. A button can't nest a button, so the
		     pips are role=button/tabindex=-1: by keyboard you spend via the pill and refresh with
		     "Next turn" — restoring ONE pip stays mouse-only, as on the resource chips. -->
		<button
			type="button"
			class="turn-slot"
			onclick={() => combat.economy.trySpend(slot)}
			title="Spend one {label}"
			aria-label="Spend one {label}"
		>
			<span class="slot-label">{label}</span>
			<span class="turn-pips">
				{#each range(combat.economy.slotMax[slot]) as i (i)}
					{@const used = i >= combat.economy.slotMax[slot] - c.play.turn[slot]}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span
						class="turn-pip"
						class:used
						role="button"
						tabindex="-1"
						onclick={(e) => {
							e.stopPropagation();
							combat.economy.usePip(slot, i);
						}}
						title="{label}: {used ? 'used — click to restore' : 'available'}"
						aria-label="{label} pip {i + 1}"
					></span>
				{/each}
			</span>
		</button>
	{/each}
	<button
		type="button"
		class="turn-slot move"
		onclick={() => combat.economy.spendMove(5)}
		title="Click: spend 5 ft"
		aria-label={moveLabel}
	>
		<Icon name="footprints" size={13} /> <span class="slot-label">Move</span>
		<b class:spent={combat.economy.moveLeft === 0}>{combat.economy.moveLeft}</b>
		/ {combat.economy.moveMax} <span class="slot-label">ft</span>
	</button>
	<button
		type="button"
		class="action-economy-reset"
		onclick={combat.economy.resetMove}
		title="Reset movement"><Icon name="rotate-ccw" size={13} label="Reset movement" /></button
	>
	<span class="spacer"></span>
	<button
		type="button"
		class="nextturn"
		onclick={combat.economy.nextTurn}
		aria-label="Next turn"
		title="Next turn"
		><span class="slot-label">Next turn</span> <Icon name="chevron-right" size={13} /></button
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
	/* Each threshold is the width the regime ABOVE it stops fitting in, measured on the English bar:
	   631px with full padding and words, 539px once compacted, 367px once the words are gone. Only
	   the last regime is locale-proof (pips, numbers, icons) — RE-MEASURE THE TWO THRESHOLDS when the
	   labels get translated, because `container-type` zeroes the min-content floor, so a longer word
	   overflows the bar instead of pushing it wider. */
	@container (max-width: 630px) {
		.turnbar .turn-slot {
			gap: 5px;
			padding: 5px 8px;
		}
		.turnbar .nextturn {
			padding: 7px 11px;
		}
		.turnbar .turn-slot.move .slot-label {
			display: none;
		}
	}
	@container (max-width: 540px) {
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
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
		color: var(--color-text);
		cursor: pointer;
	}
	.turn-slot:hover {
		border-color: var(--color-accent);
	}
	.turn-slot .turn-pips {
		display: inline-flex;
		gap: 4px;
	}
	.turn-slot .turn-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid var(--color-good);
		border-radius: 50%;
		background: var(--color-good);
		box-shadow: 0 0 8px color-mix(in srgb, var(--color-good) 45%, transparent);
		cursor: pointer;
	}
	.turn-slot .turn-pip.used {
		background: transparent;
		border-color: var(--color-border-strong);
		box-shadow: none;
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
		border-radius: 9px;
		padding: 7px 15px;
		cursor: pointer;
	}
	.nextturn:hover {
		filter: brightness(1.14);
	}
</style>
