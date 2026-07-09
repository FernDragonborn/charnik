<script lang="ts">
	// The one shared roll affordance. Plain click = instant roll + toast; ctrl/alt-click = open the
	// dice tray (via the openDiceTray CONTRACT, not a concrete tray) prefilled with the same formula.
	// Every 🎲 in the app routes through here, so the modifier convention + the tray hook live in one
	// place. Content (the label/emoji) is the caller's; `variant` picks the look.
	import type { Snippet } from 'svelte';
	import { rollFormula } from '$lib/rules/dice';
	import { toast } from 'svelte-sonner';
	import { openDiceTray } from '$lib/dice/tray.svelte';

	let {
		formula,
		label,
		variant = 'pill',
		title,
		children
	}: {
		/** Dice formula to roll / prefill the tray ("8d6", "1d20"). */
		formula: string;
		/** Human label for the toast / tray. */
		label: string;
		/** Visual style: a bordered pill (spell effects) or a bare icon (inline, e.g. monster HP). */
		variant?: 'pill' | 'icon';
		title?: string;
		children?: Snippet;
	} = $props();

	function onClick(e: MouseEvent) {
		// modifier-click hands off to the tray (richer: adv/dis, mods) instead of rolling instantly
		if (e.ctrlKey || e.altKey) {
			openDiceTray({ label, formula });
			return;
		}
		const { total, expr } = rollFormula(formula);
		toast(`${label} — ${total}`, { description: expr });
	}
</script>

<button class="roll {variant}" {title} onclick={onClick}>{@render children?.()}</button>

<style>
	.roll.pill {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		padding: 3px 10px;
		cursor: pointer;
		background: transparent;
	}
	.roll.pill:hover {
		background: var(--color-accent-soft);
	}
	.roll.icon {
		border: 0;
		background: transparent;
		color: var(--color-accent-bright);
		cursor: pointer;
		font-size: 12px;
		padding: 0 0 0 2px;
	}
</style>
