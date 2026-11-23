<script lang="ts">
	// A spell-slot pool as pips: the ones left lit, the spent ones dim. With `onpick` each pip is a
	// button (the Combat panel's click-to-set); without it they are only read (the Spellbook header,
	// where a cast is seen to take one).
	import { provenance } from '#lib/actions/provenance.ts';
	import { range } from '#lib/combat/helpers.ts';

	let {
		full,
		spent,
		title,
		onpick,
	}: { full: number; spent: number; title: string; onpick?: (index: number) => void } = $props();
</script>

<span class="pips"
	>{#each range(full) as i (i)}{#if onpick}<button
				type="button"
				class="slot-pip"
				class:full={i < full - spent}
				class:spent={i >= full - spent}
				use:provenance={title}
				aria-label={title}
				onclick={() => onpick(i)}
			></button>{:else}<span
				class="slot-pip"
				class:full={i < full - spent}
				class:spent={i >= full - spent}
			></span>{/if}{/each}</span
>

<style>
	.pips {
		display: inline-flex;
		gap: var(--space-1);
	}
	.slot-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-good-line);
	}
	button.slot-pip {
		cursor: pointer;
	}
	.slot-pip.full {
		background: var(--color-good);
		border-color: var(--color-good);
		box-shadow: 0 0 8px color-mix(in srgb, var(--color-good) 45%, transparent);
	}
	.slot-pip.spent {
		background: transparent;
		opacity: 0.5;
	}
</style>
