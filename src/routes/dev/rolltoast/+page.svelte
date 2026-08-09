<script lang="ts">
	// DEV-ONLY preview of the roll toast (design 5A). Toasts are transient and RNG-driven, so every
	// shape (one-liner → attack with advantage → multi-type damage → nat 20 / nat 1) is rendered here
	// from fixed rolls as a static ladder, plus buttons that fire the real thing through toastRoll.
	// Not linked from the app; gated to dev builds by /dev/+layout.
	import RollToast from '$lib/components/RollToast.svelte';
	import { rollToastModel, toastRoll } from '$lib/dice/roll-toast';
	import type { RollLogEntry } from '$lib/combat/helpers';

	// hand-built entries in exactly the shape pushRoll stores (expr strings straight from rollPool)
	const CASES: { title: string; entry: RollLogEntry }[] = [
		{
			title: 'one roll, no types — the one-liner',
			entry: { label: 'Perception', expr: 'd20(14) +4', total: 18 }
		},
		{
			title: 'attack with advantage — the dropped die stays visible',
			entry: {
				label: 'Longsword — to hit',
				expr: ' +5',
				total: 19,
				advantageRoll: { kept: 14, dropped: 7 },
				natural: 14
			}
		},
		{
			title: 'two damage types — labels switch on, subtotals go subordinate',
			entry: {
				label: 'Flame Tongue',
				expr: 'd20(11) +6',
				total: 17,
				damage: [
					{ type: 'slashing', expr: 'd8(6) +3', total: 9 },
					{ type: 'fire', expr: 'd6(3)', total: 3 }
				]
			}
		},
		{
			title: 'nat 20 — the card, the summary and the die all re-tint',
			entry: {
				label: 'Divine Smite',
				expr: ' +7',
				total: 27,
				advantageRoll: { kept: 20, dropped: 9 },
				natural: 20,
				damage: [
					{ type: 'slashing', expr: 'd8(6) + d8(2) +4', total: 12 },
					{ type: 'radiant', expr: 'd8(7) + d8(5) + d8(2) + d8(8)', total: 22 }
				]
			}
		},
		{
			title: 'nat 1',
			entry: {
				label: 'Stealth',
				expr: ' +3',
				total: 4,
				advantageRoll: { kept: 1, dropped: 11 },
				natural: 1
			}
		},
		{
			title: 'rerolled / floored dice + an upcast note',
			entry: {
				label: 'Fireball',
				expr: 'd6(1↻5) + d6(4) + d6(6) + d6(2) + d6(1↻3) + d6(5) + d6(6) + d6(1)',
				total: 32,
				note: '8d6 base + 1d6 @ slot 4'
			}
		}
	];
</script>

<div class="page">
	<h1>Dev preview · Roll toast (5A)</h1>
	<p>
		The summary owns a fixed-width column on the right whatever the height, so a stack of toasts
		lines its numbers up. Uppercase row labels only switch on from the second row. Buttons fire the
		real toast through <code>toastRoll</code> (top-center, the app's Toaster).
	</p>

	<div class="ladder">
		{#each CASES as c, i (i)}
			<div class="case">
				<div class="cap">{c.title}</div>
				<div class="slot"><RollToast model={rollToastModel(c.entry)} /></div>
				<button class="action" onclick={() => toastRoll(c.entry)}>Fire it →</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: 0 0 12px;
	}
	p {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: var(--line-height);
		margin: 0 0 var(--space-5);
	}
	.ladder {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.cap {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 7px;
	}
	/* the real toast width, so wrapping is what the app will actually show */
	.slot {
		width: 356px;
	}
	.action {
		margin-top: 8px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 3px 9px;
		cursor: pointer;
	}
	.action:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
</style>
