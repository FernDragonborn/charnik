<script lang="ts">
	// D19: exhaustion is a LEVELED state (not a binary condition), so it lives in its OWN block to the
	// RIGHT of the HP panel (read HP first, exhaustion second). The gauge tracks match the HP bar (a
	// neutral track + solid fill, no coloured outline): discrete pips when the ladder is small
	// (max_level ≤ 6), a smooth rectangular scale when it's larger (a homebrew 20-rung ladder). Both
	// clamp to the row's max_level and carry a −/+ stepper; pips are also click-to-set. Hidden when no
	// exhaustion content is loaded (exhaustionMax === 0). Reads the shared `combat` view-model.
	import type { Character } from '$lib/character/schema';
	import { combat } from '../state.svelte';

	let { c }: { c: Character } = $props();
	const max = $derived(combat.exhaustionMax);
	const level = $derived(c.play.exhaustion);
	const pips = $derived(max <= 6 ? Array.from({ length: max }, (_, i) => i) : []);
</script>

{#if max > 0}
	<div class="exhaustion">
		{#if max <= 6}
			<div class="gauge pips" role="group" aria-label="Exhaustion level">
				{#each pips as i (i)}
					<button
						type="button"
						class="pip"
						class:on={level > i}
						aria-label="Exhaustion level {i + 1}"
						aria-pressed={level > i}
						onclick={() => combat.setExhaustion(level === i + 1 ? i : i + 1)}
					></button>
				{/each}
			</div>
		{:else}
			<div class="gauge smooth" role="img" aria-label="Exhaustion {level} of {max}">
				<i class="fill" style="height:{(level / max) * 100}%"></i>
			</div>
		{/if}
		<div class="side">
			<div class="exhaustion-title">Exhaustion</div>
			<div class="exhaustion-num" class:on={level > 0}>{level}<small>/{max}</small></div>
			<div class="exhaustion-step">
				<button
					type="button"
					aria-label="Decrease exhaustion"
					onclick={() => combat.setExhaustion(level - 1)}>−</button
				>
				<button
					type="button"
					aria-label="Increase exhaustion"
					onclick={() => combat.setExhaustion(level + 1)}>+</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.exhaustion {
		flex: none;
		width: 128px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 12px;
		display: flex;
		gap: 11px;
	}
	/* gauge column — tracks match the HP bar: neutral track, solid fill, NO coloured outline */
	.gauge {
		flex: none;
		width: 22px;
		min-height: 78px;
		display: flex;
		flex-direction: column-reverse;
	}
	.gauge.pips {
		gap: 5px;
	}
	.pip {
		flex: 1;
		min-height: 8px;
		padding: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		cursor: pointer;
	}
	.pip.on {
		background: var(--color-danger);
	}
	.pip:hover {
		filter: brightness(1.15);
	}
	.gauge.smooth {
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		overflow: hidden;
	}
	.gauge.smooth .fill {
		display: block;
		width: 100%;
		background: var(--color-danger);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
	}
	.side {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;
	}
	.exhaustion-title {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		text-align: center;
	}
	.exhaustion-num {
		font-family: var(--font-mono);
		font-size: var(--font-size-xl);
		font-weight: 700;
		line-height: 1;
		color: var(--color-text-muted);
	}
	.exhaustion-num.on {
		color: var(--color-danger);
	}
	.exhaustion-num small {
		font-size: var(--font-size-body);
		font-weight: 500;
		color: var(--color-text-muted);
	}
	.exhaustion-step {
		display: flex;
		gap: 6px;
		width: 100%;
	}
	.exhaustion-step button {
		flex: 1;
		padding: 4px 0;
		font-size: var(--font-size-md);
		font-weight: 600;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	.exhaustion-step button:hover {
		filter: brightness(1.15);
	}
</style>
