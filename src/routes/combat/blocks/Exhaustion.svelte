<script lang="ts">
	// D19: exhaustion is a LEVELED state (not a binary condition), so it lives in its OWN block beside
	// the HP panel — a click-to-set pip ladder clamped to the exhaustion row's max_level (data-driven,
	// not a hardcoded 6). Click the topmost filled pip to step down one. Hidden when no exhaustion
	// content is loaded (exhaustionMax === 0). Reads the shared `combat` view-model.
	import type { Character } from '$lib/character/schema';
	import { combat } from '../state.svelte';

	let { c }: { c: Character } = $props();
	const max = $derived(combat.exhaustionMax);
</script>

{#if max > 0}
	<div class="exhaustion">
		<div class="exhaustion-head">
			<span>Exhaustion</span>
			<span class="exhaustion-level" class:on={c.play.exhaustion > 0}
				>{c.play.exhaustion} / {max}</span
			>
		</div>
		<div class="exhaustion-track" role="group" aria-label="Exhaustion level">
			{#each Array.from({ length: max }, (_, i) => i) as i (i)}
				<button
					type="button"
					class="exhaustion-pip"
					class:filled={c.play.exhaustion > i}
					aria-label="Exhaustion level {i + 1}"
					aria-pressed={c.play.exhaustion > i}
					onclick={() => combat.setExhaustion(c.play.exhaustion === i + 1 ? i : i + 1)}
				></button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.exhaustion {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 12px 17px;
	}
	.exhaustion-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-bottom: 8px;
	}
	.exhaustion-level {
		font-family: var(--font-mono);
	}
	.exhaustion-level.on {
		color: var(--color-danger);
		font-weight: 600;
	}
	.exhaustion-track {
		display: flex;
		gap: 6px;
	}
	.exhaustion-pip {
		flex: 1;
		height: 14px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		padding: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-danger);
	}
	.exhaustion-pip.filled {
		background: var(--color-danger);
	}
	.exhaustion-pip:hover {
		filter: brightness(1.15);
	}
</style>
